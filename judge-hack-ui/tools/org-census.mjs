/**
 * Org census only — no Daytona. Never prints emails or keys.
 *   node tools/org-census.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride');

function loadEnv(file) {
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq < 1) continue;
		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = val;
	}
}

loadEnv(path.join(workspaceRoot, '.env'));
const client = new RocketRideClient({ uri: process.env.ROCKETRIDE_URI, auth: process.env.ROCKETRIDE_APIKEY });
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
