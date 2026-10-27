/**
 * Storage probe: rocketride_sql SELECT 1 against the named target.
 * Never prints secret values. Does not use personal PG credentials.
 *
 * It deploys a pipe version, so the target must be named:
 *   node tools/sql-probe.mjs --target staging
 *   node tools/sql-probe.mjs --target cloud
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertTarget, devPair, findWorkspaceRoot, hostOf, loadWorkspaceEnv, requireTarget } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = findWorkspaceRoot(appRoot);
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride');

loadWorkspaceEnv(path.join(workspaceRoot, '.env'));

const target = requireTarget(process.argv.slice(2), 'the SQL probe (it deploys a pipe version)');
const { uri: devUri, auth: devKey } = devPair();
assertTarget(target, devUri, 'development connection');
console.log(`[dev] host=${hostOf(devUri)} target=${target}`);

const gen = spawnSync(process.execPath, [path.join(here, 'gen-pipes.mjs')], {
	stdio: 'inherit',
	cwd: appRoot,
});
if (gen.status !== 0) process.exit(gen.status || 1);

const pipeline = JSON.parse(fs.readFileSync(path.join(appRoot, 'src', 'pipelines', 'hackjudge_sql_v1.pipe'), 'utf8'));
const client = new RocketRideClient({ uri: devUri, auth: devKey });
const info = await client.connect();
console.log(`probe user=${info.email || info.userId} org=${info.organization?.name || info.organization?.id || 'none'}`);
console.log(`pipe provider=${pipeline.components.find((c) => c.id === 'sql_1')?.provider} allow_execute=${pipeline.components.find((c) => c.id === 'sql_1')?.config?.default?.allow_execute}`);

const validated = await client.validate({ pipeline });
if ((validated.errors || []).length) {
	console.error('validate errors:', JSON.stringify(validated.errors));
	await client.disconnect();
	process.exit(1);
}
console.log(`validate ok (${(validated.warnings || []).length} warnings)`);

const teamId = process.env.ROCKETRIDE_DEPLOY_TEAM || info.devTeam || info.organization?.teams?.[0]?.id;
if (!teamId) {
	console.error('No team id for deployTo');
	await client.disconnect();
	process.exit(1);
}

const added = await client.deploy.add({
	kind: 'pipe',
	pipeline,
	comment: 'Judge Hack Stage 3 SQL probe',
	deployTo: teamId,
});
console.log(`deployed ${pipeline.name} project_id=${pipeline.project_id} version=${added.artifact?.version ?? added.artifact?.registryVersion ?? '?'}`);
try {
	await client.deploy.enable(pipeline.project_id, teamId);
} catch (err) {
	console.log(`enable: ${err instanceof Error ? err.message : err}`);
}

const copy = JSON.parse(JSON.stringify(pipeline));
copy.project_id = crypto.randomUUID();
let token;
try {
	const started = await client.use({ pipeline: copy, name: 'Judge Hack SQL probe', ttl: 180 });
	token = started.token;
	let result;
	try {
		result = await client.database.query({ token, sql: 'SELECT 1 AS ok', nodeId: 'sql_1' });
	} catch (first) {
		console.log(`database.query: ${first instanceof Error ? first.message : first}`);
		result = await client.tool({
			token, tool: 'execute', nodeId: 'sql_1',
			input: { sql: 'SELECT 1 AS ok' }, timeout: 30_000,
		});
	}
	const rows = result?.rows || result?.output || result;
	console.log('SELECT 1 rows=', JSON.stringify(rows).slice(0, 400));
	const ok = Array.isArray(result?.rows)
		? result.rows.some((r) => Number(r.ok ?? r['?column?'] ?? Object.values(r)[0]) === 1)
		: /"ok"\s*:\s*1/.test(JSON.stringify(result));
	if (!ok) throw new Error(`SELECT 1 did not return 1: ${JSON.stringify(result).slice(0, 300)}`);
	console.log('Stage 3 probe PASS: rocketride_sql SELECT 1');
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	console.error('Stage 3 probe FAIL:', message);
	if (/ROCKETRIDE_CLIENT_ID is not set|broker|cloud DB nodes require/i.test(message)) {
		console.error('Broker/identity error — report to Dmitrii. Keep appState. Do not deploy personal db_postgres.');
	}
	process.exitCode = 1;
} finally {
	if (token) {
		try { await client.terminate(token); } catch { /* already gone */ }
	}
	await client.disconnect();
}
