import { Question } from 'rocketride';
import type { PipelineConfig } from 'rocketride';
import type { ExtractedTarget, PlanTier, Submission, VerifyResult } from '../types';
import { runExtractInPython, runVerifyInPython, VERIFY_TIMEOUT_MS } from './pythonInvoke';
import { explainPipeline, explainVerdict, mergeProse } from './explain';
import type { ExtractSources } from './extractRunner';
import { mergeExtractConfig, parseExtractLlmJson } from './extractSynth';
import { normalizeResult } from './normalize';
import { parsePythonResult, parseExtractResult } from './parseResult';
import pythonPipeline from '../pipelines/hackjudge_python_v1.pipe';
import { workerCount, clonePipelineForWorker, workerTtlSeconds } from './pool';
import { GITHUB_TOKEN_MISSING_REASON } from './githubToken';
import { OrgBusyError, ORG_BUSY_REASON, type OrgLease } from './leases';

export {
	workerCount,
	WORKERS_COMPANY,
	WORKERS_DEFAULT,
	workerTtlSeconds,
} from './pool';
export { OrgBusyError, ORG_BUSY_REASON, isOrgBusyError, isOrgBusyReason } from './leases';

export { GITHUB_ENV_READ_REASON, GITHUB_TOKEN_MISSING_REASON } from './githubToken';

export function isGithubTokenMissing(reason?: string): boolean {
	return /github token missing/i.test(String(reason || ''));
}

const pipeline = pythonPipeline as unknown as PipelineConfig;

/** Structural client so shell and rocketride SDK types both satisfy the call. */
export type VerifyClient = {
	use: (opts: { pipeline: PipelineConfig; name: string; ttl: number }) => Promise<{ token: string }>;
	tool: (opts: {
		token: string;
		tool: string;
		nodeId?: string;
		input?: Record<string, unknown>;
		timeout?: number;
	}) => Promise<unknown>;
	chat: (opts: { token: string; question: import('rocketride').Question }) => Promise<unknown>;
	terminate: (token: string) => Promise<void>;
};

export type BatchOpts = {
	client: VerifyClient;
	repos: Submission[];
	eventDate: string;
	historyPenalty: number;
	runName: string;
	/** The judge's own GitHub PAT; every GitHub read in the run uses it. */
	githubToken: string;
	customTarget?: { name: string; config: Record<string, unknown> };
	plan?: PlanTier;
	concurrency?: number;
	orgLease?: OrgLease;
	signal?: AbortSignal;
	onStart?: (total: number) => void;
	onStage?: (stage: string) => void;
	onResult?: (result: VerifyResult) => void;
};

function nowMs(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function asErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Transport-level failure (task token gone, engine restarted) rather than an evaluator verdict. */
function workerLost(parsed: VerifyResult): boolean {
	return parsed.status === 'invalid';
}

function withTarget(row: Submission, customTarget?: BatchOpts['customTarget']): Submission {
	return { ...row, target_name: customTarget?.name || row.target_name || 'RocketRide' };
}

async function openWorker(client: VerifyClient, name: string, ttl: number): Promise<string> {
	const started = await client.use({ pipeline: clonePipelineForWorker(pipeline), name, ttl });
	return started.token;
}

async function closeToken(client: VerifyClient, token: string | undefined): Promise<void> {
	if (!token) return;
	try { await client.terminate(token); } catch { /* already cleaned up */ }
}

function chatPayload(resp: unknown): unknown {
	if (!resp || typeof resp !== 'object') return resp;
	const box = resp as { getJson?: () => unknown; getText?: () => string };
	if (typeof box.getJson === 'function') {
		try {
			const json = box.getJson();
			if (json != null && json !== '') return json;
		} catch { /* fall through */ }
	}
	if (typeof box.getText === 'function') {
		try {
			const text = box.getText();
			if (text != null && String(text).trim()) return text;
		} catch { /* fall through */ }
	}
	return resp;
}

/** Explain pipe turns extract.prompt into verified field values. */
async function synthesizeExtract(client: VerifyClient, draft: ExtractedTarget): Promise<ExtractedTarget> {
	const prompt = String(draft.prompt || '').trim();
	const corpus = String(draft.corpus_lower || '');
	if (!prompt) return { ...draft, prompt: undefined, corpus_lower: undefined };
	const explained = await client.use({
		pipeline: clonePipelineForWorker(explainPipeline),
		name: 'Judge Hack target extract · synthesize',
		ttl: 300,
	});
	try {
		let llm: Record<string, unknown> | null = null;
		let lastError = '';
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const question = new Question({ expectJson: attempt === 0 });
				question.addQuestion(attempt === 0
					? prompt
					: `${prompt}\n\nREMINDER: reply with ONLY the strict JSON object.`);
				const resp = await Promise.race([
					client.chat({ token: explained.token, question }),
					new Promise<never>((_, reject) => {
						setTimeout(() => reject(new Error('extract synthesize timeout')), 90_000);
					}),
				]);
				llm = parseExtractLlmJson(chatPayload(resp));
				if (llm) break;
				lastError = 'LLM reply was not extract JSON';
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}
		}
		const merged = mergeExtractConfig(draft.config, llm, corpus);
		const warnings = [...(draft.warnings || [])].filter((w) => !/LLM synthesis unavailable/i.test(w));
		if (!merged.usedLlm) {
			warnings.push(lastError
				? `LLM synthesis unavailable (${lastError}); prefill is deterministic-only.`
				: 'LLM synthesis unavailable; prefill is deterministic-only.');
		}
		return {
			...draft,
			config: merged.config,
			warnings,
			suggestions: merged.suggestions || draft.suggestions,
			prompt: undefined,
			corpus_lower: undefined,
		};
	} finally {
		await closeToken(client, explained.token);
	}
}

