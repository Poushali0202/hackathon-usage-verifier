import { RESTRICTED_BUNDLE } from './generated/evaluatorBundle';
import { EXTRACT_SCHEMA, VERIFY_SCHEMA } from './parseResult';
import { makeHttpFetcher, runWithReplay, type FetchCache } from './replay';

/**
 * The evaluator runs in the catalog `tool_python` node (RestrictedPython,
 * in-process on the RocketRide engine). GitHub is read over the REST/raw API
 * with the judge's own token — no sandbox, no git clone, nothing on disk.
 * When the engine forbids `urllib` the evaluator asks for URLs and the app
 * fetches them over the catalog `tool_http_request` node (see replay.ts).
 */
export const PYTHON_NODE_ID = 'python_1';
export const PYTHON_TOOL = 'execute';
const PYTHON_TOOL_FALLBACK = 'python.execute';

export type PythonToolClient = {
	tool: (opts: {
		token: string;
		tool: string;
		nodeId?: string;
		input?: Record<string, unknown>;
		timeout?: number;
	}) => Promise<unknown>;
};

export type VerifyJob = {
	repo: string;
	eventDate?: string;
	historyPenalty?: number;
	customTarget?: { name: string; config: Record<string, unknown> };
};

export type ExtractJob = {
	repoUrl?: string;
	docsUrl?: string;
	pkg?: string;
	uploads?: Record<string, string>;
};

/** Shape returned by tool_python (`result` is the script's `result` variable, untruncated). */
export type PythonExec = {
	stdout?: string;
	stderr?: string;
	exit_code?: number;
	timed_out?: boolean;
	result?: unknown;
};

/** Per-repo wall clock in the browser; the node itself is capped at 900 s per call. */
export const VERIFY_TIMEOUT_MS = 600_000;
export const EXTRACT_TIMEOUT_MS = 240_000;

/** Whether this engine needs replay mode; learned from the first evaluator reply. */
export const replayKnown: { value: boolean | null } = { value: null };

/**
 * Python string literal for arbitrary text. JSON string literals are valid
 * Python string literals; escaping the U+2028/2029 pair keeps it single-line.
 */
export function pyStr(text: string): string {
	return JSON.stringify(text).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Bundle + job + token + fetch cache + entry-point call. Nothing else is interpolated. */
export function buildCode(
	entry: 'run_verify' | 'run_extract',
	job: Record<string, unknown>,
	githubToken: string,
	cache: FetchCache | null = null,
): string {
	return [
		RESTRICTED_BUNDLE,
		'',
		`JOB = json.loads(${pyStr(JSON.stringify(job))})`,
		`TOKEN = ${pyStr(githubToken)}`,
		cache ? `CACHE = json.loads(${pyStr(JSON.stringify(cache))})` : 'CACHE = None',
		`result = ${entry}(JOB, TOKEN, CACHE)`,
		'',
	].join('\n');
}

export function pythonExec(value: unknown): PythonExec {
	return value && typeof value === 'object' ? value as PythonExec : {};
}

async function execute(
	client: PythonToolClient,
	token: string,
	code: string,
	timeout: number,
): Promise<unknown> {
	try {
		return await client.tool({ token, tool: PYTHON_TOOL, nodeId: PYTHON_NODE_ID, input: { code }, timeout });
	} catch (first) {
		// Some engine builds register the tool under `<serverName>.<tool>`.
		return await client.tool({ token, tool: PYTHON_TOOL_FALLBACK, nodeId: PYTHON_NODE_ID, input: { code }, timeout })
			.catch(() => { throw first; });
	}
}

export function verifyPayload(job: VerifyJob): Record<string, unknown> {
	return {
		repo: job.repo,
		eventDate: job.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(job.eventDate) ? job.eventDate : '',
		historyPenalty: Number.isFinite(job.historyPenalty) ? job.historyPenalty : null,
		customTarget: job.customTarget
			? { name: job.customTarget.name, ...job.customTarget.config }
			: null,
	};
}

export function extractPayload(job: ExtractJob): Record<string, unknown> {
	return {
		repoUrl: (job.repoUrl || '').trim(),
		docsUrl: (job.docsUrl || '').trim(),
		pkg: (job.pkg || '').trim(),
		uploads: job.uploads || {},
	};
}

export async function runVerifyInPython(
	client: PythonToolClient,
	token: string,
	job: VerifyJob,
	githubToken: string,
	timeout = VERIFY_TIMEOUT_MS,
	onStage?: (text: string) => void,
): Promise<unknown> {
	const payload = verifyPayload(job);
	return runWithReplay({
		execute: (cache) => execute(client, token, buildCode('run_verify', payload, githubToken, cache), timeout),
		fetcher: makeHttpFetcher(client, token, githubToken),
		seedRepoUrl: job.repo,
		replayKnown,
		onStage,
		failClosed: (reason) => ({ schema: VERIFY_SCHEMA, status: 'fetch_incomplete', repo_url: job.repo, reason, mode: 'replay' }),
	});
}

export async function runExtractInPython(
	client: PythonToolClient,
	token: string,
	job: ExtractJob,
	githubToken: string,
	timeout = EXTRACT_TIMEOUT_MS,
	onStage?: (text: string) => void,
): Promise<unknown> {
	const payload = extractPayload(job);
	return runWithReplay({
		execute: (cache) => execute(client, token, buildCode('run_extract', payload, githubToken, cache), timeout),
		fetcher: makeHttpFetcher(client, token, githubToken),
		seedRepoUrl: job.repoUrl?.trim() || undefined,
		replayKnown,
		onStage,
		failClosed: (reason) => ({ schema: EXTRACT_SCHEMA, status: 'failed', reason, mode: 'replay' }),
	});
}
