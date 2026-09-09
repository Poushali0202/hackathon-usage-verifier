import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVALUATOR_BUNDLE } from '../src/verify/generated/evaluatorBundle';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DAYTONA_ID = 'bde4acbb-7db2-4a97-8d01-28214a1bc284';
const EXPLAIN_ID = 'cf2762a0-ee71-4f77-9d99-1296e81e71b4';
const SQL_ID = '8e2a6c14-b7f1-4d93-9a50-1c4e8f2d7b36';
const SQL_EXTERNAL_ID = 'c5d9e2b8-1a47-4f06-8d3c-9b7e0a4f2c18';

function firstKey(file: string): string {
	const raw = fs.readFileSync(file, 'utf8');
	const match = raw.match(/\{\s*"([^"]+)"/);
	if (!match) throw new Error(`Could not read first key of ${file}`);
	return match[1];
}

describe('generated pipes', () => {
	const canonical = path.join(appRoot, 'src', 'pipelines');

	it('puts components first and keeps stable project_ids', () => {
		const daytonaFile = path.join(canonical, 'hackjudge_daytona_v1.pipe');
		const explainFile = path.join(canonical, 'hackjudge_explain_v1.pipe');
		const sqlFile = path.join(canonical, 'hackjudge_sql_v1.pipe');
		expect(firstKey(daytonaFile)).toBe('components');
		expect(firstKey(explainFile)).toBe('components');
		expect(firstKey(sqlFile)).toBe('components');
		expect(JSON.parse(fs.readFileSync(daytonaFile, 'utf8')).project_id).toBe(DAYTONA_ID);
		expect(JSON.parse(fs.readFileSync(explainFile, 'utf8')).project_id).toBe(EXPLAIN_ID);
		expect(JSON.parse(fs.readFileSync(sqlFile, 'utf8')).project_id).toBe(SQL_ID);
	});

	it('does not put secrets in the pipe files', () => {
		const body = fs.readFileSync(path.join(appRoot, 'src', 'pipelines', 'hackjudge_daytona_v1.pipe'), 'utf8');
		expect(body).toContain('${ROCKETRIDE_DAYTONA_KEY}');
		expect(body).toContain('${ROCKETRIDE_ANTHROPIC_KEY}');
		expect(body).toContain('${ROCKETRIDE_GITHUB_TOKEN}');
		expect(body).not.toMatch(/sk-|rr_[0-9a-f]{8}/i);
	});

	it('SQL default uses rocketride_sql with execute on; external is generated not deployed', () => {
		const sql = JSON.parse(fs.readFileSync(path.join(canonical, 'hackjudge_sql_v1.pipe'), 'utf8'));
		const ext = JSON.parse(fs.readFileSync(path.join(canonical, 'hackjudge_sql_v1.external.pipe'), 'utf8'));
		const node = sql.components.find((c: { id: string }) => c.id === 'sql_1');
		const extNode = ext.components.find((c: { id: string }) => c.id === 'sql_1');
		expect(node.provider).toBe('rocketride_sql');
		expect(node.config.default.allow_execute).toBe(true);
		expect(JSON.stringify(node)).not.toMatch(/host|password/);
		expect(ext.project_id).toBe(SQL_EXTERNAL_ID);
		expect(extNode.provider).toBe('db_postgres');
		expect(extNode.id).toBe(node.id);
		expect(JSON.stringify(extNode)).toContain('${ROCKETRIDE_HACKJUDGE_PG_HOST}');
		expect(JSON.stringify(extNode)).not.toMatch(/sk-|rr_[0-9a-f]{8}/i);
	});
});

describe('evaluator bundle', () => {
	it('ships in-app strings for every sandbox file', () => {
		expect(EVALUATOR_BUNDLE.map(([name]) => name)).toEqual([
			'hj/engine.py',
			'hj/target.py',
			'hj/targets/rocketride.json',
			'hj/sandbox_github.py',
			'hj/run_batch.py',
			'hj/run_verify.py',
			'hj/extract.py',
			'hj/run_extract.py',
		]);
		for (const [, content] of EVALUATOR_BUNDLE) {
			expect(content.length).toBeGreaterThan(40);
		}
	});
});
