/**
 * Org census only — no Daytona. Never prints emails or keys.
 * Read-only, so it uses the dev pair and needs no --target.
 *   node tools/org-census.mjs
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { devPair, findWorkspaceRoot, hostOf, loadWorkspaceEnv, targetOf } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = findWorkspaceRoot(appRoot);
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride');

loadWorkspaceEnv(path.join(workspaceRoot, '.env'));
const { uri, auth } = devPair();
console.error(`[dev] host=${hostOf(uri)} target=${targetOf(uri) || 'unrecognised'}`);
const client = new RocketRideClient({ uri, auth });
try {
	const info = await client.connect();
	const orgId = info.organization?.id;
	const org = orgId ? await client.account.getOrg(orgId) : await client.account.getOrg();
	let unique = 0;
	let roles = [];
	try {
		const members = orgId ? await client.account.listMembers(orgId) : [];
		unique = new Set(members.map((m) => m.userId)).size;
		roles = members.map((m) => `${m.role || '?'}:${m.status || '?'}`);
	} catch (err) {
		roles = [`listMembers_failed:${err instanceof Error ? err.name : 'err'}`];
	}
	process.stdout.write(JSON.stringify({
		org: org.name || info.organization?.name || null,
		memberCount: org.memberCount ?? unique,
		uniqueUserIds: unique,
		roles,
		sameKeySessionsWouldShareUser: true,
		userIdPrefix: String(info.userId || '').slice(0, 8),
	}) + '\n');
} finally {
	await client.disconnect();
}
