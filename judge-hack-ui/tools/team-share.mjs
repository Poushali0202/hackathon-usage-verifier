/**
 * Probe org members/teams and (optionally) publish Judge Hack to @team.
 * Never prints secret values. Never calls setEnv.
 *
 *   node tools/team-share.mjs           # probe only
 *   node tools/team-share.mjs --publish-only  # bind latest ok build to @team
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

const APP_ID = 'hackjudge.judge-hack';
const PIPE_SECRETS = [
	'ROCKETRIDE_DAYTONA_KEY',
	'ROCKETRIDE_ANTHROPIC_KEY',
	'ROCKETRIDE_GITHUB_TOKEN',
];
const publish = process.argv.includes('--publish');
const publishOnly = process.argv.includes('--publish-only');

function loadEnv(file) {
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

function mustEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing ${name} in workspace .env`);
	return value;
}

function secretPresence(env) {
	const out = {};
	for (const name of PIPE_SECRETS) {
		const raw = env && typeof env[name] === 'string' ? env[name] : '';
		out[name] = raw.trim().length > 0 ? 'set' : 'missing';
	}
	return out;
}

loadEnv(path.join(workspaceRoot, '.env'));

const client = new RocketRideClient({
	uri: mustEnv('ROCKETRIDE_URI'),
	auth: mustEnv('ROCKETRIDE_APIKEY'),
});

try {
	const info = await client.connect();
	const org = info.organization;
	if (!org?.id) throw new Error('No organization on this connection');
	console.log(`user=${info.email || info.userId}`);
	console.log(`org=${org.name} id=${org.id} developerId=${org.developerId || 'null'}`);
	console.log(`devTeam=${info.devTeam || 'none'}`);

	if (publishOnly) {
		const teams = org.teams || [];
		const shareTeam = teams.find((t) => t.id === info.devTeam) || teams[0];
		const rows = await client.listDeployments(APP_ID);
		for (const row of rows.slice(0, 25)) {
			const rungs = Array.isArray(row.rungs) ? row.rungs.join(',') : '';
			console.log(`v${row.registryVersion} build=${row.buildStatus || '?'} state=${row.state || '?'} rungs=${rungs || '-'}`);
		}
		const latest = rows.find((r) => r.buildStatus === 'ok') || rows[0];
		console.log(`teams=${teams.map((t) => `${t.name || t.id}:${t.id}`).join(',') || 'none'}`);
		console.log(`latest=${latest ? `v${latest.registryVersion} ${latest.buildStatus || '?'} ${latest.state || '?'}` : 'none'}`);
		if (!latest?.registryVersion) throw new Error('No app registry version to publish');
		if (!shareTeam?.id) throw new Error('No team to publish to');
		const me = await client.publishApp(APP_ID, latest.registryVersion, '@me');
		console.log(`publishApp @me v${latest.registryVersion}`, me?.publish ? 'ok' : JSON.stringify(me || {}));
		const target = `@team/${shareTeam.name || shareTeam.id}`;
		const published = await client.publishApp(APP_ID, latest.registryVersion, target);
		console.log(`publishApp ${target} v${latest.registryVersion}`, published?.publish ? 'ok' : JSON.stringify(published || {}));
		await client.disconnect();
		process.exit(0);
	}

	const teams = await client.account.listTeams(org.id);
	for (const team of teams) {
		console.log(`team ${team.name} id=${team.id} members=${team.memberCount}`);
		try {
			const detail = await client.account.getTeamDetail(org.id, team.id);
			for (const m of detail.members || []) {
				console.log(`  member ${m.email || m.userId} ${m.displayName || ''}`.trim());
			}
		} catch (err) {
			console.log(`  (could not load members: ${err instanceof Error ? err.message : err})`);
		}
	}

	const members = await client.account.listMembers(org.id);
	console.log(`org members=${members.length}`);
	for (const m of members) {
		const teamNames = (m.teams || []).map((t) => t.name).join(',') || '-';
		console.log(`  ${m.status} ${m.role} ${m.email || m.userId} teams=${teamNames}`);
	}

	let userEnv = {};
	let orgEnv = {};
	try { userEnv = await client.account.getEnv('user'); } catch (err) {
		console.log(`user env: ${err instanceof Error ? err.message : err}`);
	}
	try { orgEnv = await client.account.getEnv('org', org.id); } catch (err) {
		console.log(`org env: ${err instanceof Error ? err.message : err}`);
	}
	console.log('user overlay', JSON.stringify(secretPresence(userEnv)));
	console.log('org overlay', JSON.stringify(secretPresence(orgEnv)));
	for (const team of teams) {
		try {
			const teamEnv = await client.account.getEnv('team', team.id);
			console.log(`team overlay ${team.name}`, JSON.stringify(secretPresence(teamEnv)));
		} catch (err) {
			console.log(`team overlay ${team.name}: ${err instanceof Error ? err.message : err}`);
		}
	}

	const rows = await client.listDeployments(APP_ID);
	const ok = rows.filter((r) => r.buildStatus === 'ok' || r.state === 'ok' || r.state === 'private' || r.state === 'ready');
	const latest = rows.find((r) => r.buildStatus === 'ok') || rows[0];
	console.log(`deployments=${rows.length} latest=${latest ? `v${latest.registryVersion} ${latest.buildStatus || '?'} ${latest.state || '?'}` : 'none'}`);

	const orgReady = PIPE_SECRETS.every((name) => secretPresence(orgEnv)[name] === 'set');
	let shareTeam = teams.find((t) => t.id === info.devTeam) || teams[0];
	let overlayOk = orgReady;
	if (!orgReady) {
		for (const team of teams) {
			try {
				const teamEnv = await client.account.getEnv('team', team.id);
				if (PIPE_SECRETS.every((name) => secretPresence(teamEnv)[name] === 'set')) {
					overlayOk = true;
					shareTeam = team;
					break;
				}
			} catch { /* already logged */ }
		}
	}

	if (!publish) {
		if (!overlayOk) {
			console.log('Not publishing: copy the three pipe secrets to org (Account → Environment, org scope) then re-run with --publish.');
		} else {
			console.log(`Ready to publish @team/${shareTeam?.name || shareTeam?.id}. Re-run with --publish.`);
		}
		await client.disconnect();
		process.exit(0);
	}

	if (!overlayOk) {
		throw new Error('Refuse @team: org/team overlay is missing Daytona/Anthropic/GitHub keys. Owner must set them in Account → Environment (do not use setEnv from this script).');
	}
	if (!latest?.registryVersion) throw new Error('No app registry version to publish');
	if (!shareTeam?.id) throw new Error('No team to publish to');

	const target = `@team/${shareTeam.name || shareTeam.id}`;
	const published = await client.publishApp(APP_ID, latest.registryVersion, target);
	console.log(`publishApp ${target} v${latest.registryVersion}`, published?.publish ? 'ok' : JSON.stringify(published || {}));
	await client.disconnect();
} catch (err) {
	console.error(err instanceof Error ? err.stack || err.message : err);
	try { await client.disconnect(); } catch { /* ignore */ }
	process.exit(1);
}
