import { describe, expect, it } from 'vitest';
import { rowToRun, rowToTarget, shouldImportAppState, jsonParam, pruneRunIds, SCHEMA_STATEMENTS } from '../src/verify/sqlSchema';

describe('sql schema mapping', () => {
	it('creates hj_runs and hj_targets without personal DSN fields', () => {
		const ddl = SCHEMA_STATEMENTS.join('\n');
		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS hj_runs');
		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS hj_targets');
		expect(ddl).not.toMatch(/host|password|DATABASE_URL/i);
	});

	it('maps a run row including JSON results', () => {
		const run = rowToRun({
			id: 'r1',
			name: 'MMM',
			event_date: '2024-06-03',
			status: 'done',
			target_name: 'RocketRide',
			results: [{ project: 'Hopper', tag: 'Significant', github: 'https://github.com/vraj00222/hopper' }],
			significant_count: 1,
			flagged_count: 0,
			done_count: 1,
			created_at: '2026-09-03T00:00:00.000Z',
			created_by: { userId: 'u1', email: 'a@b.c' },
		});
		expect(run?.name).toBe('MMM');
		expect(run?.results[0].project).toBe('Hopper');
		expect(run?.created_by?.userId).toBe('u1');
	});

	it('drops the RocketRide preset from target rows', () => {
		expect(rowToTarget({ id: 'rocketride', name: 'RocketRide', config: {} })).toBeNull();
		expect(rowToTarget({ id: 't1', name: 'Acme', config: '{"x":1}' })?.config).toEqual({ x: 1 });
	});

	it('imports appState only when SQL is empty', () => {
		expect(shouldImportAppState(0, 0, 1, 0)).toBe(true);
		expect(shouldImportAppState(1, 0, 4, 2)).toBe(false);
		expect(shouldImportAppState(0, 0, 0, 0)).toBe(false);
	});

	it('keeps the newest 40 run ids', () => {
		const ids = Array.from({ length: 42 }, (_, i) => `r${i}`);
		expect(pruneRunIds(ids, 40)).toEqual(['r40', 'r41']);
		expect(jsonParam({ a: 1 })).toBe('{"a":1}');
	});
});
