/**
 * Stage 2: validate pipes against the development connection, deploy them with
 * deployTo, then verifyApp → addApp → poll buildStatus → publishApp @me.
 *
 * Validation reads, so it uses the dev pair. Everything that writes — pipes,
 * app, publish — uses the DEPLOY pair, and the target has to be named, because
 * `.env` follows whichever backend the App Builder extension last connected to
 * and nothing in a successful run would otherwise say which instance answered.
 *
 * Never prints secret values. Does not call setSchedule. Does not copy
 * credentials into the org overlay. Never publishes @team or @public (review
 * and team rungs live in team-share.mjs).
 *
 * Run from anywhere:
 *   node judge-hack-ui/tools/stage2-publish.mjs --target staging
 *   node judge-hack-ui/tools/stage2-publish.mjs --target cloud --app-id <prod id>
 *   node judge-hack-ui/tools/stage2-publish.mjs --validate-only
 *
 * Run it from wherever the app is checked out. Do NOT reach the app through a
 * junction or symlink such as apps/judge-hack-ui: the App Builder extension
 * then sees every .pipe twice and re-assigns the project_ids within seconds.
 *
 * Flags: --target <cloud|staging|local>  --validate-only  --verify-only
 *        --skip-pipes  --skip-app  --app-id <id>  --comment <text>
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEFAULT_APP_ID, namespaceOf, patchAppId, resolveAppId } from './app-id.mjs';
import { assertTarget, deployPair, devPair, findWorkspaceRoot, hostOf, loadWorkspaceEnv, requireTarget, targetOf } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = findWorkspaceRoot(appRoot);
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride');

const APP_ID = resolveAppId();
const REQUIRED_PROVIDERS = [
	'chat',
	'agent_rocketride',
	'llm_anthropic',
	'memory_internal',
	'tool_python',
	'tool_http_request',
	'response_answers',
	'rocketride_sql',
];
/** Org-scope secrets the pipes reference. The GitHub token is per judge (user scope) and is not listed. */
const PIPE_SECRETS = [
	'ROCKETRIDE_ANTHROPIC_KEY',
];
const PIPE_FILES = [
	'hackjudge_python_v1.pipe',
	'hackjudge_explain_v1.pipe',
	'hackjudge_sql_v1.pipe',
];

const argv = process.argv.slice(2);
const args = new Set(argv);
const validateOnly = args.has('--validate-only');
const verifyOnly = args.has('--verify-only');
const skipPipes = args.has('--skip-pipes');
const skipApp = args.has('--skip-app');

const DEFAULT_COMMENT = 'tool_python + tool_http_request replay: no Daytona, no clone, per-judge GitHub token';
const commentIndex = argv.indexOf('--comment');
const appComment = commentIndex !== -1 && argv[commentIndex + 1] && !argv[commentIndex + 1].startsWith('--')
	? argv[commentIndex + 1]
	: DEFAULT_COMMENT;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

const PROJECT_IDS = JSON.parse(
	fs.readFileSync(path.join(appRoot, 'src', 'pipelines', 'project-ids.json'), 'utf8'),
);
const PIPE_KEYS = {
	'hackjudge_python_v1.pipe': 'python',
	'hackjudge_explain_v1.pipe': 'explain',
	'hackjudge_sql_v1.pipe': 'sql',
};

/** Reads a generated pipe and re-pins its project_id. The App Builder extension
 * rewrites ids it considers duplicates, and a drifted id would deploy a brand
 * new pipeline instead of a new version of the existing one. */
