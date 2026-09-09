import type { PipelineConfig } from 'rocketride';
import type { StoredRun, TargetRecord } from '../types';
import { clonePipelineForSandbox } from './pool';
import {
	MAX_SQL_RUNS,
	SCHEMA_STATEMENTS,
	SQL_NODE_ID,
	jsonParam,
	pruneRunIds,
	rowToRun,
	rowToTarget,
	shouldImportAppState,
} from './sqlSchema';
import sqlDefault from '../pipelines/hackjudge_sql_v1.pipe';
import sqlExternal from '../pipelines/hackjudge_sql_v1.external.pipe';

export { SQL_NODE_ID, shouldImportAppState };

export type StoreVariant = 'default' | 'external';

export type SqlClient = {
	use: (opts: { pipeline: PipelineConfig; name: string; ttl: number }) => Promise<{ token: string }>;
	terminate: (token: string) => Promise<void>;
	database?: {
		query: (opts: {
			token: string;
			sql: string;
			nodeId?: string;
			params?: unknown[];
		}) => Promise<{ rows: Record<string, unknown>[]; affected_rows: number }>;
	};
	tool: (opts: {
		token: string;
		tool: string;
		nodeId?: string;
		input?: Record<string, unknown>;
		timeout?: number;
	}) => Promise<unknown>;
};

function pipelineFor(variant: StoreVariant): PipelineConfig {
	const raw = variant === 'external' ? sqlExternal : sqlDefault;
	return clonePipelineForSandbox(raw as unknown as PipelineConfig);
}

function isBrokerError(message: string): boolean {
	return /ROCKETRIDE_CLIENT_ID is not set|broker|cloud DB nodes require/i.test(message);
}

async function execute(
	client: SqlClient,
	token: string,
	sql: string,
	params?: unknown[],
): Promise<{ rows: Record<string, unknown>[]; affected_rows: number }> {
	if (client.database?.query) {
		return client.database.query({ token, sql, nodeId: SQL_NODE_ID, params });
	}
	const raw = await client.tool({
		token,
		tool: 'execute',
		nodeId: SQL_NODE_ID,
		input: { sql, params: params || [] },
		timeout: 60_000,
	});
	const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
	if (typeof obj.error === 'string' && obj.error.trim()) throw new Error(obj.error);
	const rows = Array.isArray(obj.rows) ? obj.rows as Record<string, unknown>[] : [];
	return { rows, affected_rows: Number(obj.affected_rows || 0) };
}

export type SqlStore = {
	variant: StoreVariant;
	ensureSchema: () => Promise<void>;
	loadAll: () => Promise<{ runs: StoredRun[]; targets: TargetRecord[] }>;
	upsertRun: (run: StoredRun) => Promise<void>;
	upsertTarget: (target: TargetRecord) => Promise<void>;
	deleteTarget: (id: string) => Promise<void>;
	importAppState: (runs: StoredRun[], targets: TargetRecord[]) => Promise<void>;
	close: () => Promise<void>;
};

export async function openSqlStore(client: SqlClient, variant: StoreVariant = 'default'): Promise<SqlStore> {
	const started = await client.use({
		pipeline: pipelineFor(variant),
		name: 'Judge Hack SQL',
		ttl: 3600,
	});
	const token = started.token;
	let closed = false;

	const query = (sql: string, params?: unknown[]) => execute(client, token, sql, params);

	const store: SqlStore = {
		variant,
		async ensureSchema() {
			for (const statement of SCHEMA_STATEMENTS) {
				await query(statement);
			}
		},
		async loadAll() {
			const runsRes = await query(
				`SELECT * FROM hj_runs ORDER BY created_at DESC LIMIT ${MAX_SQL_RUNS}`,
			);
			const targetsRes = await query('SELECT * FROM hj_targets ORDER BY updated_at DESC');
			return {
				runs: runsRes.rows.map(rowToRun).filter((r): r is StoredRun => !!r),
				targets: targetsRes.rows.map(rowToTarget).filter((t): t is TargetRecord => !!t),
			};
		},
		async upsertRun(run) {
			await query(
				`INSERT INTO hj_runs (
					id, name, event_date, history_penalty, target_id, target_name, status, total,
					results, summary, significant_count, flagged_count, done_count,
					created_by, updated_by, created_at, updated_at, finished_at, error, stage
				) VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8,
					$9::jsonb, $10::jsonb, $11, $12, $13,
					$14::jsonb, $15::jsonb, $16::timestamptz, $17::timestamptz, $18::timestamptz, $19, $20
				)
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					event_date = EXCLUDED.event_date,
					history_penalty = EXCLUDED.history_penalty,
					target_id = EXCLUDED.target_id,
					target_name = EXCLUDED.target_name,
					status = EXCLUDED.status,
					total = EXCLUDED.total,
					results = EXCLUDED.results,
					summary = EXCLUDED.summary,
					significant_count = EXCLUDED.significant_count,
					flagged_count = EXCLUDED.flagged_count,
					done_count = EXCLUDED.done_count,
					updated_by = EXCLUDED.updated_by,
					updated_at = EXCLUDED.updated_at,
					finished_at = EXCLUDED.finished_at,
					error = EXCLUDED.error,
					stage = EXCLUDED.stage`,
				[
					run.id, run.name, run.event_date || null, run.history_penalty,
					run.target_id || null, run.target_name, run.status, run.total,
					jsonParam(run.results), jsonParam(run.summary || null),
					run.significant_count, run.flagged_count, run.done_count,
					jsonParam(run.created_by || null), jsonParam(run.updated_by || null),
					run.created_at, run.updated_at || new Date().toISOString(),
					run.finished_at || null, run.error || null, run.stage || null,
				],
			);
			const extra = await query(
				`SELECT id FROM hj_runs ORDER BY created_at DESC OFFSET ${MAX_SQL_RUNS}`,
			);
			const drop = pruneRunIds(extra.rows.map((r) => String(r.id || '')).filter(Boolean), 0);
			if (drop.length) {
				await query(`DELETE FROM hj_runs WHERE id = ANY($1::text[])`, [drop]);
			}
		},
		async upsertTarget(target) {
			if (!target.id || target.id === 'rocketride' || target.is_preset) return;
			await query(
				`INSERT INTO hj_targets (id, name, config, created_by, updated_by, updated_at)
				VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::timestamptz)
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					config = EXCLUDED.config,
					updated_by = EXCLUDED.updated_by,
					updated_at = EXCLUDED.updated_at`,
				[
					target.id, target.name, jsonParam(target.config || {}),
					jsonParam(target.created_by || null), jsonParam(target.updated_by || null),
					target.updated_at || new Date().toISOString(),
				],
			);
		},
		async deleteTarget(id) {
			if (!id || id === 'rocketride') return;
			await query('DELETE FROM hj_targets WHERE id = $1', [id]);
		},
		async importAppState(runs, targets) {
			for (const target of targets) await store.upsertTarget(target);
			for (const run of runs.slice(0, MAX_SQL_RUNS)) await store.upsertRun(run);
		},
		async close() {
			if (closed) return;
			closed = true;
			try { await client.terminate(token); } catch { /* already gone */ }
		},
	};
	return store;
}

export function classifySqlError(err: unknown): { message: string; broker: boolean } {
	const message = err instanceof Error ? err.message : String(err);
	return { message, broker: isBrokerError(message) };
}
