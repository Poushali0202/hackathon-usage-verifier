import { describe, expect, it } from 'vitest';
import {
	SCHEMA_MIGRATIONS,
	SCHEMA_STATEMENTS,
	RUN_META_COLUMNS,
	assertReadOnlySql,
	asResults,
	attachRunItems,
	belongsToUser,
	filterOwned,
	jsonParam,
	mergeRuns,
	pickRicherRun,
	pickStoreRows,
	readTenantMeterKb,
	readTenantRuns,
	readTenantTargets,
	resultTotal,
	pruneRunIds,
	rowToRun,
	rowToTarget,
	settleOrphanedRuns,
	shouldImportAppState,
	shouldRepairRun,
	stampOwner,
	writeTenantState,
} from '../src/verify/sqlSchema';
import type { StoredRun } from '../src/types';

function run(partial: Partial<StoredRun> & Pick<StoredRun, 'id'>): StoredRun {
	return {
		name: partial.name || 'Run',
		event_date: '2026-08-03',
		history_penalty: 2,
		target_name: 'RocketRide',
		status: 'done',
		results: [],
		total: 30,
		significant_count: 0,
		flagged_count: 0,
		done_count: 0,
		created_at: '2026-09-10T18:20:00.000Z',
		...partial,
	};
}

describe('sql schema mapping', () => {
	it('avoids SQLAlchemy :bind tokens in DDL (Postgres ::casts)', () => {
		const ddl = [...SCHEMA_STATEMENTS, ...SCHEMA_MIGRATIONS].join('\n');
		expect(ddl).not.toMatch(/::/);
		expect(ddl).toContain("CAST('{}' AS jsonb)");
		expect(ddl).toContain("CAST('[]' AS jsonb)");
		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS hj_run_items');
		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS hj_sandbox_leases');
		expect(ddl).toContain('owner_user_id');
		expect(SCHEMA_MIGRATIONS.join('\n')).toContain('hj_runs_owner_created_at_idx');
	});

	it('creates hj_runs and hj_targets without personal DSN fields', () => {
		const ddl = SCHEMA_STATEMENTS.join('\n');
		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS hj_runs');
		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS hj_targets');
		expect(ddl).not.toMatch(/host|password|DATABASE_URL/i);
	});

	it('maps owner_user_id on run and target rows', () => {
		const mapped = rowToRun({
			id: 'r1',
			name: 'MMM',
			event_date: '2024-06-03',
			status: 'done',
			target_name: 'RocketRide',
			results: [],
			owner_user_id: 'u1',
			created_by: { userId: 'u1', email: 'a@b.c' },
		});
		expect(mapped?.owner_user_id).toBe('u1');
		expect(rowToTarget({ id: 't1', name: 'Acme', config: {}, owner_user_id: 'u2' })?.owner_user_id).toBe('u2');
	});

	it('filters rows to the signed-in owner', () => {
		const a = run({ id: 'a', owner_user_id: 'u1' });
		const b = run({ id: 'b', owner_user_id: 'u2' });
		const inferred = run({ id: 'c', created_by: { userId: 'u1' } });
		expect(filterOwned([a, b, inferred], 'u1').map((r) => r.id)).toEqual(['a', 'c']);
		expect(filterOwned([a, b], undefined)).toEqual([]);
		expect(belongsToUser(a, 'u1')).toBe(true);
		expect(belongsToUser(b, 'u1')).toBe(false);
		expect(stampOwner(run({ id: 'n' }), 'u9').owner_user_id).toBe('u9');
	});

	it('namespaces workspace appState per user without clobbering other tenants', () => {
		const shared = {
			runs: [run({ id: 'old', owner_user_id: 'u1' }), run({ id: 'other', owner_user_id: 'u2' })],
			targets: [{ id: 't1', name: 'Acme', config: {}, owner_user_id: 'u1' }],
		};
		expect(readTenantRuns(shared, 'u1').map((r) => r.id)).toEqual(['old']);
		expect(readTenantRuns(shared, 'u2').map((r) => r.id)).toEqual(['other']);
		expect(readTenantRuns(shared, undefined)).toEqual([]);
		const written = writeTenantState(shared, 'u1', [run({ id: 'mine' })], [{ id: 't9', name: 'Solo', config: {} }], 1500);
		expect(readTenantRuns(written, 'u1').map((r) => r.id)).toEqual(['mine']);
		expect(readTenantRuns(written, 'u2').map((r) => r.id)).toEqual(['other']);
		expect(readTenantTargets(written, 'u1').map((t) => t.id)).toEqual(['t9']);
		expect((written.tenant as Record<string, unknown>).u1).toBeTruthy();
		expect(readTenantMeterKb(written, 'u1')).toBe(1500);
		const preserved = writeTenantState(written, 'u1', [run({ id: 'mine' })], [{ id: 't9', name: 'Solo', config: {} }]);
		expect(readTenantMeterKb(preserved, 'u1')).toBe(1500);
	});

	it('lists metadata without the results blob', () => {
		expect(RUN_META_COLUMNS).toContain('id');
		expect(RUN_META_COLUMNS).toContain('status');
		expect(RUN_META_COLUMNS.split(',').map((s) => s.trim())).not.toContain('results');
	});

	it('maps a run row including JSON results', () => {
		const mapped = rowToRun({
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
		expect(mapped?.name).toBe('MMM');
		expect(mapped?.results[0].project).toBe('Hopper');
		expect(mapped?.created_by?.userId).toBe('u1');
	});

	it('parses double-encoded and numeric-key JSONB shapes', () => {
		expect(asResults('[{"project":"A"}]')[0].project).toBe('A');
		expect(asResults(JSON.stringify([{ project: 'B' }]))[0].project).toBe('B');
		expect(asResults({ 0: { project: 'C' }, 1: { project: 'D' } }).map((r) => r.project)).toEqual(['C', 'D']);
	});

	it('reattaches per-repo items onto metadata rows', () => {
		const meta = [run({ id: 'm3m', name: 'M3M', results: [], done_count: 0 })];
		const filled = attachRunItems(meta, [
			{ run_id: 'm3m', idx: 0, item: { project: 'Hopper', tag: 'Significant' } },
			{ run_id: 'm3m', idx: 1, item: { project: 'Other', tag: 'None' } },
		]);
		expect(filled[0].results).toHaveLength(2);
		expect(filled[0].done_count).toBe(2);
		expect(filled[0].results[0].project).toBe('Hopper');
	});

	it('does not let a later empty SQL hydrate wipe a filled grid', () => {
		const sqlShell = run({ id: 'mmm', name: 'MMM', status: 'stopped', results: [], done_count: 0, total: 30 });
		const filled = run({
			id: 'mmm',
			name: 'MMM',
			status: 'stopped',
			results: [{ project: 'Hopper', tag: 'Significant' }, { project: 'Other', tag: 'None' }],
			done_count: 2,
			total: 30,
		});
		const afterHydrate = mergeRuns([sqlShell], [filled]);
		const afterReconnect = mergeRuns(afterHydrate, [sqlShell]);
		expect(afterReconnect[0].results).toHaveLength(2);
		expect(resultTotal(afterReconnect)).toBe(2);
		expect(pickRicherRun(sqlShell, filled)?.results).toHaveLength(2);
	});

	it('keeps workspace verdicts when SQL only has an empty shell', () => {
		const sql = run({ id: 'm3m', name: 'M3M', status: 'done', results: [], done_count: 0 });
		const local = run({
			id: 'm3m',
			name: 'M3M',
			status: 'done',
			results: [{ project: 'Hopper', tag: 'Significant' }],
			done_count: 1,
		});
		const merged = mergeRuns([sql], [local]);
		expect(merged).toHaveLength(1);
		expect(merged[0].results[0].project).toBe('Hopper');
		expect(shouldRepairRun(sql, merged[0])).toBe(true);
		expect(shouldRepairRun(
			run({ id: 'm3m', status: 'running', results: [] }),
			run({ id: 'm3m', status: 'stopped', results: [] }),
		)).toBe(false);
	});

	it('marks orphaned running rows as stopped', () => {
		const live = run({ id: 'live', status: 'running', results: [] });
		const stale = run({ id: 'stale', status: 'running', name: 'MMM', results: [] });
		const settled = settleOrphanedRuns([live, stale], 'live');
		expect(settled.find((r) => r.id === 'live')?.status).toBe('running');
		expect(settled.find((r) => r.id === 'stale')?.status).toBe('stopped');
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

	it('does not drop workspace rows when SQL returns empty', () => {
		const local = [{ id: 'keep' }];
		expect(pickStoreRows([{ id: 'sql' }], local)).toEqual([{ id: 'sql' }]);
		expect(pickStoreRows([], local)).toEqual(local);
		expect(pickStoreRows([], [])).toEqual([]);
	});

	it('keeps the newest 40 run ids', () => {
		const ids = Array.from({ length: 42 }, (_, i) => `r${i}`);
		expect(pruneRunIds(ids, 40)).toEqual(['r40', 'r41']);
		expect(jsonParam({ a: 1 })).toBe('{"a":1}');
	});

	it('allows read-only SELECT and rejects writes and :: casts', () => {
		expect(assertReadOnlySql('SELECT id, name FROM hj_runs')).toContain('hj_runs');
		expect(() => assertReadOnlySql('DELETE FROM hj_runs')).toThrow(/SELECT|Write/);
		expect(() => assertReadOnlySql("SELECT results::jsonb FROM hj_runs")).toThrow(/CAST/);
	});
});
