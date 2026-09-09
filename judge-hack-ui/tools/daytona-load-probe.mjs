/**
 * Staging load probe: 4 Daytona sandboxes × mixed repos.
 * Affirms whether catalog tool_daytona can carry judging load, or a custom
 * node is required. Uses workspace .env. Never prints secret values.
 *
 *   node tools/daytona-load-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');
const evalRoot = path.join(workspaceRoot, 'Projects', 'hackathon-usage-verifier', 'eval');
const verifyRoot = path.join(appRoot, 'src', 'verify');
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride');

const WORKERS = 4;
const REPOS = [
	'https://github.com/vraj00222/hopper',
	'https://github.com/oceanseth/HumanHarness',
	'https://github.com/abhie2005/FrontierHackathon',
	'https://github.com/Aaditya2605/righthere',
	'https://github.com/ali-amjad52114/NOUS',
	'https://github.com/chinesepowered/hack-laserguild',
	'https://github.com/KrambitPL/ai-native-trading',
	'https://github.com/shahtirth07/memory-meets-motion',
];

const BUNDLE = [
	['hj/engine.py', path.join(evalRoot, 'engine.py')],
	['hj/target.py', path.join(evalRoot, 'target.py')],
	['hj/targets/rocketride.json', path.join(evalRoot, 'targets', 'rocketride.json')],
	['hj/sandbox_github.py', path.join(verifyRoot, 'sandboxGithub.py')],
	['hj/run_batch.py', path.join(verifyRoot, 'run_batch.py')],
	['hj/run_verify.py', path.join(verifyRoot, 'run_verify.py')],
	['hj/extract.py', path.join(evalRoot, 'extract.py')],
	['hj/run_extract.py', path.join(verifyRoot, 'run_extract.py')],
];

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

function mustEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing ${name} in workspace .env`);
	return value;
}

function parseJsonObject(text) {
	const raw = String(text || '');
	try {
		const parsed = JSON.parse(raw.trim());
		if (parsed && typeof parsed === 'object') return parsed;
	} catch { /* fall through */ }
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(raw.slice(start, end + 1));
	} catch {
		return null;
	}
}

function parseTool(value) {
	if (!value || typeof value !== 'object') return { status: 'invalid', reason: 'empty tool result' };
	if (value.schema === 'hackjudge.daytona.v1' || (value.status && !('output' in value))) return value;
	if (value.truncated) {
		return { status: 'truncated', reason: 'Daytona output truncated', tag: undefined, score: undefined };
	}
	const parsed = typeof value.output === 'string' ? parseJsonObject(value.output) : null;
	if (parsed) return parsed;
	if (value.error) return { status: 'unverifiable', reason: String(value.error).slice(0, 240) };
	return { status: 'invalid', reason: `exit ${value.exit_code}` };
}

async function invokeTool(client, token, tool, input, timeout = 600_000) {
	try {
		return await client.tool({ token, tool, nodeId: 'daytona_1', input, timeout });
	} catch (first) {
		return await client.tool({
			token, tool: `daytona.${tool}`, nodeId: 'daytona_1', input, timeout,
		}).catch(() => { throw first; });
	}
}

const PYTHON = 'sh -c "if command -v python3 >/dev/null 2>&1; then python3 hj/run_verify.py; elif command -v python >/dev/null 2>&1; then python hj/run_verify.py; else echo no-python; exit 127; fi"';

async function uploadBundle(client, token) {
	const mkdir = await invokeTool(client, token, 'run_command', { command: 'sh -c "mkdir -p hj/targets"' }, 30_000);
	if (mkdir && mkdir.error) throw new Error(mkdir.error);
	for (const [dest, abs] of BUNDLE) {
		const content = fs.readFileSync(abs, 'utf8');
		const up = await invokeTool(client, token, 'upload_file', { path: dest, content }, 120_000);
		if (up && (up.success === false || up.error)) throw new Error(up.error || `upload failed ${dest}`);
	}
}

async function verifyRepo(client, token, repo) {
	await invokeTool(client, token, 'upload_file', {
		path: 'hj/job.json',
		content: JSON.stringify({ repo, eventDate: '', historyPenalty: null, customTarget: null }),
	}, 30_000);
	const raw = await invokeTool(client, token, 'run_command', { command: PYTHON }, 600_000);
	return parseTool(raw);
}

async function closeToken(client, token) {
	if (!token) return;
	try { await client.terminate(token); } catch { /* already gone */ }
}

loadEnv(path.join(workspaceRoot, '.env'));

