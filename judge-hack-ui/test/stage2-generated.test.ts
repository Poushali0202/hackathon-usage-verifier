import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RESTRICTED_BUNDLE } from '../src/verify/generated/evaluatorBundle';
import { buildCode, PYTHON_NODE_ID } from '../src/verify/pythonInvoke';
import { FETCH_CONCURRENCY, HTTP_NODE_ID } from '../src/verify/replay';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PYTHON_ID = '3f6b9d2e-5c41-4a8f-9e07-6d2b8c1a4f53';
const EXPLAIN_ID = 'cf2762a0-ee71-4f77-9d99-1296e81e71b4';
const SQL_ID = '8e2a6c14-b7f1-4d93-9a50-1c4e8f2d7b36';

function firstKey(file: string): string {
	const raw = fs.readFileSync(file, 'utf8');
	const match = raw.match(/\{\s*"([^"]+)"/);
	if (!match) throw new Error(`Could not read first key of ${file}`);
	return match[1];
}

describe('generated pipes', () => {
	const canonical = path.join(appRoot, 'src', 'pipelines');

	it('puts components first and keeps stable project_ids', () => {
		const pythonFile = path.join(canonical, 'hackjudge_python_v1.pipe');
		const explainFile = path.join(canonical, 'hackjudge_explain_v1.pipe');
		const sqlFile = path.join(canonical, 'hackjudge_sql_v1.pipe');
		expect(firstKey(pythonFile)).toBe('components');
		expect(firstKey(explainFile)).toBe('components');
		expect(firstKey(sqlFile)).toBe('components');
		expect(JSON.parse(fs.readFileSync(pythonFile, 'utf8')).project_id).toBe(PYTHON_ID);
		expect(JSON.parse(fs.readFileSync(explainFile, 'utf8')).project_id).toBe(EXPLAIN_ID);
		expect(JSON.parse(fs.readFileSync(sqlFile, 'utf8')).project_id).toBe(SQL_ID);
	});

	it('the Daytona pipe is gone', () => {
		expect(fs.existsSync(path.join(canonical, 'hackjudge_daytona_v1.pipe'))).toBe(false);
	});

	it('evaluator pipe hosts tool_python with the fetch modules and no secrets', () => {
		const pipe = JSON.parse(fs.readFileSync(path.join(canonical, 'hackjudge_python_v1.pipe'), 'utf8'));
		const node = pipe.components.find((c: { id: string }) => c.id === PYTHON_NODE_ID);
		expect(node.provider).toBe('tool_python');
		expect(node.config.serverName).toBe('python');
		expect(node.config.timeout).toBeLessThanOrEqual(1200);
		expect(node.config.allowedModules).toEqual([{ moduleName: 'urllib' }, { moduleName: 'html' }]);
		const body = JSON.stringify(pipe);
		expect(body).not.toMatch(/tool_daytona|DAYTONA|GITHUB_TOKEN/);
		expect(body).not.toMatch(/sk-|rr_[0-9a-f]{8}|ghp_[A-Za-z0-9]{10}/i);
	});

	it('evaluator pipe hosts a GET-only tool_http_request fetcher for replay mode', () => {
		const pipe = JSON.parse(fs.readFileSync(path.join(canonical, 'hackjudge_python_v1.pipe'), 'utf8'));
		const node = pipe.components.find((c: { id: string }) => c.id === HTTP_NODE_ID);
		expect(node.provider).toBe('tool_http_request');
		expect(node.config.allowGET).toBe(true);
		for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(node.config[`allow${m}`]).toBe(false);
		expect(node.config.maxConcurrentRequests).toBeGreaterThanOrEqual(FETCH_CONCURRENCY);
		expect(JSON.stringify(node.config)).not.toMatch(/token|bearer/i);
	});

	it('explain pipe references the Anthropic key by placeholder only', () => {
		const body = fs.readFileSync(path.join(canonical, 'hackjudge_explain_v1.pipe'), 'utf8');
		expect(body).toContain('${ROCKETRIDE_ANTHROPIC_KEY}');
		expect(body).not.toMatch(/sk-|rr_[0-9a-f]{8}/i);
	});

	it('SQL pipe uses rocketride_sql with execute on; the personal-Postgres fallback is gone', () => {
		const sql = JSON.parse(fs.readFileSync(path.join(canonical, 'hackjudge_sql_v1.pipe'), 'utf8'));
		const node = sql.components.find((c: { id: string }) => c.id === 'sql_1');
		expect(node.provider).toBe('rocketride_sql');
		expect(node.config.default.allow_execute).toBe(true);
		expect(JSON.stringify(node)).not.toMatch(/host|password/);
		expect(fs.existsSync(path.join(canonical, 'hackjudge_sql_v1.external.pipe'))).toBe(false);
	});
});

