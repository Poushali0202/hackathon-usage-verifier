/**
 * Probe org members/teams and overlay readiness, and publish Judge Hack to a
 * named audience. Never prints secret values. Never calls setEnv.
 *
 * The probe reads, so it uses the dev pair. Publishing writes, so it uses the
 * DEPLOY pair and the target must be named — publishing is the one operation
 * here that other people can see.
 *
 *   node tools/team-share.mjs                                  # probe only (read-only)
 *   node tools/team-share.mjs --publish --target staging       # @me + the dev team, overlay enforced
 *   node tools/team-share.mjs --publish --target cloud --audience @team/Development
 *   node tools/team-share.mjs --publish --target cloud --audience @me --skip-overlay-check
 *
 * Flags: --publish  --target <cloud|staging|local>  --audience <@me|@public|@team/name>
 *        --app-id <id>  --skip-overlay-check
 *
 * `--publish` always pins @me as well as the named audience: the browser
 * resolves the personal rung before the team rung, so a team-only publish is
 * invisible to the publisher and looks like a no-op.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveAppId } from './app-id.mjs';
import { assertTarget, deployPair, devPair, findWorkspaceRoot, hostOf, loadWorkspaceEnv, requireTarget, resolveAudience, targetOf } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = findWorkspaceRoot(appRoot);
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride');

const APP_ID = resolveAppId();
/** Org/team-scope secrets the pipes reference. Each judge's GitHub token is user scope and not shared. */
const PIPE_SECRETS = [
	'ROCKETRIDE_ANTHROPIC_KEY',
];

const argv = process.argv.slice(2);
const args = new Set(argv);
if (args.has('--publish-only')) {
	console.error('--publish-only is gone. Use: --publish --target <cloud|staging|local> --audience <@me|@public|@team/name>');
	process.exit(1);
}
const publish = args.has('--publish');
const skipOverlayCheck = args.has('--skip-overlay-check');

function secretPresence(env) {
	const out = {};
	for (const name of PIPE_SECRETS) {
		const raw = env && typeof env[name] === 'string' ? env[name] : '';
		out[name] = raw.trim().length > 0 ? 'set' : 'missing';
	}
	return out;
}

loadWorkspaceEnv(path.join(workspaceRoot, '.env'));

const clients = [];
async function connect(pair, label) {
	console.log(`[${label}] host=${hostOf(pair.uri)} target=${targetOf(pair.uri) || 'unrecognised'}`);
	const client = new RocketRideClient({ uri: pair.uri, auth: pair.auth });
	const info = await client.connect();
	clients.push(client);
	return { client, info };
}

async function disconnectAll() {
	for (const client of clients) {
		try { await client.disconnect(); } catch { /* already gone */ }
	}
}

