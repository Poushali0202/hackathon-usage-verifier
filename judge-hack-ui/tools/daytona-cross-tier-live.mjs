/**
 * Live two-judge probe on the org Daytona key (same pool the dashboard shows).
 * Does not print secrets. Boots Developer(2) + Company(3), then Company(3) + Organizers(3).
 *
 *   node tools/daytona-cross-tier-live.mjs
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

function mustEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing ${name} in workspace .env`);
	return value;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCpuLimit(message) {
	return /cpu limit exceeded|concurrency limits|maximum allowed:\s*\d+|app\.daytona\.io\/dashboard\/limits/i.test(message || '');
}

loadEnv(path.join(workspaceRoot, '.env'));

const pipeline = JSON.parse(fs.readFileSync(path.join(appRoot, 'src', 'pipelines', 'hackjudge_daytona_v1.pipe'), 'utf8'));
const client = new RocketRideClient({ uri: mustEnv('ROCKETRIDE_URI'), auth: mustEnv('ROCKETRIDE_APIKEY') });
const info = await client.connect();
console.log(`live user=${info.email || info.userId} org-pipe=hackjudge_daytona_v1`);

async function closeToken(token) {
	if (!token) return;
	try { await client.terminate(token); } catch { /* already gone */ }
}

async function bootJudge(label, workers) {
	const ok = [];
	const fail = [];
	await Promise.all(Array.from({ length: workers }, async (_, id) => {
		if (id > 0) await sleep(id * 200);
		const copy = JSON.parse(JSON.stringify(pipeline));
		copy.project_id = crypto.randomUUID();
		try {
			const started = await client.use({
				pipeline: copy,
				name: `HJ live ${label} · ${id + 1}`,
				ttl: 240,
			});
			ok.push({ label, worker: id + 1, token: started.token, project_id: copy.project_id.slice(0, 8) });
			console.log(`BOOT_OK ${label} w${id + 1} project ${copy.project_id.slice(0, 8)}`);
		} catch (err) {
			const message = (err instanceof Error ? err.message : String(err)).slice(0, 220);
			fail.push({ label, worker: id + 1, cpu: isCpuLimit(message), message });
			console.log(`BOOT_FAIL ${label} w${id + 1} cpu=${isCpuLimit(message)} ${message}`);
		}
	}));
	return { label, asked: workers, ok, fail };
}

async function phase(title, a, b) {
	console.log(`\n=== ${title} ===`);
	const t0 = Date.now();
	const [left, right] = await Promise.all([
		bootJudge(a.label, a.workers),
		bootJudge(b.label, b.workers),
	]);
	const live = left.ok.length + right.ok.length;
	console.log(`overlap_window_s=8 live_sandboxes=${live} (asked ${left.asked}+${right.asked})`);
	await sleep(8000);
	const tokens = [...left.ok, ...right.ok].map((row) => row.token);
	await Promise.all(tokens.map((token) => closeToken(token)));
	console.log(`terminated=${tokens.length} wall_s=${((Date.now() - t0) / 1000).toFixed(1)}`);
	return { left, right, live };
}

try {
	console.log('\n=== Hold Developer 2 + Company 3, then Organizers 3 (true overflow) ===');
	const held = await Promise.all([
		bootJudge('developer', 2),
		bootJudge('company', 3),
	]);
	const heldOk = [...held[0].ok, ...held[1].ok];
	console.log(`held_live=${heldOk.length}/5 — opening organizers 3 without releasing`);
	const extra = await bootJudge('organizers', 3);
	const totalLive = heldOk.length + extra.ok.length;
	const extraCpu = extra.fail.filter((f) => f.cpu).length;
	console.log(`peak_live=${totalLive} extra_ok=${extra.ok.length}/3 extra_cpu_fail=${extraCpu}`);
	await sleep(5000);
	await Promise.all([...heldOk, ...extra.ok].map((row) => closeToken(row.token)));
	console.log(`terminated=${heldOk.length + extra.ok.length}`);

	console.log('\n=== LIVE CROSS-TIER ===');
	console.log(`held5: dev_ok=${held[0].ok.length}/2 company_ok=${held[1].ok.length}/3`);
	console.log(`then organizers3: extra_ok=${extra.ok.length}/3 extra_cpu_fail=${extraCpu} peak_live=${totalLive}`);
	if (held[0].ok.length > 2) console.log('DISCREPANCY: Developer opened more than 2 sandboxes');
	if (held[1].ok.length > 3 || extra.ok.length > 3) console.log('DISCREPANCY: a 3-cap plan opened more than 3');
	if (totalLive > 5) console.log('DISCREPANCY: org live sandboxes exceeded the assumed 10 vCPU / 5-box starter pool while 5 were held');
	if (extraCpu > 0) console.log('ORG_CAP_HIT: Daytona denied extra boxes with CPU-limit while first five were held');
} finally {
	await client.disconnect();
}
