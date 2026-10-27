/**
 * One app id, two instances.
 *
 * Staging registered `hackjudge.judge-hack`. A production organization may own a
 * different developer namespace, and an app id outside the organization's
 * namespace deploys to a read-only Deploy tab ("Nothing is deployed yet"), so
 * the id has to be the production one *inside the pack*.
 *
 * Rather than keep a second tree, `patchAppId` rewrites the id in the four
 * shipped places for the duration of a pack and restores the original bytes on
 * exit. Read-only tools just resolve the id and never write.
 *
 * `appManifest.projectId` and the pipes' `project_id`s are stable identities and
 * are never touched. The npm package name is not the app id and stays put.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_APP_ID = 'hackjudge.judge-hack';

/** Files carrying the id as a literal. Order is irrelevant; all are restored together. */
const ID_FILES = [
	'package.json',
	path.join('src', 'AppDescriptor.ts'),
	path.join('src', 'billing.ts'),
	'judge-hack.rrapp',
];

/** `hackjudge.judge-hack` -> `hackjudge`. The publisher must equal the organization's developerId. */
export function namespaceOf(appId) {
	const dot = String(appId || '').indexOf('.');
	return dot > 0 ? String(appId).slice(0, dot) : '';
}

export function assertAppId(appId) {
	const id = String(appId || '').trim();
	if (!/^[a-z0-9][a-z0-9_-]*\.[a-z0-9][a-z0-9_-]*$/.test(id)) {
		throw new Error(`App id must look like <developerId>.<app>, got "${appId}"`);
	}
	return id;
}

/**
 * `--app-id <id>` / `--app-id=<id>`, else ROCKETRIDE_APP_ID, else the staging id.
 * Every tool resolves the same way so one export cannot drift from another.
 */
export function resolveAppId(argv = process.argv.slice(2)) {
	const flagIndex = argv.indexOf('--app-id');
	if (flagIndex !== -1) {
		const value = argv[flagIndex + 1];
		if (!value || value.startsWith('--')) throw new Error('--app-id needs a value, e.g. --app-id hackjudge.judge-hack');
		return assertAppId(value);
	}
	const inline = argv.find((arg) => arg.startsWith('--app-id='));
	if (inline) return assertAppId(inline.slice('--app-id='.length));
	if (process.env.ROCKETRIDE_APP_ID) return assertAppId(process.env.ROCKETRIDE_APP_ID);
	return DEFAULT_APP_ID;
}

/**
 * Rewrite the app id in the pack. Returns a restore function that puts the
 * original bytes back — call it from a `finally` so a failed build cannot leave
 * the tree holding another instance's id.
 */
export function patchAppId(appRoot, nextId, fromId = DEFAULT_APP_ID) {
	const target = assertAppId(nextId);
	const source = assertAppId(fromId);
	const snapshot = [];
	if (target === source) return () => {};

	const nextPublisher = namespaceOf(target);
	const prevPublisher = namespaceOf(source);

	try {
		for (const relative of ID_FILES) {
			const file = path.join(appRoot, relative);
			const original = fs.readFileSync(file, 'utf8');
			snapshot.push({ file, original });
			// The literal id also spells the contributed settings keys
			// (`<id>.graceDays`), which src/billing.ts derives from APP_ID — they
			// must move together or Settings silently stops resolving.
			let next = original.split(source).join(target);
			if (relative === 'package.json' && nextPublisher !== prevPublisher) {
				next = next.replace(`"publisher": "${prevPublisher}"`, `"publisher": "${nextPublisher}"`);
			}
			fs.writeFileSync(file, next);
		}
	} catch (err) {
		for (const { file, original } of snapshot) fs.writeFileSync(file, original);
		throw err;
	}

	let restored = false;
	return () => {
		if (restored) return;
		restored = true;
		for (const { file, original } of snapshot) fs.writeFileSync(file, original);
	};
}

/** Count of id literals still in the pack — a non-zero result after restore is a bug. */
export function countAppIdLiterals(appRoot, appId = DEFAULT_APP_ID) {
	let n = 0;
	for (const relative of ID_FILES) {
		const file = path.join(appRoot, relative);
		if (!fs.existsSync(file)) continue;
		n += fs.readFileSync(file, 'utf8').split(appId).length - 1;
	}
	return n;
}
