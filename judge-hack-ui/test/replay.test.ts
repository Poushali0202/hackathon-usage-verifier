import { describe, expect, it } from 'vitest';
import {
	CACHE_TOO_LARGE_REASON,
	MAX_CACHE_BYTES,
	REPLAY_ROUNDS_REASON,
	fetchInto,
	githubBearerUrl,
	makeHttpFetcher,
	needFetch,
	parseRepo,
	runWithReplay,
	seedRepo,
	type FetchCache,
	type Fetcher,
} from '../src/verify/replay';

const META = 'https://api.github.com/repos/acme/app';
const TREE = `${META}/git/trees/main?recursive=1`;
const LANG = `${META}/languages`;
const HEAD = `${META}/commits/main`;
const FILE = 'https://raw.githubusercontent.com/acme/app/main/README.md';

function fakeFetcher(bodies: Record<string, string>, log: string[] = []): Fetcher {
	return async (url) => {
		log.push(url);
		return url in bodies ? [200, bodies[url]] : [404, 'Not Found'];
	};
}

describe('needFetch', () => {
	it('reads the evaluator reply nested in tool_python result', () => {
		expect(needFetch({ result: { status: 'need_fetch', missing: [FILE, FILE] } })).toEqual([FILE, FILE]);
		expect(needFetch({ status: 'need_fetch', missing: [] })).toEqual([]);
	});
	it('is null for complete replies and junk', () => {
		expect(needFetch({ result: { status: 'complete' } })).toBeNull();
		expect(needFetch({ stdout: '', exit_code: 1 })).toBeNull();
		expect(needFetch(null)).toBeNull();
	});
});

describe('seedRepo', () => {
	it('fetches meta first, then tree/languages/head on the default branch', async () => {
		const log: string[] = [];
		const cache: FetchCache = {};
		await seedRepo(cache, 'https://github.com/acme/app', fakeFetcher({ [META]: '{"default_branch":"main"}', [TREE]: '{}', [LANG]: '{}', [HEAD]: '{}' }, log));
		expect(log[0]).toBe(META);
		expect(Object.keys(cache).sort()).toEqual([META, TREE, LANG, HEAD].sort());
	});
	it('stops after a failed meta read (Python decides what that means)', async () => {
		const cache: FetchCache = {};
		await seedRepo(cache, 'https://github.com/acme/missing', fakeFetcher({}));
		expect(Object.keys(cache)).toEqual(['https://api.github.com/repos/acme/missing']);
	});
});

describe('runWithReplay', () => {
	it('direct mode: first reply is final, no fetches, remembers engine does not need replay', async () => {
		const log: string[] = [];
		const replayKnown = { value: null as boolean | null };
		const out = await runWithReplay({
			execute: async (cache) => ({ result: { status: 'complete', mode: cache ? 'replay' : 'direct' } }),
			fetcher: fakeFetcher({}, log),
			seedRepoUrl: 'https://github.com/acme/app',
			replayKnown,
			failClosed: (reason) => ({ status: 'fetch_incomplete', reason }),
		});
		expect((out as { result: { mode: string } }).result.mode).toBe('direct');
		expect(log).toEqual([]);
		expect(replayKnown.value).toBe(false);
	});

	it('replay mode: seeds, forwards exactly the requested URLs, returns the final verdict', async () => {
		const log: string[] = [];
		const replayKnown = { value: null as boolean | null };
		const calls: (FetchCache | null)[] = [];
		const bodies = { [META]: '{"default_branch":"main"}', [TREE]: '{}', [LANG]: '{}', [HEAD]: '{}', [FILE]: '# hi' };
		const out = await runWithReplay({
			execute: async (cache) => {
				calls.push(cache);
				if (!cache) return { result: { status: 'need_fetch', missing: [META] } };
				if (!(FILE in cache)) return { result: { status: 'need_fetch', missing: [FILE] } };
				return { result: { status: 'complete', score: 7 } };
			},
			fetcher: fakeFetcher(bodies, log),
			seedRepoUrl: 'https://github.com/acme/app',
			replayKnown,
			failClosed: (reason) => ({ status: 'fetch_incomplete', reason }),
		});
		expect((out as { result: { score: number } }).result.score).toBe(7);
		expect(calls.length).toBe(3);
		expect(Object.keys(calls[2]!).sort()).toEqual([META, TREE, LANG, HEAD, FILE].sort());
		expect(log.filter((u) => u === FILE).length).toBe(1);
		expect(replayKnown.value).toBe(true);
	});

	it('skips the probe round once replay is known', async () => {
		const calls: (FetchCache | null)[] = [];
		await runWithReplay({
			execute: async (cache) => { calls.push(cache); return { result: { status: 'complete' } }; },
			fetcher: fakeFetcher({ [META]: '{"default_branch":"main"}' }),
			seedRepoUrl: 'https://github.com/acme/app',
			replayKnown: { value: true },
			failClosed: (reason) => ({ status: 'fetch_incomplete', reason }),
		});
		expect(calls.length).toBe(1);
		expect(calls[0]).not.toBeNull();
		expect(META in calls[0]!).toBe(true);
	});

	it('fails closed when Python keeps asking for URLs already served', async () => {
		const out = await runWithReplay({
			execute: async () => ({ result: { status: 'need_fetch', missing: [FILE] } }),
			fetcher: fakeFetcher({ [FILE]: 'x' }),
			replayKnown: { value: true },
			failClosed: (reason) => ({ status: 'fetch_incomplete', reason }),
		});
		expect(out).toEqual({ status: 'fetch_incomplete', reason: REPLAY_ROUNDS_REASON });
	});

	it('fails closed when the cache would exceed the payload cap', async () => {
		const big = 'x'.repeat(MAX_CACHE_BYTES + 1);
		const out = await runWithReplay({
			execute: async () => ({ result: { status: 'need_fetch', missing: [FILE] } }),
			fetcher: fakeFetcher({ [FILE]: big }),
			replayKnown: { value: true },
			failClosed: (reason) => ({ status: 'fetch_incomplete', reason }),
		});
		expect(out).toEqual({ status: 'fetch_incomplete', reason: CACHE_TOO_LARGE_REASON });
	});
});