function readPipe(filename) {
	const dest = path.join(appRoot, 'src', 'pipelines', filename);
	const pipeline = JSON.parse(fs.readFileSync(dest, 'utf8'));
	const pinned = PROJECT_IDS[PIPE_KEYS[filename]];
	if (!pinned) throw new Error(`${filename}: no pinned project_id in project-ids.json`);
	if (pipeline.project_id !== pinned) {
		console.log(`${filename}: project_id on disk is ${pipeline.project_id}; re-pinned to ${pinned} (run npm run gen)`);
		pipeline.project_id = pinned;
	}
	return pipeline;
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
	console.log(`[${label}] host=${hostOf(uri)} target=${targetOf(uri) || 'unrecognised'}`);
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

loadWorkspaceEnv(path.join(workspaceRoot, '.env'));

const failures = [];
const readOnly = validateOnly || verifyOnly;

try {
	// Settle the target and both hosts before anything else runs. A refusal
	// should cost nothing — not a regenerated tree, and certainly not a
	// four-minute server build.
	const target = readOnly ? null : requireTarget(argv, 'deploying Judge Hack');
	const { uri: devUri, auth: devKey } = devPair();
	const deployConnInfo = readOnly ? null : deployPair();
	if (target) {
		assertTarget(target, devUri, 'development connection');
		assertTarget(target, deployConnInfo.uri, 'deployment target');
	}

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

	const devConn = await connectClient(devUri, devKey, 'dev');
	const dev = devConn.client;

	if (APP_ID !== DEFAULT_APP_ID) {
		console.log(`App id override: ${APP_ID} (tree default ${DEFAULT_APP_ID}); patched for the pack only`);
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

	const { uri: deployUri, auth: deployKey } = deployConnInfo;
	const sameConn = deployUri === devUri && deployKey === devKey;
	// Identity, developer namespace and teams all have to come from the
	// instance being written to. Reading them off the dev connection works
	// only while the two pairs agree, and fails silently when they do not.
	const deployConn = sameConn ? devConn : await connectClient(deployUri, deployKey, 'deploy');
	const { client: deploy, info: deployInfo, developerId, teams } = deployConn;

	if (!developerId) {
		failures.push(`identity probe on the deployment target: organization.developerId is null`);
	}
	// An app id outside the organization's developer namespace registers nothing
	// the org can own: the Deploy tab goes read-only on "Nothing is deployed yet".
	const wantNamespace = namespaceOf(APP_ID);
	if (developerId && developerId !== wantNamespace) {
		failures.push(
			`app id ${APP_ID} is outside this organization's developer namespace "${developerId}"`
			+ ` — re-run with --app-id ${developerId}.<app> (or connect the org that owns "${wantNamespace}")`,
		);
	}
	if (failures.length) {
		if (!sameConn) await deploy.disconnect();
		await dev.disconnect();
		console.error('\nStage 2 refused before any write:\n' + failures.join('\n'));
		process.exit(1);
	}

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

	const teamId = process.env.ROCKETRIDE_DEPLOY_TEAM || deployInfo.devTeam || teams[0]?.id;
	if (!teamId) throw new Error('No team id for deployTo (set ROCKETRIDE_DEPLOY_TEAM or join a team on the deployment target).');
	// Only assert when the connection actually enumerated teams; some orgs
	// return them from listTeams instead, and an empty list is not evidence.
	if (teams.length && !teams.some((t) => t.id === teamId)) {
		throw new Error(
			`Team ${teamId} is not a team on the deployment target (${hostOf(deployUri)}).`
			+ ' ROCKETRIDE_DEPLOY_TEAM holds an id from another instance.',
		);
	}
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
		// The id must be the connected instance's inside the pack; the tree keeps
		// the staging id, so patch for the pack and restore however this exits.
		const restoreAppId = patchAppId(appRoot, APP_ID);
		try {
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
					comment: appComment,
					onProgress: (line) => console.log(line),
				});
				const versionHint = added.artifact?.version ?? added.artifact?.registryVersion;
				console.log(`addApp uploaded version=${versionHint ?? '?'}; polling server build…`);
				const latest = await pollBuild(deploy, versionHint);
				const published = await deploy.publishApp(APP_ID, latest.registryVersion, '@me');
				console.log(`publishApp @me v${latest.registryVersion}`, published?.publish ? 'ok' : '');
				try {
					const pins = await deploy.whereApp(APP_ID);
					console.log('whereApp:');
					for (const row of pins || []) {
						console.log(`  ${row.rung}\t${row.handle}\tv${row.version}\t${row.state}`);
					}
				} catch (err) {
					console.log('whereApp:', err instanceof Error ? err.message : err);
				}
			}
		} finally {
			restoreAppId();
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
