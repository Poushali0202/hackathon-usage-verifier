/**
 * Release 10/20 test for server#2575: tool_http_request config-level auth,
 * pinned whitelist, default headers. Runs the node on the STAGING engine via
 * an inline pipeline (no deploy artifacts) and prints pass/fail per check.
 * Never prints real secret values: ${ROCKETRIDE_GITHUB_TOKEN} resolves on the
 * engine; the only literal tokens here are invented dummies.
 *
 *   node tools/http-auth-probe.mjs --target staging
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertTarget, devPair, findWorkspaceRoot, hostOf, loadWorkspaceEnv, requireTarget } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = findWorkspaceRoot(appRoot);
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride');

loadWorkspaceEnv(path.join(workspaceRoot, '.env'));
const target = requireTarget(process.argv.slice(2), 'the #2575 http auth probe');
const { uri: devUri, auth: devKey } = devPair();
assertTarget(target, devUri, 'development connection');
console.log(`[dev] host=${hostOf(devUri)} target=${target}`);

const GH_WL = [{ whitelistPattern: '^https://api\\.github\\.com(?:/|$)' }];
const base = JSON.parse(fs.readFileSync(path.join(appRoot, 'src', 'pipelines', 'hackjudge_python_v1.pipe'), 'utf8'));

function httpNode(id, serverName, config) {
	return {
		id,
		provider: 'tool_http_request',
		config: {
			type: 'tool_http_request', serverName,
			allowGET: true, allowPOST: false, allowPUT: false, allowPATCH: false,
			allowDELETE: false, allowHEAD: false, allowOPTIONS: false,
			rateLimitPerSecond: 20, rateLimitPerMinute: 900, maxConcurrentRequests: 8,
			...config,
		},
		control: [{ classType: 'tool', from: 'agent_1' }],
	};
}

const nodes = [
	httpNode('http_cfg', 'cfg', {
		authType: 'bearer', authToken: '${ROCKETRIDE_GITHUB_TOKEN}', urlWhitelist: GH_WL,
		defaultHeaders: [
			{ headerName: 'Accept', headerValue: 'application/vnd.github+json' },
			{ headerName: 'X-GitHub-Api-Version', headerValue: '2022-11-28' },
		],
	}),
	httpNode('http_echo', 'echo', {
		authType: 'bearer', authToken: 'hj-2575-dummy-not-a-secret',
		urlWhitelist: [{ whitelistPattern: '^https://httpbin\\.org(?:/|$)' }],
		defaultHeaders: [{ headerName: 'X-HJ-Default', headerValue: 'carried-2575' }],
	}),
	httpNode('http_bad', 'bad', { authType: 'bearer', authToken: 'hj-2575-invalid-token', urlWhitelist: GH_WL }),
	httpNode('http_anon', 'anon', { authType: 'none', urlWhitelist: GH_WL }),
];

const pipeline = JSON.parse(JSON.stringify(base));
pipeline.name = 'HTTP auth probe 2575';
pipeline.project_id = crypto.randomUUID();
pipeline.components = pipeline.components.filter((c) => c.provider !== 'tool_http_request').concat(nodes);

const client = new RocketRideClient({ uri: devUri, auth: devKey });
const info = await client.connect();
console.log(`probe user=${info.email || info.userId} org=${info.organization?.name || info.organization?.id || 'none'}`);

const validated = await client.validate({ pipeline });
if ((validated.errors || []).length) {
	console.error('validate errors:', JSON.stringify(validated.errors));
	await client.disconnect();
	process.exit(1);
}
console.log(`validate ok (${(validated.warnings || []).length} warnings)`);

const results = [];
function record(name, pass, detail) {
	results.push({ name, pass, detail });
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

async function call(token, nodeId, input) {
	for (const tool of ['http_request', `${nodes.find((n) => n.id === nodeId).config.serverName}.http_request`]) {
		try {
			return { ok: true, result: await client.tool({ token, tool, nodeId, input, timeout: 45_000 }) };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (/no handler|unknown tool|not found/i.test(msg)) continue;
			return { ok: false, error: msg };
		}
	}
	return { ok: false, error: 'no tool handler matched' };
}

function bodyOf(result) {
	const r = result || {};
	const body = r.body ?? r.output ?? r.data ?? r;
	if (typeof body === 'string') { try { return JSON.parse(body); } catch { return body; } }
	return body;
}
function headersOf(result) {
	const h = (result && (result.headers || result.response_headers)) || {};
	const out = {};
	for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
	return out;
}

let token;
try {
	const started = await client.use({ pipeline, name: 'HTTP auth probe 2575', ttl: 300 });
	token = started.token;

	// 1. anonymous control: no config auth -> GitHub rate limit 60
	{
		const r = await call(token, 'http_anon', { url: 'https://api.github.com/rate_limit', method: 'GET', timeout: 30 });
		const limit = r.ok ? bodyOf(r.result)?.resources?.core?.limit ?? bodyOf(r.result)?.rate?.limit : null;
		record('1 anon control: limit 60', r.ok && Number(limit) === 60, r.ok ? `core.limit=${limit}` : r.error);
	}

	// 2. config bearer ${ROCKETRIDE_GITHUB_TOKEN}: authenticated limit 5000 + default header selected
	{
		const r = await call(token, 'http_cfg', { url: 'https://api.github.com/rate_limit', method: 'GET', timeout: 30 });
		const limit = r.ok ? bodyOf(r.result)?.resources?.core?.limit ?? bodyOf(r.result)?.rate?.limit : null;
		const ver = r.ok ? headersOf(r.result)['x-github-api-version-selected'] : null;
		record('2 config bearer via env: limit 5000', r.ok && Number(limit) >= 5000, r.ok ? `core.limit=${limit}` : r.error);
		record('2b default header reached GitHub', ver === '2022-11-28', `x-github-api-version-selected=${ver}`);
	}

	// 3. header carriage, literal evidence: httpbin echoes Authorization + default header
	{
		const r = await call(token, 'http_echo', { url: 'https://httpbin.org/headers', method: 'GET', timeout: 30 });
		const echoed = r.ok ? bodyOf(r.result)?.headers || {} : {};
		const auth = echoed.Authorization || echoed.authorization || '';
		const dflt = echoed['X-Hj-Default'] || echoed['x-hj-default'] || '';
		record('3 Authorization carried', auth === 'Bearer hj-2575-dummy-not-a-secret', r.ok ? `Authorization=${auth}` : r.error);
		record('3b default header carried', dflt === 'carried-2575', `X-HJ-Default=${dflt}`);
	}

	// 3c. per-call header overrides the default (case-insensitive)
	{
		const r = await call(token, 'http_echo', { url: 'https://httpbin.org/headers', method: 'GET', timeout: 30, headers: { 'x-hj-default': 'override-wins' } });
		const echoed = r.ok ? bodyOf(r.result)?.headers || {} : {};
		const dflt = echoed['X-Hj-Default'] || echoed['x-hj-default'] || '';
		record('3c per-call header overrides default', dflt === 'override-wins', `X-HJ-Default=${dflt}`);
	}

	// 4. whitelist: a URL outside the pinned host is refused
	{
		const r = await call(token, 'http_cfg', { url: 'https://example.com/', method: 'GET', timeout: 30 });
		const refused = !r.ok || /whitelist|not allowed|refused|blocked|does not match/i.test(JSON.stringify(r.result ?? r.error ?? ''));
		record('4 non-whitelisted URL refused', refused, (r.ok ? JSON.stringify(r.result).slice(0, 160) : r.error || '').slice(0, 160));
	}

	// 5. per-call credential rejected while config auth is set
	{
		const r = await call(token, 'http_cfg', { url: 'https://api.github.com/rate_limit', method: 'GET', timeout: 30, bearer_token: 'attacker-swap-attempt' });
		const rejected = !r.ok || /reject|not allowed|configured|credential/i.test(JSON.stringify(r.result ?? r.error ?? ''));
		record('5 per-call bearer rejected', rejected, (r.ok ? JSON.stringify(r.result).slice(0, 160) : r.error || '').slice(0, 160));
	}

	// 6. invalid config token is ATTACHED (401), not silently dropped (the old #2495 bug)
	{
		const r = await call(token, 'http_bad', { url: 'https://api.github.com/rate_limit', method: 'GET', timeout: 30 });
		const s = JSON.stringify(r.result ?? r.error ?? '');
		const got401 = /401|Bad credentials/i.test(s) || (r.ok && Number(r.result?.status) === 401);
		record('6 invalid config token -> 401 (attached, not dropped)', got401, s.slice(0, 160));
	}
} catch (err) {
	console.error('probe run failed:', err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	if (token) { try { await client.terminate(token); } catch { /* already gone */ } }
}

