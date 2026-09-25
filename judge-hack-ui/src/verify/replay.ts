import type { PythonToolClient } from './pythonInvoke';

/**
 * Replay-mode fetch layer.
 *
 * The evaluator (RestrictedPython inside the catalog `tool_python` node) decides which
 * URLs it needs; when the engine's sandbox forbids `urllib` it answers `need_fetch` with
 * the exact URLs. The app fetches those over the catalog `tool_http_request` node in the
 * same pipe — GET only, the judge's own GitHub token as bearer for GitHub hosts — and
 * re-runs the evaluator with the bodies as CACHE. Nothing is cloned, nothing is fetched
 * from the browser, and the app never chooses evidence: it only forwards what Python asks.
 */
export const HTTP_NODE_ID = 'http_1';
export const HTTP_TOOL = 'http_request';
const HTTP_TOOL_FALLBACK = 'http.http_request';

export const FETCH_CONCURRENCY = 6;
export const MAX_REPLAY_ROUNDS = 8;
/** Hard cap on the cache literal shipped into one tool_python call. */
export const MAX_CACHE_BYTES = 12 * 1024 * 1024;
export const CACHE_TOO_LARGE_REASON = 'Repository evidence exceeds the in-engine evaluation limit (12 MB) — no verdict on partial retrieval';
export const REPLAY_ROUNDS_REASON = 'Evaluator kept requesting more evidence than the fetch budget allows — no verdict on partial retrieval';

const GH_SEG = '[A-Za-z0-9_.-]+';
const GITHUB_API_REPO = new RegExp(`^https://api\\.github\\.com/repos/(${GH_SEG})/(${GH_SEG})(?:[/?#]|$)`, 'i');
const GITHUB_RAW_REPO = new RegExp(`^https://raw\\.githubusercontent\\.com/(${GH_SEG})/(${GH_SEG})/`, 'i');
const RETRY_STATUSES = new Set([429, 500, 502, 503]);
const UA = 'hackjudge-python-v1';

/** {url: [status, body]} — status 0 means the request never completed. */
export type FetchCache = Record<string, [number, string]>;
export type Fetcher = (url: string) => Promise<[number, string]>;

type HttpShape = { status_code?: number; body?: unknown };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function asStatusBody(value: unknown): [number, string] {
	const out = (value && typeof value === 'object' ? value : {}) as HttpShape;
	const status = Number(out.status_code);
	const body = typeof out.body === 'string' ? out.body : (out.body == null ? '' : JSON.stringify(out.body));
	return [Number.isFinite(status) ? status : 0, body];
}

/**
 * Only a well-formed GitHub repo URL may carry the judge's PAT. Docs and
 * registries go unauthenticated. Rejects userinfo, non-https, and host spoofs.
 */
export function githubBearerUrl(url: string): boolean {
	const u = String(url || '').trim();
	if (!u || /[\s\\]/.test(u) || /^https:\/\/[^/]*@/i.test(u)) return false;
	return GITHUB_API_REPO.test(u) || GITHUB_RAW_REPO.test(u);
}