/**
 * Pool of evaluator workers (one tool_python task token each, one repo at a
 * time). Explain waits until every worker token is terminated.
 */
export async function runRepos(opts: BatchOpts): Promise<VerifyResult[]> {
	const { client, repos, eventDate, historyPenalty, runName, githubToken, customTarget, plan, concurrency, orgLease, signal, onStart, onStage, onResult } = opts;
	onStart?.(repos.length);
	let workers = workerCount(repos.length, plan, concurrency);
	const ttl = workerTtlSeconds(repos.length, Math.max(1, workers));
	const label = runName || 'Judge Hack verification';
	const results: Array<VerifyResult | undefined> = new Array(repos.length);
	let nextIndex = 0;
	let bootError = '';

	const fillGaps = (reason: string) => {
		const scoredWait = results as Array<VerifyResult | undefined>;
		for (let i = 0; i < repos.length; i++) {
			if (scoredWait[i]) continue;
			const row = withTarget(repos[i], customTarget);
			const gap = normalizeResult(
				{
					status: 'unverifiable',
					reason: signal?.aborted
						? 'Run stopped before this repo started'
						: reason,
				},
				row,
				0,
			);
			scoredWait[i] = gap;
			onResult?.(gap);
		}
		return scoredWait as VerifyResult[];
	};

	if (!String(githubToken || '').trim()) {
		onStage?.(GITHUB_TOKEN_MISSING_REASON);
		return fillGaps(GITHUB_TOKEN_MISSING_REASON);
	}

	try {
		if (orgLease) {
			workers = workerCount(
				repos.length,
				plan,
				concurrency,
				await orgLease.claim(workers, ttl),
			);
		}
		onStage?.(workers < 1
			? ORG_BUSY_REASON
			: (workers === 1
				? 'Starting the evaluator…'
				: `Starting ${workers} evaluators…`));

		if (workers < 1) {
			fillGaps(ORG_BUSY_REASON);
			throw new OrgBusyError();
		}

	const verifyOne = async (
		index: number,
		tokenRef: { token: string },
		recycle: () => Promise<void>,
	): Promise<VerifyResult> => {
		const row = withTarget(repos[index], customTarget);
		onStage?.(`#${index + 1}/${repos.length} ${row.project || row.github} · ${workers} evaluator${workers === 1 ? '' : 's'}`);
		const t0 = nowMs();
		const job = { repo: row.github, eventDate, historyPenalty, customTarget };
		const stage = (text: string) => onStage?.(`#${index + 1}/${repos.length} ${text}`);
		const verify = () => runVerifyInPython(client, tokenRef.token, job, githubToken, VERIFY_TIMEOUT_MS, stage);
		try {
			let parsed = parsePythonResult(await verify());
			if (workerLost(parsed)) {
				onStage?.(`#${index + 1} evaluator task lost — retrying`);
				await recycle();
				parsed = parsePythonResult(await verify());
			}
			return normalizeResult(parsed, row, (nowMs() - t0) / 1000);
		} catch (err) {
			try {
				onStage?.(`#${index + 1} evaluator error — retrying`);
				await recycle();
				const parsed = parsePythonResult(await verify());
				return normalizeResult(parsed, row, (nowMs() - t0) / 1000);
			} catch (err2) {
				return normalizeResult(
					{ status: 'unverifiable', reason: `Evaluator error: ${asErrorMessage(err2) || asErrorMessage(err)}` },
					row,
					(nowMs() - t0) / 1000,
				);
			}
		}
	};

	const runWorker = async (workerId: number): Promise<void> => {
		if (workerId > 0) await new Promise((resolve) => setTimeout(resolve, workerId * 200));
		if (signal?.aborted) return;
		const tokenRef = { token: '' };
		const boot = async () => {
			tokenRef.token = await openWorker(client, `${label} · ${workerId + 1}`, ttl);
		};
		try {
			await boot();
		} catch (err) {
			bootError = asErrorMessage(err);
			onStage?.(`Evaluator ${workerId + 1} failed to start: ${bootError}`);
			return;
		}
		const recycle = async () => {
			await closeToken(client, tokenRef.token);
			await boot();
		};
		try {
			while (!signal?.aborted) {
				const index = nextIndex;
				nextIndex += 1;
				if (index >= repos.length) break;
				const result = await verifyOne(index, tokenRef, recycle);
				results[index] = result;
				onResult?.(result);
			}
		} finally {
			await closeToken(client, tokenRef.token);
		}
	};

	await Promise.all(Array.from({ length: workers }, (_, id) => runWorker(id)));

		fillGaps(bootError
			? `Evaluator error: ${bootError}`
			: 'No evaluator worker was available');

		const scored = results as VerifyResult[];
		const explainable = scored
			.map((result, index) => ({ result, index, row: withTarget(repos[index], customTarget) }))
			.filter(({ result }) => result.status === 'complete' && result.repo_accessible !== false);
		if (!explainable.length || signal?.aborted) return scored;

		let explainToken: string | undefined;
		try {
			const explained = await client.use({
				pipeline: explainPipeline,
				name: `${label} · explain`,
				ttl: Math.max(600, repos.length * 90),
			});
			explainToken = explained.token;
			for (const item of explainable) {
				if (signal?.aborted) break;
				onStage?.(`explaining ${item.result.project || item.row.github}`);
				const next = await explainVerdict(client, explainToken, item.result, item.row);
				scored[item.index] = next;
				onResult?.(next);
			}
		} catch {
			for (const item of explainable) {
				scored[item.index] = mergeProse(item.result, { explain_failed: true });
				onResult?.(scored[item.index]);
			}
		} finally {
			await closeToken(client, explainToken);
		}
		return scored;
	} finally {
		await orgLease?.release();
	}
}

