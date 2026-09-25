import { describe, expect, it } from 'vitest';
import {
	GITHUB_ENV_READ_REASON,
	GITHUB_TOKEN_KEY,
	GITHUB_TOKEN_MISSING_REASON,
	GithubEnvReadError,
	inspectGithubToken,
	parseGithubTokenAudit,
	readGithubToken,
	requireGithubToken,
	writeGithubTokenAudit,
	type EnvClient,
} from '../src/verify/githubToken';

function envClient(getEnv: EnvClient['account']['getEnv']): EnvClient {
	return { account: { getEnv, setEnv: async () => {} } };
}

describe('readGithubToken', () => {
	it('returns the user-scope token when getEnv succeeds', async () => {
		const token = await readGithubToken(envClient(async () => ({ [GITHUB_TOKEN_KEY]: '  ghp_abc  ' })));
		expect(token).toBe('ghp_abc');
	});
	it('returns empty when the key is absent (successful empty read)', async () => {
		expect(await readGithubToken(envClient(async () => ({ ROCKETRIDE_ANTHROPIC_KEY: 'x' })))).toBe('');
	});
	it('throws GithubEnvReadError when getEnv fails — not "no token"', async () => {
		await expect(readGithubToken(envClient(async () => { throw new Error('network down'); })))
			.rejects.toBeInstanceOf(GithubEnvReadError);
		await expect(readGithubToken(envClient(async () => { throw new Error('network down'); })))
			.rejects.toMatchObject({ message: GITHUB_ENV_READ_REASON });
	});
	it('throws when getEnv returns a non-object', async () => {
		await expect(readGithubToken(envClient(async () => null as unknown as Record<string, string>)))
			.rejects.toBeInstanceOf(GithubEnvReadError);
	});
});

describe('requireGithubToken / inspectGithubToken', () => {
	it('require throws missing on a successful empty read', async () => {
		await expect(requireGithubToken(envClient(async () => ({}))))
			.rejects.toMatchObject({ message: GITHUB_TOKEN_MISSING_REASON });
	});
	it('inspect reports present / missing / error without throwing', async () => {
		expect(await inspectGithubToken(envClient(async () => ({ [GITHUB_TOKEN_KEY]: 'ghp_x' })))).toEqual({ present: true });
		expect(await inspectGithubToken(envClient(async () => ({})))).toEqual({ present: false });
		expect(await inspectGithubToken(envClient(async () => { throw new Error('boom'); })))
			.toEqual({ present: false, error: GITHUB_ENV_READ_REASON });
	});
});

describe('github token audit', () => {
	it('records action and time, never a token value', () => {
		const raw = writeGithubTokenAudit('set');
		expect(raw).not.toMatch(/ghp_|github_pat_|ROCKETRIDE_GITHUB_TOKEN/);
		const parsed = parseGithubTokenAudit(raw);
		expect(parsed?.action).toBe('set');
		expect(parsed?.at).toBeTruthy();
		expect(parseGithubTokenAudit('not-json')).toBeNull();
		expect(parseGithubTokenAudit({ action: 'set', at: '', token: 'ghp_nope' })).toBeNull();
	});
});