try {
	// Publishing writes, so settle the target and the deploy pair before the
	// probe runs — a refusal should cost nothing.
	const target = publish ? requireTarget(argv, 'publishing Judge Hack') : null;
	const deploy = publish ? deployPair() : null;
	if (publish) assertTarget(target, deploy.uri, 'deployment target');

	const { client: dev, info } = await connect(devPair(), 'dev');
	const org = info.organization;
	if (!org?.id) throw new Error('No organization on this connection');
	console.log(`user=${info.email || info.userId}`);
	console.log(`org=${org.name} id=${org.id} developerId=${org.developerId || 'null'}`);
	console.log(`devTeam=${info.devTeam || 'none'}`);

	const teams = await dev.account.listTeams(org.id);
	for (const team of teams) {
		console.log(`team ${team.name} id=${team.id} members=${team.memberCount}`);
		try {
			const detail = await dev.account.getTeamDetail(org.id, team.id);
			for (const m of detail.members || []) {
				console.log(`  member ${m.email || m.userId} ${m.displayName || ''}`.trim());
			}
		} catch (err) {
			console.log(`  (could not load members: ${err instanceof Error ? err.message : err})`);
		}
	}

	const members = await dev.account.listMembers(org.id);
	console.log(`org members=${members.length}`);
	for (const m of members) {
		const teamNames = (m.teams || []).map((t) => t.name).join(',') || '-';
		console.log(`  ${m.status} ${m.role} ${m.email || m.userId} teams=${teamNames}`);
	}

	let userEnv = {};
	let orgEnv = {};
	try { userEnv = await dev.account.getEnv('user'); } catch (err) {
		console.log(`user env: ${err instanceof Error ? err.message : err}`);
	}
	try { orgEnv = await dev.account.getEnv('org', org.id); } catch (err) {
		console.log(`org env: ${err instanceof Error ? err.message : err}`);
	}
	console.log('user overlay', JSON.stringify(secretPresence(userEnv)));
	console.log('org overlay', JSON.stringify(secretPresence(orgEnv)));
	// A GitHub token at org or team scope would be a shared credential every
	// judge silently runs on. The app only ever reads user scope, so one here
	// is dead weight at best — say so rather than leave it unnoticed.
	for (const [scope, env] of [['org', orgEnv]]) {
		if (env && typeof env.ROCKETRIDE_GITHUB_TOKEN === 'string' && env.ROCKETRIDE_GITHUB_TOKEN.trim()) {
			console.log(`WARNING: ${scope} overlay carries ROCKETRIDE_GITHUB_TOKEN — the app never reads it; delete it so it cannot become a shared credential.`);
		}
	}

	const teamOverlays = new Map();
	for (const team of teams) {
		try {
			const teamEnv = await dev.account.getEnv('team', team.id);
			teamOverlays.set(team.id, teamEnv);
			console.log(`team overlay ${team.name}`, JSON.stringify(secretPresence(teamEnv)));
			if (typeof teamEnv?.ROCKETRIDE_GITHUB_TOKEN === 'string' && teamEnv.ROCKETRIDE_GITHUB_TOKEN.trim()) {
				console.log(`WARNING: team overlay ${team.name} carries ROCKETRIDE_GITHUB_TOKEN — the app never reads it; delete it.`);
			}
		} catch (err) {
			console.log(`team overlay ${team.name}: ${err instanceof Error ? err.message : err}`);
		}
	}

	const orgReady = PIPE_SECRETS.every((name) => secretPresence(orgEnv)[name] === 'set');
	let shareTeam = teams.find((t) => t.id === info.devTeam) || teams[0];
	let overlayOk = orgReady;
	if (!orgReady) {
		for (const team of teams) {
			const teamEnv = teamOverlays.get(team.id);
			if (teamEnv && PIPE_SECRETS.every((name) => secretPresence(teamEnv)[name] === 'set')) {
				overlayOk = true;
				shareTeam = team;
				break;
			}
		}
	}

	if (!publish) {
		const suggestion = shareTeam ? `@team/${shareTeam.name || shareTeam.id}` : '@me';
		if (!overlayOk) {
			console.log(`Not publishing: set ${PIPE_SECRETS.join(', ')} at org scope (Account → Environment) first.`);
		} else {
			console.log(`Ready to publish. Re-run with --publish --target <cloud|staging> --audience ${suggestion}`);
		}
		await disconnectAll();
		process.exit(0);
	}

	// Everything below talks to the deployment target, not the dev connection.
	const devConn = devPair();
	const sameConn = deploy.uri === devConn.uri && deploy.auth === devConn.auth;
	const { client: deployClient } = sameConn ? { client: dev } : await connect(deploy, 'deploy');

	// The team list above came from the dev connection. When the two pairs
	// point at different instances, a team name from one is not a team on the
	// other — so the audience has to be stated rather than guessed.
	const explicitAudience = resolveAudience(argv);
	if (!explicitAudience && !sameConn) {
		throw new Error(
			'The dev and deploy pairs point at different instances, so the team probe cannot name an audience on the target.'
			+ ' Pass --audience @me | @public | @team/<name>.',
		);
	}
	const audience = explicitAudience
		|| (shareTeam ? `@team/${shareTeam.name || shareTeam.id}` : null);
	if (!audience) {
		throw new Error('No audience: pass --audience @me | @public | @team/<name>');
	}

	// @public is a store rung; the platform refuses it until a reviewer has
	// landed `ready`, and it is never something to reach by default.
	if (audience === '@public') {
		console.log('Publishing to @public — this is the store rung and requires deployment state `ready`.');
	}

	if (!overlayOk && !skipOverlayCheck && audience !== '@me') {
		throw new Error(
			`Refuse ${audience}: the org/team overlay is missing ${PIPE_SECRETS.join(', ')}, so explain would fail for everyone it reaches.`
			+ ' Set it in Account → Environment (never setEnv from a script), or pass --skip-overlay-check.',
		);
	}

	const rows = await deployClient.listDeployments(APP_ID);
	for (const row of rows.slice(0, 25)) {
		const rungs = Array.isArray(row.rungs) ? row.rungs.join(',') : '';
		console.log(`v${row.registryVersion} build=${row.buildStatus || '?'} state=${row.state || '?'} rungs=${rungs || '-'}`);
	}
	const latest = rows.find((r) => r.buildStatus === 'ok') || rows[0];
	console.log(`latest=${latest ? `v${latest.registryVersion} ${latest.buildStatus || '?'} ${latest.state || '?'}` : 'none'}`);
	if (!latest?.registryVersion) throw new Error(`No app registry version to publish for ${APP_ID} on ${target}`);

	// @me first and always: the browser resolves the personal rung before any
	// team rung, so leaving it behind makes the new version invisible to you.
	const me = await deployClient.publishApp(APP_ID, latest.registryVersion, '@me');
	console.log(`publishApp @me v${latest.registryVersion}`, me?.publish ? 'ok' : JSON.stringify(me || {}));
	if (audience !== '@me') {
		const published = await deployClient.publishApp(APP_ID, latest.registryVersion, audience);
		console.log(`publishApp ${audience} v${latest.registryVersion}`, published?.publish ? 'ok' : JSON.stringify(published || {}));
	}

	try {
		const pins = await deployClient.whereApp(APP_ID);
		console.log('whereApp:');
		for (const row of pins || []) {
			console.log(`  ${row.rung}\t${row.handle}\tv${row.version}\t${row.state}`);
		}
	} catch (err) {
		console.log('whereApp:', err instanceof Error ? err.message : err);
	}

	await disconnectAll();
} catch (err) {
	console.error(err instanceof Error ? err.stack || err.message : err);
	await disconnectAll();
	process.exit(1);
}