// 7. unresolved placeholder fails at startup naming the variable (separate pipe: it must not start)
{
	const broken = JSON.parse(JSON.stringify(base));
	broken.name = 'HTTP auth probe 2575 missing-env';
	broken.project_id = crypto.randomUUID();
	broken.components = broken.components.filter((c) => c.provider !== 'tool_http_request')
		.concat([httpNode('http_missing', 'missing', { authType: 'bearer', authToken: '${ROCKETRIDE_HJ_MISSING_2575}', urlWhitelist: GH_WL })]);
	let failedAtStart = false, detail = 'pipeline started (unexpected)';
	let t2;
	try {
		const started = await client.use({ pipeline: broken, name: broken.name, ttl: 60 });
		t2 = started.token;
		// some engines surface the failure on first call instead of start
		const r = await call(t2, 'http_missing', { url: 'https://api.github.com/rate_limit', method: 'GET', timeout: 20 });
		if (!r.ok && /ROCKETRIDE_HJ_MISSING_2575|unresolved|placeholder|not set/i.test(r.error || '')) { failedAtStart = true; detail = r.error.slice(0, 160); }
		else detail = (r.ok ? JSON.stringify(r.result) : r.error || '').slice(0, 160);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		failedAtStart = /ROCKETRIDE_HJ_MISSING_2575|unresolved|placeholder|not set|failed/i.test(msg);
		detail = msg.slice(0, 160);
	} finally {
		if (t2) { try { await client.terminate(t2); } catch { /* gone */ } }
	}
	record('7 unresolved placeholder fails, names the variable', failedAtStart, detail);
}

await client.disconnect();
const failed = results.filter((r) => !r.pass);
console.log(`\n#2575 staging probe: ${results.length - failed.length}/${results.length} checks passed${failed.length ? ' - FAILURES: ' + failed.map((f) => f.name).join('; ') : ''}`);
process.exitCode = failed.length ? 1 : 0;