async function withWorker<T>(
	client: VerifyClient,
	name: string,
	ttl: number,
	fn: (token: string) => Promise<T>,
	orgLease?: OrgLease,
): Promise<T> {
	if (orgLease) {
		const got = await orgLease.claim(1, ttl);
		if (got < 1) {
			try {
				throw new OrgBusyError();
			} finally {
				await orgLease.release();
			}
		}
	}
	try {
		const token = await openWorker(client, name, ttl);
		try {
			return await fn(token);
		} finally {
			await closeToken(client, token);
		}
	} finally {
		await orgLease?.release();
	}
}

/** Prefill a custom target from a vendor repo, docs site, package registry, and/or uploaded files. */
export async function extractTarget(
	client: VerifyClient,
	src: ExtractSources,
	githubToken: string,
	orgLease?: OrgLease,
): Promise<ExtractedTarget> {
	const hasSource = !!(src.githubUrl?.trim() || src.docsUrl?.trim() || src.pkg?.trim()
		|| (src.uploads && Object.keys(src.uploads).length));
	if (!hasSource) return { status: 'empty', reason: 'Provide a GitHub repo, docs URL, package name, or files.' };
	if (!String(githubToken || '').trim()) return { status: 'failed', reason: GITHUB_TOKEN_MISSING_REASON };
	const toolResult = await withWorker(client, 'Judge Hack target extract', 600, (token) =>
		runExtractInPython(client, token, {
			repoUrl: src.githubUrl,
			docsUrl: src.docsUrl,
			pkg: src.pkg,
			uploads: src.uploads,
		}, githubToken), orgLease);
	const draft = parseExtractResult(toolResult);
	if (draft.status && draft.status !== 'complete') return draft;
	const docsFailed = (draft.warnings || []).some((w) => /docs url could not be fetched/i.test(w));
	if (docsFailed || !String(draft.prompt || '').trim()) {
		return { ...draft, prompt: undefined, corpus_lower: undefined };
	}
	try {
		return await synthesizeExtract(client, draft);
	} catch (err) {
		const extra = err instanceof Error ? err.message : String(err);
		return {
			...draft,
			prompt: undefined,
			corpus_lower: undefined,
			warnings: [
				...(draft.warnings || []).filter((w) => !/LLM synthesis unavailable/i.test(w)),
				`LLM synthesis unavailable (${extra}); prefill is deterministic-only.`,
			],
		};
	}
}

/** One-repo detection test from the Targets editor (not stored as a run). */
export async function testTargetRepo(
	client: VerifyClient,
	repoUrl: string,
	customTarget: { name: string; config: Record<string, unknown> },
	githubToken: string,
	orgLease?: OrgLease,
): Promise<VerifyResult> {
	const t0 = nowMs();
	const row: Submission = { project: '', github: repoUrl, target_name: customTarget.name || 'Target' };
	if (!String(githubToken || '').trim()) {
		return normalizeResult({ status: 'unverifiable', reason: GITHUB_TOKEN_MISSING_REASON }, row, 0);
	}
	const toolResult = await withWorker(client, 'Judge Hack target test', 600, (token) =>
		runVerifyInPython(client, token, { repo: repoUrl, customTarget }, githubToken, 180_000), orgLease);
	const seconds = (nowMs() - t0) / 1000;
	let result = normalizeResult(parsePythonResult(toolResult), row, seconds);
	if (result.classify_failed || result.repo_accessible === false || result.status !== 'complete') {
		return result;
	}
	try {
		const explained = await client.use({
			pipeline: explainPipeline,
			name: 'Judge Hack target test · explain',
			ttl: 300,
		});
		try {
			result = await explainVerdict(client, explained.token, result, row);
		} finally {
			await closeToken(client, explained.token);
		}
	} catch {
		result = mergeProse(result, { explain_failed: true });
	}
	return result;
}
