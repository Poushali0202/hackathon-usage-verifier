import { Question } from 'rocketride';
import type { PipelineConfig } from 'rocketride';
import type { ExtractedTarget, PlanTier, Submission, VerifyResult } from '../types';
import {
	runExtractInSandbox,
	runVerifyInSandbox,
	toolExec,
	uploadEvaluatorBundle,
} from './daytonaInvoke';
import { explainPipeline, explainVerdict, mergeProse } from './explain';
import type { ExtractSources } from './extractRunner';
import { mergeExtractConfig, parseExtractLlmJson } from './extractSynth';
import { normalizeResult } from './normalize';
import { parseDaytonaResult, parseExtractResult } from './parseResult';
import daytonaPipeline from '../pipelines/hackjudge_daytona_v1.pipe';
import { daytonaWorkerCount, clonePipelineForSandbox, isDaytonaCpuLimit, sandboxTtlSeconds } from './pool';
import { OrgBusyError, ORG_BUSY_REASON, type OrgLease } from './leases';

export {
	daytonaWorkerCount,
	DAYTONA_WORKERS_COMPANY,
	DAYTONA_WORKERS_DEFAULT,
	isDaytonaCpuLimit,
	sandboxTtlSeconds,
} from './pool';
export { OrgBusyError, ORG_BUSY_REASON, isOrgBusyError, isOrgBusyReason } from './leases';

const pipeline = daytonaPipeline as unknown as PipelineConfig;

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

function sandboxLost(parsed: VerifyResult, toolResult: unknown): boolean {
	const reason = String(parsed.reason || '');
	if (/daytona sandbox error/i.test(reason)) return true;
	if (parsed.status === 'invalid') return true;
	const tool = toolExec(toolResult);
	if (typeof tool.error === 'string' && tool.error.trim()) return true;
	if (tool.exit_code === 127) return true;
	return false;
}

function withTarget(row: Submission, customTarget?: BatchOpts['customTarget']): Submission {
	return { ...row, target_name: customTarget?.name || row.target_name || 'RocketRide' };
}

/** Task tokens are keyed by project_id+source. Clone per sandbox or worker 2+ hits "Pipeline is already running." */
function pipelineForSandbox(): PipelineConfig {
	return clonePipelineForSandbox(pipeline);
}