const t0 = Date.now();
const pipeline = JSON.parse(fs.readFileSync(path.join(appRoot, 'src', 'pipelines', 'hackjudge_daytona_v1.pipe'), 'utf8'));
const client = new RocketRideClient({ uri: mustEnv('ROCKETRIDE_URI'), auth: mustEnv('ROCKETRIDE_APIKEY') });
const info = await client.connect();
console.log(`probe user=${info.email || info.userId} workers=${WORKERS} repos=${REPOS.length}`);

let next = 0;
const rows = new Array(REPOS.length);
const bootFailures = [];

async function worker(id) {
	if (id > 0) await new Promise((r) => setTimeout(r, id * 200));
	const copy = JSON.parse(JSON.stringify(pipeline));
	copy.project_id = crypto.randomUUID();
	const started = await client.use({
		pipeline: copy,
		name: `Judge Hack load probe · ${id + 1}`,
		ttl: 1800,
	});
	const token = started.token;
	const bootMs = Date.now() - t0;
	try {
		const u0 = Date.now();
		await uploadBundle(client, token);
		console.log(`sandbox ${id + 1} ready in ${((Date.now() - u0) / 1000).toFixed(1)}s (boot+upload; wall ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
		while (true) {
			const i = next;
			next += 1;
			if (i >= REPOS.length) break;
			const repo = REPOS[i];
			const r0 = Date.now();
			console.log(`#${i + 1} sandbox ${id + 1} ${repo}`);
			try {
				const result = await verifyRepo(client, token, repo);
				const secs = (Date.now() - r0) / 1000;
				rows[i] = {
					repo,
					worker: id + 1,
					secs: Number(secs.toFixed(1)),
					status: result.status || '',
					tag: result.tag || '',
					backbone: result.backbone || '',
					score: result.score ?? '',
					called: `${result.pipelines_called ?? '?'}/${result.pipelines_total ?? '?'}`,
					reason: String(result.reason || '').slice(0, 160),
				};
				console.log(`  -> ${rows[i].status} ${rows[i].tag} ${rows[i].backbone} ${rows[i].score} ${secs.toFixed(1)}s`);
			} catch (err) {
				const secs = (Date.now() - r0) / 1000;
				rows[i] = {
					repo, worker: id + 1, secs: Number(secs.toFixed(1)),
					status: 'ERROR', tag: '', backbone: '', score: '', called: '',
					reason: (err instanceof Error ? err.message : String(err)).slice(0, 200),
				};
				console.log(`  -> ERROR ${rows[i].reason}`);
			}
		}
	} catch (err) {
		bootFailures.push(`sandbox ${id + 1}: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
		console.log(`sandbox ${id + 1} failed: ${bootFailures[bootFailures.length - 1]}`);
	} finally {
		await closeToken(client, token);
		void bootMs;
	}
}

try {
	await Promise.all(Array.from({ length: WORKERS }, (_, id) => worker(id)));
} finally {
	await client.disconnect();
}

const wall = (Date.now() - t0) / 1000;
const ok = rows.filter((r) => r && r.status === 'complete');
const failed = rows.filter((r) => r && r.status !== 'complete');
const sumSecs = rows.filter(Boolean).reduce((a, r) => a + r.secs, 0);
console.log('\n=== LOAD PROBE ===');
console.log(`wall ${wall.toFixed(1)}s  sum-of-repo ${sumSecs.toFixed(1)}s  speedup ${(sumSecs / Math.max(wall, 0.1)).toFixed(2)}x vs serial  workers ${WORKERS}`);
console.log(`complete ${ok.length}/${REPOS.length}  other ${failed.length}  sandbox boot fails ${bootFailures.length}`);
for (const r of rows) {
	if (!r) {
		console.log('(gap — sandbox never claimed this repo)');
		continue;
	}
	const slug = r.repo.replace('https://github.com/', '');
	console.log(`${slug.padEnd(48)} w${r.worker} ${String(r.secs).padStart(6)}s  ${r.status.padEnd(14)} ${String(r.tag).padEnd(12)} ${String(r.backbone).padEnd(4)} ${String(r.score).padStart(5)}  ${r.reason}`);
}
if (bootFailures.length) console.log(bootFailures.join('\n'));

const projected30 = wall * (30 / REPOS.length);
const projected50 = wall * (50 / REPOS.length);
console.log(`\nProjected Joe-sheet 30 @ ${WORKERS} workers: ~${(projected30 / 60).toFixed(1)} min`);
console.log(`Projected 50-repo batch: ~${(projected50 / 60).toFixed(1)} min`);
console.log('Custom node: not required if complete+fail-closed held and wall is judging-window OK.');