describe('fetchInto / makeHttpFetcher', () => {
	it('deduplicates and skips cached URLs', async () => {
		const log: string[] = [];
		const cache: FetchCache = { [META]: [200, '{}'] };
		await fetchInto(cache, [FILE, FILE, META], fakeFetcher({ [FILE]: 'x' }, log), 2);
		expect(log).toEqual([FILE]);
	});

	it('only authenticates well-formed GitHub repo URLs', () => {
		expect(githubBearerUrl(FILE)).toBe(true);
		expect(githubBearerUrl(META)).toBe(true);
		expect(githubBearerUrl(`${META}/git/trees/main?recursive=1`)).toBe(true);
		expect(githubBearerUrl('https://docs.example.com/')).toBe(false);
		expect(githubBearerUrl('https://api.github.com/user')).toBe(false);
		expect(githubBearerUrl('https://api.github.com.evil.com/repos/acme/app')).toBe(false);
		expect(githubBearerUrl('https://user:pass@api.github.com/repos/acme/app')).toBe(false);
		expect(githubBearerUrl('http://api.github.com/repos/acme/app')).toBe(false);
		expect(parseRepo('https://github.com/acme/app.git')).toEqual({ owner: 'acme', repo: 'app' });
		expect(parseRepo('https://github.com/../app')).toBeNull();
	});

	it('sends the GitHub token only to GitHub hosts and never as a header literal', async () => {
		const seen: Record<string, unknown>[] = [];
		const client = {
			tool: async (opts: { input?: Record<string, unknown> }) => {
				seen.push(opts.input || {});
				return { status_code: 200, body: 'ok' };
			},
		};
		const fetcher = makeHttpFetcher(client, 'task-token', 'ghp_secret');
		expect(await fetcher(FILE)).toEqual([200, 'ok']);
		expect(await fetcher('https://docs.example.com/')).toEqual([200, 'ok']);
		expect(seen[0].bearer_token).toBe('ghp_secret');
		expect(seen[0].method).toBe('GET');
		expect(seen[1].bearer_token).toBeUndefined();
		expect(JSON.stringify(seen[1])).not.toContain('ghp_secret');
		expect(await fetcher('https://api.github.com/user')).toEqual([200, 'ok']);
		expect(seen[2].bearer_token).toBeUndefined();
	});

	it('maps tool errors to status 0 after retries', async () => {
		let n = 0;
		const client = { tool: async () => { n += 1; throw new Error('boom'); } };
		const fetcher = makeHttpFetcher(client, 't', '');
		const [status, body] = await fetcher('https://docs.example.com/');
		expect(status).toBe(0);
		expect(body).toContain('boom');
		expect(n).toBe(3);
	}, 10_000);
});
