/**
 * The workspace `.env`, the two connection pairs, the target guard and the
 * audience parser — in one place so they cannot drift between tools.
 *
 * Two rules this module exists to enforce, both learned from Converge:
 *
 *   1. Use the pair that matches the job. ROCKETRIDE_URI/APIKEY is the
 *      development connection — run, validate, read. ROCKETRIDE_DEPLOY_URI/
 *      DEPLOY_APIKEY is the deployment target — deploy, publish, read what is
 *      live. A write must never go out over the dev pair, because the two can
 *      point at different instances and nothing in the result says which one
 *      answered.
 *   2. Name the target. The App Builder extension rewrites `.env` whenever it
 *      connects somewhere else, so the host a script talks to is a property of
 *      when it was last clicked, not of the command. A write therefore has to
 *      state cloud/staging/local and is REFUSED when `.env` disagrees.
 *
 * Deliberate difference from Converge: there is no default target. Converge
 * defaults to `cloud`, which means a bare command deploys to production as
 * soon as `.env` points there. Judge Hack requires the word.
 *
 * Never prints a secret value — only hosts and key names.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Hostnames that count as each target. */
export const TARGET_HOSTS = {
	cloud: ['api.rocketride.ai', 'cloud.rocketride.ai'],
	staging: ['staging.rocketride.ai'],
	local: ['localhost', '127.0.0.1', '::1'],
};

export const TARGET_NAMES = Object.keys(TARGET_HOSTS);

/** Reads the workspace `.env` into process.env without overriding a real one. */
export function loadWorkspaceEnv(file) {
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq < 1) continue;
		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"'))
			|| (val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = val;
	}
}

/** Host:port for logging. Safe on a malformed URI. */
export function hostOf(uri) {
	try {
		return new URL(uri).host;
	} catch {
		return String(uri || '(unparseable)');
	}
}

function hostnameOf(uri) {
	try {
		return new URL(uri).hostname.toLowerCase();
	} catch {
		return '';
	}
}

/** Which target a URI belongs to, or null when it matches none. */
export function targetOf(uri) {
	const hostname = hostnameOf(uri);
	if (!hostname) return null;
	for (const [name, hosts] of Object.entries(TARGET_HOSTS)) {
		if (hosts.includes(hostname)) return name;
	}
	return null;
}

/** `--target <name>`, `--target=<name>`, else ROCKETRIDE_TARGET, else null. */
export function resolveTarget(argv = process.argv.slice(2), env = process.env) {
	const flagIndex = argv.indexOf('--target');
	if (flagIndex !== -1) {
		const value = argv[flagIndex + 1];
		if (!value || value.startsWith('--')) {
			throw new Error(`--target needs a value: ${TARGET_NAMES.join(' | ')}`);
		}
		return assertTargetName(value);
	}
	const inline = argv.find((arg) => arg.startsWith('--target='));
	if (inline) return assertTargetName(inline.slice('--target='.length));
	if (env.ROCKETRIDE_TARGET) return assertTargetName(env.ROCKETRIDE_TARGET);
	return null;
}

export function assertTargetName(value) {
	const name = String(value || '').trim().toLowerCase();
	if (!TARGET_NAMES.includes(name)) {
		throw new Error(`Unknown target "${value}" — choose one of: ${TARGET_NAMES.join(', ')}`);
	}
	return name;
}

/**
 * Refuses when the named target and the configured host disagree. This is the
 * guard that stops a staging habit from writing to production, and a
 * production `.env` from quietly absorbing a run meant for staging.
 */
export function assertTarget(target, uri, label = 'connection') {
	const name = assertTargetName(target);
	const actual = targetOf(uri);
	if (actual === name) return name;
	const expected = TARGET_HOSTS[name].join(' or ');
	throw new Error(
		`REFUSED: --target ${name} expects ${expected}, but the ${label} points at ${hostOf(uri)}`
		+ (actual ? ` (that is ${actual})` : ' (unrecognised host)')
		+ '. Reconnect the App Builder extension to the right backend, or name the target you meant.',
	);
}

/** The target for a write, or an error naming the choices. Never defaults. */
export function requireTarget(argv, what = 'this write') {
	const target = resolveTarget(argv);
	if (!target) {
		throw new Error(
			`Name the target for ${what}: --target ${TARGET_NAMES.join(' | --target ')}`
			+ ' (or set ROCKETRIDE_TARGET). There is no default, because `.env` follows whichever'
			+ ' backend the App Builder extension last connected to.',
		);
	}
	return target;
}

/** Development connection: run, validate, read. Never deploys. */
export function devPair(env = process.env) {
	const uri = env.ROCKETRIDE_URI;
	const auth = env.ROCKETRIDE_APIKEY;
	if (!uri || !auth) {
		throw new Error('Missing ROCKETRIDE_URI / ROCKETRIDE_APIKEY in the workspace .env — connect the App Builder extension.');
	}
	return { uri, auth };
}

/** Deployment target: deploy, publish, read what is live. Never falls back to the dev pair. */
export function deployPair(env = process.env) {
	const uri = env.ROCKETRIDE_DEPLOY_URI;
	const auth = env.ROCKETRIDE_DEPLOY_APIKEY;
	if (!uri || !auth) {
		throw new Error(
			'No deployment target configured — ROCKETRIDE_DEPLOY_URI / ROCKETRIDE_DEPLOY_APIKEY are missing.'
			+ ' Reconnect the App Builder extension; do not substitute the dev pair.',
		);
	}
	return { uri, auth };
}

/** `@me`, `@public` or `@team/<name>`. An audience is always named, never inferred. */
export function parseAudience(value) {
	const raw = String(value || '').trim();
	if (raw === '@me' || raw === '@public') return raw;
	const team = /^@team\/(.+)$/.exec(raw);
	if (team && team[1].trim()) return `@team/${team[1].trim()}`;
	throw new Error(`Audience must be @me, @public or @team/<name>, got "${value}"`);
}

/** `--audience <value>` / `--audience=<value>`, else null. */
export function resolveAudience(argv = process.argv.slice(2)) {
	const flagIndex = argv.indexOf('--audience');
	if (flagIndex !== -1) {
		const value = argv[flagIndex + 1];
		if (!value || value.startsWith('--')) throw new Error('--audience needs a value, e.g. --audience @me');
		return parseAudience(value);
	}
	const inline = argv.find((arg) => arg.startsWith('--audience='));
	if (inline) return parseAudience(inline.slice('--audience='.length));
	return null;
}

/**
 * The workspace root is the nearest ancestor holding `.rocketride/services-catalog.json`,
 * the folder the App Builder extension connected and vendored the catalog into. Walking up
 * (instead of assuming `../..`) lets the app live inside the verifier repo
 * (judge-hack-ui/ beside eval/) or in a workspace (apps/judge-hack-ui beside Projects/).
 * Falls back to `../..` so an unconnected checkout still names a sensible folder.
 */
export function findWorkspaceRoot(appRoot) {
	const ancestors = [];
	for (let dir = path.resolve(appRoot); ; dir = path.dirname(dir)) {
		ancestors.push(dir);
		if (path.dirname(dir) === dir) break;
	}
	const hasCatalog = (dir) => fs.existsSync(path.join(dir, '.rocketride', 'services-catalog.json'));
	// A workspace the extension actually connected has the catalog AND wrote `.env`; a stale
	// catalog left behind by an older connection (no `.env`) must not win over it.
	return ancestors.find((dir) => hasCatalog(dir) && fs.existsSync(path.join(dir, '.env')))
		|| ancestors.find(hasCatalog)
		|| path.resolve(appRoot, '..', '..');
}
