/**
 * Stage 2: validate pipes against staging, deploy them with deployTo,
 * then verifyApp → addApp → poll buildStatus → publishApp @me.
 *
 * Uses the workspace .env. Never prints secret values. Does not call
 * setSchedule. Does not copy credentials into the org overlay.
 *
 * Run from anywhere:
 *   node apps/judge-hack-ui/tools/stage2-publish.mjs
 *
 * Flags: --validate-only  --skip-pipes  --skip-app
 */
import { spawnSync } from 'node:child_process';
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
const REQUIRED_PROVIDERS = [
	'chat',
	'agent_rocketride',
	'llm_anthropic',
	'memory_internal',
	'tool_daytona',
	'response_answers',
	'rocketride_sql',
];
const PIPE_SECRETS = [
	'ROCKETRIDE_DAYTONA_KEY',
	'ROCKETRIDE_ANTHROPIC_KEY',
	'ROCKETRIDE_GITHUB_TOKEN',
];
const PIPE_FILES = [
	'hackjudge_daytona_v1.pipe',
	'hackjudge_explain_v1.pipe',
	'hackjudge_sql_v1.pipe',
];

const args = new Set(process.argv.slice(2));
const validateOnly = args.has('--validate-only');
const verifyOnly = args.has('--verify-only');
const skipPipes = args.has('--skip-pipes');
const skipApp = args.has('--skip-app');

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

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function mustEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing ${name} in workspace .env`);
	return value;
}

function runGen(script) {
	const result = spawnSync(process.execPath, [path.join(here, script)], {
		stdio: 'inherit',
		cwd: appRoot,
	});
	if (result.status !== 0) {
		throw new Error(`${script} failed`);
	}
}

function readPipe(filename) {
	const dest = path.join(appRoot, 'src', 'pipelines', filename);
	return JSON.parse(fs.readFileSync(dest, 'utf8'));
}

function catalogNames() {
	const catalogPath = path.join(workspaceRoot, '.rocketride', 'services-catalog.json');
	const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
	const list = Array.isArray(raw) ? raw : (raw.services || raw.nodes || []);
	const names = new Set();
	if (Array.isArray(list)) {
		for (const entry of list) {
			if (entry && typeof entry.name === 'string') names.add(entry.name);
		}
	} else if (list && typeof list === 'object') {
		for (const key of Object.keys(list)) names.add(key);
	}
	return names;
}

async function connectClient(uri, auth, label) {
	const client = new RocketRideClient({ uri, auth });
	const info = await client.connect();
	const org = info.organization;
	const developerId = org?.developerId || null;
	const teams = org?.teams || [];
	console.log(`[${label}] user=${info.email || info.userId} org=${org?.name || org?.id || 'none'} developerId=${developerId || 'null'} teams=${teams.length} devTeam=${info.devTeam || 'none'}`);
	return { client, info, developerId, teams };
}

async function pollBuild(client, versionHint) {
	const deadline = Date.now() + 15 * 60 * 1000;
	let lastStatus = '';
	while (Date.now() < deadline) {
		const rows = await client.listDeployments(APP_ID);
		const latest = versionHint
			? rows.find((row) => row.registryVersion === versionHint) || rows[0]
			: rows[0];
		if (!latest) {
			console.log('No app deployments yet; waiting…');
			await sleep(5000);
			continue;
		}
		const status = `${latest.registryVersion}:${latest.buildStatus || '?'}:${latest.buildPhase || '?'}:${latest.state || '?'}`;
		if (status !== lastStatus) {
			console.log(`build ${status}`);
			lastStatus = status;
		}
		if (latest.buildStatus === 'ok') return latest;
		if (latest.buildStatus === 'failed' || latest.state === 'failed') {
			try {
				const log = await client.buildLog(APP_ID, latest.registryVersion);
				console.error((log && log.log) ? log.log.slice(-8000) : '(empty build log)');
			} catch (err) {
				console.error('Could not read build log:', err instanceof Error ? err.message : err);
			}
			throw new Error(`Server build failed for ${APP_ID} v${latest.registryVersion}`);
		}
		await sleep(5000);
	}
	throw new Error(`Timed out waiting for ${APP_ID} buildStatus=ok`);
}

loadEnv(path.join(workspaceRoot, '.env'));

const failures = [];

try {
	runGen('gen-evaluator-bundle.mjs');
	runGen('gen-pipes.mjs');

	const names = catalogNames();
	const catalogMissing = REQUIRED_PROVIDERS.filter((provider) => !names.has(provider));
	if (!catalogMissing.length) {
		console.log(`Catalog ok: ${REQUIRED_PROVIDERS.join(', ')}`);
	} else {
		console.log(`Local catalog missing: ${catalogMissing.join(', ')}`);
	}
	for (const provider of catalogMissing) {
		// Staging's services-catalog.json often omits SaaS-managed rocketride_sql
		// even though validate() accepts hackjudge_sql_v1.pipe. Do not block publish.
		if (provider === 'rocketride_sql') {
			console.log('Local catalog omits rocketride_sql; staging pipe validate is the gate.');
			continue;
		}
		failures.push(`catalog missing provider ${provider}`);
	}

	const devUri = mustEnv('ROCKETRIDE_URI');
	const devKey = mustEnv('ROCKETRIDE_APIKEY');
	const { client: dev, info, developerId, teams } = await connectClient(devUri, devKey, 'dev');

	if (!developerId) {
		failures.push('identity probe: organization.developerId is null');
	}
	if (developerId && developerId !== 'hackjudge') {
		console.log(`Note: org developerId is "${developerId}"; app id is ${APP_ID}`);
	}

	if (!skipPipes) {
		for (const filename of PIPE_FILES) {
			const pipeline = readPipe(filename);
			const result = await dev.validate({ pipeline });
			const errors = result.errors || [];
			const warnings = result.warnings || [];
			if (errors.length) {
				failures.push(`${filename} validate errors: ${JSON.stringify(errors)}`);
			} else {
				console.log(`validate ${filename}: ok (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`);
			}
		}
	}

	if (validateOnly || verifyOnly) {
		if (verifyOnly) {
			const report = await dev.deploy.verifyApp(appRoot, { workspaceRoot });
			for (const check of report.checks || []) {
				console.log(`verifyApp ${check.ok ? 'ok' : 'FAIL'} ${check.id}: ${check.note}`);
				if (!check.ok) failures.push(`verifyApp ${check.id}: ${check.note}`);
			}
			if (!report.ok) {
				failures.push(`verifyApp failed (${report.fileCount} files, ${report.uncompressedBytes} bytes)`);
			} else {
				console.log(`verifyApp ok files=${report.fileCount} bytes=${report.uncompressedBytes}`);
			}
		}
		await dev.disconnect();
		if (failures.length) {
			console.error(failures.join('\n'));
			process.exit(1);
		}
		console.log(verifyOnly ? 'Stage 2 verifyApp (local) complete.' : 'Stage 2 validate-only complete.');
		process.exit(0);
	}

	if (!process.env.ROCKETRIDE_DEPLOY_URI || !process.env.ROCKETRIDE_DEPLOY_APIKEY) {
		throw new Error('No deployment target configured — ROCKETRIDE_DEPLOY_URI / ROCKETRIDE_DEPLOY_APIKEY missing.');
	}

	const deployUri = process.env.ROCKETRIDE_DEPLOY_URI;
	const deployKey = process.env.ROCKETRIDE_DEPLOY_APIKEY;
	const sameConn = deployUri === devUri && deployKey === devKey;
	const { client: deploy } = sameConn
		? { client: dev }
		: await connectClient(deployUri, deployKey, 'deploy');

	let envNames = [];
	try {
		envNames = await deploy.account.getEnvironmentKeys();
	} catch (err) {
		console.log('Could not list environment key names:', err instanceof Error ? err.message : err);
	}
	const present = PIPE_SECRETS.filter((name) => envNames.includes(name));
	const missing = PIPE_SECRETS.filter((name) => !envNames.includes(name));
	console.log(`Pipe secrets present: ${present.join(', ') || '(none)'}`);
	if (missing.length) {
		console.log(`Pipe secrets missing from overlay (owner must set, not this script): ${missing.join(', ')}`);
	}

	const teamId = process.env.ROCKETRIDE_DEPLOY_TEAM || info.devTeam || teams[0]?.id;
	if (!teamId) throw new Error('No team id for deployTo (set ROCKETRIDE_DEPLOY_TEAM or join a team).');
	console.log(`deployTo team=${teamId}`);

	if (!skipPipes && !failures.length) {
		for (const filename of PIPE_FILES) {
			const pipeline = readPipe(filename);
			const added = await deploy.deploy.add({
				kind: 'pipe',
				pipeline,
				comment: 'Judge Hack generated pipe',
				deployTo: teamId,
			});
			const version = added.artifact?.version ?? added.artifact?.registryVersion;
			console.log(`deployed pipe ${pipeline.name} project_id=${pipeline.project_id} version=${version ?? '?'}`);
			try {
				await deploy.deploy.enable(pipeline.project_id, teamId);
			} catch (err) {
				console.log(`enable ${pipeline.project_id}: ${err instanceof Error ? err.message : err}`);
			}
		}
	}

	if (!skipApp && !failures.length) {
		const report = await deploy.deploy.verifyApp(appRoot, { workspaceRoot });
		for (const check of report.checks || []) {
			console.log(`verifyApp ${check.ok ? 'ok' : 'FAIL'} ${check.id}: ${check.note}`);
			if (!check.ok) failures.push(`verifyApp ${check.id}: ${check.note}`);
		}
		if (!report.ok) {
			failures.push(`verifyApp failed (${report.fileCount} files, ${report.uncompressedBytes} bytes)`);
		} else {
			console.log(`verifyApp ok files=${report.fileCount} bytes=${report.uncompressedBytes}`);
			const added = await deploy.deploy.addApp(appRoot, {
				workspaceRoot,
				comment: 'v21: switcher icon PNG so the launcher tile is not the fallback glyph',
				onProgress: (line) => console.log(line),
			});
			const versionHint = added.artifact?.version ?? added.artifact?.registryVersion;
			console.log(`addApp uploaded version=${versionHint ?? '?'}; polling server build…`);
			const latest = await pollBuild(deploy, versionHint);
			const published = await deploy.publishApp(APP_ID, latest.registryVersion, '@me');
			console.log(`publishApp @me v${latest.registryVersion}`, published?.publish ? 'ok' : '');
		}
	}

	if (!sameConn) await deploy.disconnect();
	await dev.disconnect();

	if (failures.length) {
		console.error('\nStage 2 incomplete:\n' + failures.join('\n'));
		process.exit(1);
	}
	console.log('Publish complete: pipes validated+deployed (including SQL), app published @me.');
} catch (err) {
	console.error(err instanceof Error ? err.stack || err.message : err);
	process.exit(1);
}