describe('restricted evaluator bundle', () => {
	it('ships the flat RestrictedPython script with both drivers', () => {
		expect(RESTRICTED_BUNDLE.length).toBeGreaterThan(20_000);
		expect(RESTRICTED_BUNDLE).toMatch(/^def run_verify\(job, token, cache=None\):/m);
		expect(RESTRICTED_BUNDLE).toMatch(/^def run_extract\(job, token, cache=None\):/m);
		expect(RESTRICTED_BUNDLE).toMatch(/^def gather\(/m);
		expect(RESTRICTED_BUNDLE).toMatch(/^def evaluate\(/m);
		expect(RESTRICTED_BUNDLE).toContain('hackjudge.python.v1');
	});

	it('imports urllib/html only behind the guarded shim so it runs with the default allowlist', () => {
		const code = RESTRICTED_BUNDLE.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
		const urllibImports = code.match(/^\s*(from urllib|import urllib|import html\b|from html\b)/gm) || [];
		// exactly the guarded imports in the shim's try-blocks; none left inside engine/extract functions
		expect(urllibImports.length).toBe(4);
		expect(code).toMatch(/^except ImportError:\n\s+HAVE_URLLIB = False$/m);
		expect(code).toMatch(/^def make_cache_gh\(/m);
		expect(code).toMatch(/"status": "need_fetch"/);
	});

	it('contains no clone, subprocess, or filesystem access', () => {
		const code = RESTRICTED_BUNDLE.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
		expect(code).not.toMatch(/\bsubprocess\b|\bgit clone\b|\bimport (os|sys|shutil|pathlib)\b|\bopen\(/);
		expect(code).not.toMatch(/^\s*nonlocal\b/m);
		expect(code).not.toMatch(/\.format\(/);
		expect(RESTRICTED_BUNDLE).not.toContain('\r');
	});

	it('buildCode appends job and token as literals only', () => {
		const code = buildCode('run_verify', { repo: 'https://github.com/a/b "quoted"\nline' }, 'tok"en');
		expect(code.startsWith(RESTRICTED_BUNDLE)).toBe(true);
		expect(code).toContain('JOB = json.loads(');
		expect(code).toContain('TOKEN = "tok\\"en"');
		expect(code).toContain('\nCACHE = None\n');
		expect(code.trimEnd().endsWith('result = run_verify(JOB, TOKEN, CACHE)')).toBe(true);
		expect(code.split('\n').filter((l) => l.startsWith('JOB = ')).length).toBe(1);
	});

	it('buildCode ships the replay cache as one JSON literal', () => {
		const cache = { 'https://api.github.com/repos/a/b': [200, '{"default_branch":"main"}'] as [number, string] };
		const code = buildCode('run_extract', { repoUrl: 'https://github.com/a/b' }, '', cache);
		const line = code.split('\n').find((l) => l.startsWith('CACHE = '))!;
		expect(line.startsWith('CACHE = json.loads(')).toBe(true);
		expect(JSON.parse(JSON.parse(line.slice('CACHE = json.loads('.length, -1)))).toEqual(cache);
		expect(code.trimEnd().endsWith('result = run_extract(JOB, TOKEN, CACHE)')).toBe(true);
	});
});