async function openDaytona(client: VerifyClient, name: string, ttl: number): Promise<string> {
	const started = await client.use({ pipeline: pipelineForSandbox(), name, ttl });
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

/** Explain pipe (no Daytona CPU) turns extract.prompt into verified field values. */
async function synthesizeExtract(client: VerifyClient, draft: ExtractedTarget): Promise<ExtractedTarget> {
	const prompt = String(draft.prompt || '').trim();
	const corpus = String(draft.corpus_lower || '');
	if (!prompt) return { ...draft, prompt: undefined, corpus_lower: undefined };
	const explained = await client.use({
		pipeline: clonePipelineForSandbox(explainPipeline),
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

async function prepareSandbox(client: VerifyClient, token: string, onStage?: (stage: string) => void): Promise<void> {
	onStage?.('Uploading evaluator into Daytona…');
	await uploadEvaluatorBundle(client, token);
}

/**
 * Pool of Daytona sandboxes (one repo at a time per sandbox). Explain still
 * waits until every Daytona token is terminated — a second pipeline used to
 * kill the sandbox when both ran at once.
 */
export async function runRepos(opts: BatchOpts): Promise<VerifyResult[]> {
	const { client, repos, eventDate, historyPenalty, runName, customTarget, plan, concurrency, orgLease, signal, onStart, onStage, onResult } = opts;
	onStart?.(repos.length);
	let workers = daytonaWorkerCount(repos.length, plan, concurrency);
	const ttl = sandboxTtlSeconds(repos.length, Math.max(1, workers));
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

	try {
		if (orgLease) {
			workers = daytonaWorkerCount(
				repos.length,
				plan,
				concurrency,
				await orgLease.claim(workers, ttl),
			);
		}
		onStage?.(workers < 1
			? ORG_BUSY_REASON
			: (workers === 1
				? 'Starting the Daytona sandbox…'
				: `Starting ${workers} Daytona sandboxes…`));

		if (workers < 1) {
			fillGaps(ORG_BUSY_REASON);
			throw new OrgBusyError();
		}

	const verifyOne = async (
		index: number,
		tokenRef: { token: string; bundleReady: boolean },
		recycle: () => Promise<void>,
	): Promise<VerifyResult> => {
		const row = withTarget(repos[index], customTarget);
		onStage?.(`#${index + 1}/${repos.length} ${row.project || row.github} · ${workers} sandbox${workers === 1 ? '' : 'es'}`);
		const t0 = nowMs();
		const job = { repo: row.github, eventDate, historyPenalty, customTarget };
		const ensureBundle = async () => {
			if (tokenRef.bundleReady) return;
			await prepareSandbox(client, tokenRef.token, onStage);
			tokenRef.bundleReady = true;
		};
		try {
			await ensureBundle();
			let toolResult = await runVerifyInSandbox(client, tokenRef.token, job);
			let parsed = parseDaytonaResult(toolResult);
			if (sandboxLost(parsed, toolResult)) {
				onStage?.(`#${index + 1} sandbox lost — retrying`);
				await recycle();
				await ensureBundle();
				toolResult = await runVerifyInSandbox(client, tokenRef.token, job);
				parsed = parseDaytonaResult(toolResult);
			}
			return normalizeResult(parsed, row, (nowMs() - t0) / 1000);
		} catch (err) {
			try {
				onStage?.(`#${index + 1} sandbox error — retrying`);
				await recycle();
				await ensureBundle();
				const toolResult = await runVerifyInSandbox(client, tokenRef.token, job);
				return normalizeResult(parseDaytonaResult(toolResult), row, (nowMs() - t0) / 1000);
			} catch (err2) {
				return normalizeResult(
					{ status: 'unverifiable', reason: `Daytona sandbox error: ${asErrorMessage(err2) || asErrorMessage(err)}` },
					row,
					(nowMs() - t0) / 1000,
				);
			}
		}
	};

	const runWorker = async (workerId: number): Promise<void> => {
		if (workerId > 0) await new Promise((resolve) => setTimeout(resolve, workerId * 200));
		if (signal?.aborted) return;
		const tokenRef = { token: '', bundleReady: false };
		const boot = async () => {
			tokenRef.token = await openDaytona(client, `${label} · ${workerId + 1}`, ttl);
			tokenRef.bundleReady = false;
		};
		try {
			await boot();
		} catch (err) {
			bootError = asErrorMessage(err);
			onStage?.(`Sandbox ${workerId + 1} failed to start: ${bootError}`);
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

	const runPool = async (count: number) => {
		workers = count;
		nextIndex = 0;
		await Promise.all(Array.from({ length: count }, (_, id) => runWorker(id)));
	};

	await runPool(workers);
		if (!results.some(Boolean) && workers > 1 && isDaytonaCpuLimit(bootError)) {
			onStage?.('Daytona CPU limit hit; retrying with 1 sandbox…');
			bootError = '';
			await runPool(1);
		}

		fillGaps(bootError
			? `Daytona sandbox error: ${bootError}`
			: 'No Daytona sandbox was available');

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

async function withSandbox<T>(
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
		const token = await openDaytona(client, name, ttl);
		try {
			await uploadEvaluatorBundle(client, token);
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
	orgLease?: OrgLease,
): Promise<ExtractedTarget> {
	const hasSource = !!(src.githubUrl?.trim() || src.docsUrl?.trim() || src.pkg?.trim()
		|| (src.uploads && Object.keys(src.uploads).length));
	if (!hasSource) return { status: 'empty', reason: 'Provide a GitHub repo, docs URL, package name, or files.' };
	const toolResult = await withSandbox(client, 'Judge Hack target extract', 600, (token) =>
		runExtractInSandbox(client, token, {
			repoUrl: src.githubUrl,
			docsUrl: src.docsUrl,
			pkg: src.pkg,
			uploads: src.uploads,
		}), orgLease);
	const draft = parseExtractResult(toolResult);
	if (draft.status && draft.status !== 'complete') return draft;
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
	orgLease?: OrgLease,
): Promise<VerifyResult> {
	const t0 = nowMs();
	const row: Submission = { project: '', github: repoUrl, target_name: customTarget.name || 'Target' };
	const toolResult = await withSandbox(client, 'Judge Hack target test', 600, (token) =>
		runVerifyInSandbox(client, token, { repo: repoUrl, customTarget }, 180_000), orgLease);
	const seconds = (nowMs() - t0) / 1000;
	let result = normalizeResult(parseDaytonaResult(toolResult), row, seconds);
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
