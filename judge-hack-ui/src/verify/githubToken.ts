/**
 * The judge's own GitHub personal access token lives in their RocketRide
 * environment (user scope) under ROCKETRIDE_GITHUB_TOKEN. Every GitHub read
 * in a run — verification, prefill, target test — is made with it, so rate
 * limits and repository access are the judge's, not a shared org secret's.
 *
 * Nothing is cached in the browser: the value is read from the account API
 * at the moment a run starts and passed straight into the evaluator call.
 * Writes are read-modify-write of the user scope only — the same operation
 * the shell's Account → Environment page performs — and never touch org/team.
 *
 * A failed getEnv is not "no token". That used to hide a broken read as if
 * the judge had never saved a PAT. Callers must treat GithubEnvReadError as
 * fail-closed, distinct from a successful empty read.
 */
export const GITHUB_TOKEN_KEY = 'ROCKETRIDE_GITHUB_TOKEN';
export const GITHUB_TOKEN_MISSING_REASON = 'GitHub token missing — add your personal access token in Settings → GitHub access';
export const GITHUB_ENV_READ_REASON = 'Could not read your RocketRide environment — no verdict without confirming your GitHub token';
export const GITHUB_TOKEN_AUDIT_PREF = 'hj.githubTokenAudit';

export type EnvClient = {
	account: {
		getEnv: (scope: 'org' | 'team' | 'user', scopeId?: string) => Promise<Record<string, string>>;
		setEnv: (scope: 'org' | 'team' | 'user', env: Record<string, string>, scopeId?: string) => Promise<void>;
	};
};

export class GithubEnvReadError extends Error {
	constructor(cause?: unknown) {
		super(GITHUB_ENV_READ_REASON);
		this.name = 'GithubEnvReadError';
		if (cause instanceof Error) this.cause = cause;
	}
}

export type GithubTokenAudit = { action: 'set' | 'clear'; at: string };

/** Classic `ghp_`, fine-grained `github_pat_`, OAuth `gho_`, or an app installation `ghs_` token. */
export function looksLikeGithubToken(value: string): boolean {
	const v = String(value || '').trim();
	if (!v || /\s/.test(v)) return false;
	return /^(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,}|gho_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,})$/.test(v)
		|| /^[a-f0-9]{40}$/i.test(v);
}

export function maskToken(value: string): string {
	const v = String(value || '');
	if (v.length <= 8) return '••••';
	return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export function writeGithubTokenAudit(action: 'set' | 'clear'): string {
	return JSON.stringify({ action, at: new Date().toISOString() } satisfies GithubTokenAudit);
}

export function parseGithubTokenAudit(raw: unknown): GithubTokenAudit | null {
	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!parsed || typeof parsed !== 'object') return null;
		const action = (parsed as GithubTokenAudit).action;
		const at = String((parsed as GithubTokenAudit).at || '');
		if ((action !== 'set' && action !== 'clear') || !at) return null;
		return { action, at };
	} catch {
		return null;
	}
}

export function formatGithubTokenAudit(audit: GithubTokenAudit): string {
	const when = new Date(audit.at);
	const stamp = Number.isNaN(when.getTime()) ? audit.at : when.toLocaleString();
	return audit.action === 'set' ? `Last saved ${stamp}` : `Last removed ${stamp}`;
}

async function readUserEnv(client: EnvClient): Promise<Record<string, string>> {
	let env: Record<string, string>;
	try {
		env = await client.account.getEnv('user');
	} catch (err) {
		throw new GithubEnvReadError(err);
	}
	if (!env || typeof env !== 'object') throw new GithubEnvReadError();
	return env;
}

/** The stored token, or '' when the judge has not added one. Throws GithubEnvReadError if the env cannot be read. */
export async function readGithubToken(client: EnvClient): Promise<string> {
	const env = await readUserEnv(client);
	return String(env[GITHUB_TOKEN_KEY] || '').trim();
}

export async function requireGithubToken(client: EnvClient): Promise<string> {
	const token = await readGithubToken(client);
	if (!token) throw new Error(GITHUB_TOKEN_MISSING_REASON);
	return token;
}

export async function inspectGithubToken(client: EnvClient): Promise<{ present: boolean; error?: undefined } | { present: false; error: string }> {
	try {
		const token = await readGithubToken(client);
		return { present: !!token };
	} catch (err) {
		return { present: false, error: err instanceof Error ? err.message : GITHUB_ENV_READ_REASON };
	}
}

export async function saveGithubToken(client: EnvClient, token: string): Promise<void> {
	const value = String(token || '').trim();
	if (!value) throw new Error('Paste a GitHub personal access token first.');
	const env = await readUserEnv(client);
	await client.account.setEnv('user', { ...env, [GITHUB_TOKEN_KEY]: value });
}

export async function clearGithubToken(client: EnvClient): Promise<void> {
	const env = await readUserEnv(client);
	if (!(GITHUB_TOKEN_KEY in env)) return;
	const next = { ...env };
	delete next[GITHUB_TOKEN_KEY];
	await client.account.setEnv('user', next);
}

/** Cheap, read-only check that GitHub accepts the token; never stores anything. */
export async function probeGithubToken(token: string): Promise<{ ok: boolean; login?: string; reason?: string; remaining?: number }> {
	try {
		const res = await fetch('https://api.github.com/user', {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
		});
		const remaining = Number(res.headers.get('x-ratelimit-remaining'));
		if (res.status === 200) {
			const body = await res.json().catch(() => ({})) as { login?: string };
			return { ok: true, login: body.login, remaining: Number.isFinite(remaining) ? remaining : undefined };
		}
		if (res.status === 401) return { ok: false, reason: 'GitHub rejected the token (401). Check that it is not expired or revoked.' };
		return { ok: false, reason: `GitHub returned HTTP ${res.status}.` };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}