/** GET through `http_1`; GitHub repo hosts get the judge's token, everything else goes bare. */
export function makeHttpFetcher(client: PythonToolClient, token: string, githubToken: string): Fetcher {
	let toolName = HTTP_TOOL;
	const call = async (url: string): Promise<[number, string]> => {
		if (!/^https:\/\//i.test(url)) return [0, 'blocked: only https URLs'];
		const github = githubBearerUrl(url);
		const input: Record<string, unknown> = {
			url,
			method: 'GET',
			headers: {
				'User-Agent': UA,
				Accept: github ? 'application/vnd.github+json' : 'text/html,application/json;q=0.9,*/*;q=0.8',
			},
			timeout: 45,
		};
		if (github && githubToken) input.bearer_token = githubToken;
		try {
			return asStatusBody(await client.tool({ token, tool: toolName, nodeId: HTTP_NODE_ID, input, timeout: 60_000 }));
		} catch (first) {
			if (toolName === HTTP_TOOL && /no handler|unknown tool|not found/i.test(String((first as Error)?.message || first))) {
				toolName = HTTP_TOOL_FALLBACK;
				return asStatusBody(await client.tool({ token, tool: toolName, nodeId: HTTP_NODE_ID, input, timeout: 60_000 }));
			}
			throw first;
		}
	};
	return async (url) => {
		for (let attempt = 0; ; attempt += 1) {
			let res: [number, string];
			try {
				res = await call(url);
			} catch (err) {
				if (attempt < 2) { await sleep(1000); continue; }
				return [0, String((err as Error)?.message || err).slice(0, 400)];
			}
			if (RETRY_STATUSES.has(res[0]) && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
			return res;
		}
	};
}

export async function fetchInto(cache: FetchCache, urls: string[], fetcher: Fetcher, concurrency = FETCH_CONCURRENCY): Promise<void> {
	const queue = Array.from(new Set(urls)).filter((u) => !(u in cache));
	let cursor = 0;
	const worker = async () => {
		while (cursor < queue.length) {
			const url = queue[cursor];
			cursor += 1;
			cache[url] = await fetcher(url);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

export function cacheBytes(cache: FetchCache): number {
	let total = 0;
	for (const url in cache) total += url.length + (cache[url][1]?.length || 0) + 16;
	return total;
}

export function parseRepo(url: string): { owner: string; repo: string } | null {
	const m = /github\.com[/:]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i.exec(url || '');
	if (!m) return null;
	const owner = m[1];
	const repo = m[2].replace(/\.git$/i, '');
	if (!owner || !repo || owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
	return { owner, repo };
}

/**
 * Deterministic GitHub reads every evaluation starts with (repo meta, recursive tree,
 * languages, head commit). Pre-seeding them saves two replay rounds; if Python wants
 * something else it still says so via `need_fetch`.
 */
export async function seedRepo(cache: FetchCache, repoUrl: string, fetcher: Fetcher): Promise<void> {
	const pr = parseRepo(repoUrl);
	if (!pr) return;
	const base = `https://api.github.com/repos/${pr.owner}/${pr.repo}`;
	await fetchInto(cache, [base], fetcher);
	const [status, body] = cache[base] || [0, ''];
	if (status !== 200) return;
	let branch = 'main';
	try { branch = String((JSON.parse(body) as { default_branch?: string }).default_branch || 'main'); } catch { /* keep default */ }
	const enc = encodeURIComponent(branch);
	await fetchInto(cache, [
		`${base}/git/trees/${enc}?recursive=1`,
		`${base}/languages`,
		`${base}/commits/${enc}`,
	], fetcher);
}

/** Missing URLs when a tool_python response carries a `need_fetch` evaluator reply, else null. */
export function needFetch(value: unknown): string[] | null {
	if (!value || typeof value !== 'object') return null;
	const outer = value as { result?: unknown; status?: unknown; missing?: unknown };
	const inner = (outer.result && typeof outer.result === 'object' ? outer.result : outer) as { status?: unknown; missing?: unknown };
	if (inner.status !== 'need_fetch') return null;
	return Array.isArray(inner.missing) ? inner.missing.map(String).filter(Boolean) : [];
}

/**
 * Drive one evaluator entry point to a final answer. `execute(cache)` runs Python with the
 * given cache (null = let the engine try direct fetch); `fetcher` fills misses.
 * `replayKnown` remembers whether this engine needs replay so later repos skip the probe round.
 */
export async function runWithReplay(opts: {
	execute: (cache: FetchCache | null) => Promise<unknown>;
	fetcher: Fetcher;
	seedRepoUrl?: string;
	replayKnown: { value: boolean | null };
	onStage?: (text: string) => void;
	failClosed: (reason: string) => unknown;
}): Promise<unknown> {
	const cache: FetchCache = {};
	let usingCache = opts.replayKnown.value === true;
	if (usingCache && opts.seedRepoUrl) await seedRepo(cache, opts.seedRepoUrl, opts.fetcher);
	for (let round = 0; round < MAX_REPLAY_ROUNDS; round += 1) {
		const out = await opts.execute(usingCache ? cache : null);
		const missing = needFetch(out);
		if (missing === null) {
			if (opts.replayKnown.value === null) opts.replayKnown.value = usingCache;
			return out;
		}
		opts.replayKnown.value = true;
		if (!usingCache) {
			usingCache = true;
			if (opts.seedRepoUrl) await seedRepo(cache, opts.seedRepoUrl, opts.fetcher);
		}
		const todo = missing.filter((u) => !(u in cache));
		if (!todo.length && round > 0) {
			// Python re-asked for URLs we already served: nothing more we can do.
			return opts.failClosed(REPLAY_ROUNDS_REASON);
		}
		if (todo.length) {
			opts.onStage?.(`fetching ${todo.length} file${todo.length === 1 ? '' : 's'} over GitHub API`);
			await fetchInto(cache, todo, opts.fetcher);
		}
		if (cacheBytes(cache) > MAX_CACHE_BYTES) return opts.failClosed(CACHE_TOO_LARGE_REASON);
	}
	return opts.failClosed(REPLAY_ROUNDS_REASON);
}
