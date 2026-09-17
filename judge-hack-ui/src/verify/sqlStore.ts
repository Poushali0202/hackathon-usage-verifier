import type { PipelineConfig } from 'rocketride';
import type { StoredRun, TargetRecord, VerifyResult } from '../types';
import { clonePipelineForSandbox, DAYTONA_ORG_SLOTS } from './pool';
import {
	MAX_SQL_RUNS,
	RUN_META_COLUMNS,
	SCHEMA_MIGRATIONS,
	SCHEMA_STATEMENTS,
	SQL_NODE_ID,
	applyResultsBlobs,
	asResults,
	attachRunItems,
	jsonParam,
	mergeRuns,
	mergeTargets,
	parseResultItem,
	pickStoreRows,
	pruneRunIds,
	rowToRun,
	rowToTarget,
	shouldImportAppState,
	shouldRepairRun,
} from './sqlSchema';
import sqlDefault from '../pipelines/hackjudge_sql_v1.pipe';
import sqlExternal from '../pipelines/hackjudge_sql_v1.external.pipe';

export { SQL_NODE_ID, shouldImportAppState, pickStoreRows, mergeRuns, mergeTargets, shouldRepairRun };

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

const ITEM_BATCH = 8;

function firstRow(rows: Record<string, unknown>[]): Record<string, unknown> | undefined {
	return rows[0];
}

async function loadResultsForRun(
	query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; affected_rows: number }>,
	id: string,
	ownerUserId: string,
): Promise<VerifyResult[]> {
	let n = 0;
	try {
		const len = await query(
			'SELECT COALESCE(jsonb_array_length(results), 0) AS n FROM hj_runs WHERE id = $1 AND owner_user_id = $2',
			[id, ownerUserId],
		);
		n = Number(firstRow(len.rows)?.n || 0);
	} catch {
		n = 0;
	}
	if (n > 0) {
		const items: VerifyResult[] = [];
		for (let idx = 0; idx < n; idx++) {
			try {
				const row = await query(
					'SELECT results -> CAST($2 AS integer) AS item FROM hj_runs WHERE id = $1 AND owner_user_id = $3',
					[id, idx, ownerUserId],
				);
				const item = parseResultItem(firstRow(row.rows)?.item);
				if (item) items[idx] = item;
			} catch {
				break;
			}
		}
		const filled = items.filter(Boolean);
		if (filled.length) return filled;
	}
	try {
		const blobs = await query(
			'SELECT CAST(results AS text) AS results FROM hj_runs WHERE id = $1 AND owner_user_id = $2',
			[id, ownerUserId],
		);
		const parsed = asResults(firstRow(blobs.rows)?.results);
		if (parsed.length) return parsed;
	} catch {
		/* payload cap */
	}
	try {
		const blobs = await query(
			'SELECT results FROM hj_runs WHERE id = $1 AND owner_user_id = $2',
			[id, ownerUserId],
		);
		return asResults(firstRow(blobs.rows)?.results);
	} catch {
		return [];
	}
}

function asQueryResult(raw: unknown): { rows: Record<string, unknown>[]; affected_rows: number } {
	const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
	if (typeof obj.error === 'string' && obj.error.trim()) throw new Error(obj.error);
	const rows = Array.isArray(obj.rows) ? obj.rows as Record<string, unknown>[] : [];
	return { rows, affected_rows: Number(obj.affected_rows || 0) };
}

async function execute(
	client: SqlClient,
	token: string,
	sql: string,
	params?: unknown[],
): Promise<{ rows: Record<string, unknown>[]; affected_rows: number }> {
	if (client.tool) {
		return asQueryResult(await client.tool({
			token,
			tool: 'execute',
			nodeId: SQL_NODE_ID,
			input: params && params.length ? { sql, params } : { sql },
			timeout: 60_000,
		}));
	}
	if (client.database?.query) {
		return client.database.query({
			token,
			sql,
			nodeId: SQL_NODE_ID,
			...(params && params.length ? { params } : {}),
		});
	}
	throw new Error('No SQL execute surface on this client');
}

export type SqlStore = {
	variant: StoreVariant;
	ensureSchema: () => Promise<void>;
	loadAll: () => Promise<{ runs: StoredRun[]; targets: TargetRecord[] }>;
	loadResults: (id: string) => Promise<VerifyResult[]>;
	upsertRun: (run: StoredRun) => Promise<void>;
	upsertTarget: (target: TargetRecord) => Promise<void>;
	deleteTarget: (id: string) => Promise<void>;
	importAppState: (runs: StoredRun[], targets: TargetRecord[]) => Promise<void>;
	claimSandboxLeases: (wanted: number, ttlSeconds: number, kind: string) => Promise<number[]>;
	releaseSandboxLeases: (slots: number[]) => Promise<void>;
	close: () => Promise<void>;
};

export async function openSqlStore(
	client: SqlClient,
	variant: StoreVariant = 'default',
	ownerUserId?: string,
): Promise<SqlStore> {
	const owner = String(ownerUserId || '').trim();
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
			for (const statement of SCHEMA_MIGRATIONS) {
				await query(statement);
			}
		},
		async loadAll() {
			if (!owner) return { runs: [], targets: [] };
			const runsRes = await query(
				`SELECT ${RUN_META_COLUMNS} FROM hj_runs WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT ${MAX_SQL_RUNS}`,
				[owner],
			);
			let runs = runsRes.rows.map(rowToRun).filter((r): r is StoredRun => !!r);
			try {
				const itemsRes = await query(
					`SELECT i.run_id, i.idx, i.item FROM hj_run_items i
					INNER JOIN hj_runs r ON r.id = i.run_id
					WHERE r.owner_user_id = $1`,
					[owner],
				);
				runs = attachRunItems(runs, itemsRes.rows);
			} catch {
				/* table created on ensureSchema; older sessions without it still have hj_runs.results */
			}
			for (const run of runs.filter((r) => !r.results.length)) {
				const recovered = await loadResultsForRun(query, run.id, owner);
				if (recovered.length) {
					runs = applyResultsBlobs(runs, [{ id: run.id, results: recovered }]);
				}
			}
			const targetsRes = await query(
				'SELECT * FROM hj_targets WHERE owner_user_id = $1 ORDER BY updated_at DESC',
				[owner],
			);
			return {
				runs,
				targets: targetsRes.rows.map(rowToTarget).filter((t): t is TargetRecord => !!t),
			};
		},
		async loadResults(id) {
			if (!owner) return [];
			return loadResultsForRun(query, id, owner);
		},
		async upsertRun(run) {
			if (!owner) return;
			const items = run.results || [];
			const ownerId = run.owner_user_id || owner;
			await query(
				`INSERT INTO hj_runs (
					id, name, event_date, history_penalty, target_id, target_name, status, total,
					results, summary, significant_count, flagged_count, done_count,
					owner_user_id, created_by, updated_by, created_at, updated_at, finished_at, error, stage
				) VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8,
					CAST($9 AS jsonb), CAST($10 AS jsonb), $11, $12, $13,
					$14, CAST($15 AS jsonb), CAST($16 AS jsonb), CAST($17 AS timestamptz), CAST($18 AS timestamptz), CAST($19 AS timestamptz), $20, $21
				)
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					event_date = EXCLUDED.event_date,
					history_penalty = EXCLUDED.history_penalty,
					target_id = EXCLUDED.target_id,
					target_name = EXCLUDED.target_name,
					status = EXCLUDED.status,
					total = EXCLUDED.total,
					summary = EXCLUDED.summary,
					significant_count = EXCLUDED.significant_count,
					flagged_count = EXCLUDED.flagged_count,
					done_count = EXCLUDED.done_count,
					updated_by = EXCLUDED.updated_by,
					updated_at = EXCLUDED.updated_at,
					finished_at = EXCLUDED.finished_at,
					error = EXCLUDED.error,
					stage = EXCLUDED.stage
				WHERE hj_runs.owner_user_id = EXCLUDED.owner_user_id`,
				[
					run.id, run.name, run.event_date || null, run.history_penalty,
					run.target_id || null, run.target_name, run.status, run.total,
					jsonParam([]), jsonParam(run.summary || null),
					run.significant_count, run.flagged_count, run.done_count,
					ownerId,
					jsonParam(run.created_by || null), jsonParam(run.updated_by || null),
					run.created_at, run.updated_at || new Date().toISOString(),
					run.finished_at || null, run.error || null, run.stage || null,
				],
			);
			if (items.length) {
				for (let offset = 0; offset < items.length; offset += ITEM_BATCH) {
					const chunk = items.slice(offset, offset + ITEM_BATCH);
					const values: string[] = [];
					const params: unknown[] = [];
					chunk.forEach((item, i) => {
						const base = i * 3;
						values.push(`($${base + 1}, $${base + 2}, CAST($${base + 3} AS jsonb))`);
						params.push(run.id, offset + i, jsonParam(item));
					});
					await query(
						`INSERT INTO hj_run_items (run_id, idx, item) VALUES ${values.join(', ')}
						ON CONFLICT (run_id, idx) DO UPDATE SET item = EXCLUDED.item`,
						params,
					);
				}
				await query('DELETE FROM hj_run_items WHERE run_id = $1 AND idx >= $2', [run.id, items.length]);
			}
			const extra = await query(
				`SELECT id FROM hj_runs WHERE owner_user_id = $1 ORDER BY created_at DESC OFFSET ${MAX_SQL_RUNS}`,
				[ownerId],
			);
			const drop = pruneRunIds(extra.rows.map((r) => String(r.id || '')).filter(Boolean), 0);
			if (drop.length) {
				await query('DELETE FROM hj_run_items WHERE run_id = ANY(CAST($1 AS text[]))', [drop]);
				await query('DELETE FROM hj_runs WHERE id = ANY(CAST($1 AS text[])) AND owner_user_id = $2', [drop, ownerId]);
			}
		},
		async upsertTarget(target) {
			if (!owner) return;
			if (!target.id || target.id === 'rocketride' || target.is_preset) return;
			const ownerId = target.owner_user_id || owner;
			await query(
				`INSERT INTO hj_targets (id, name, config, owner_user_id, created_by, updated_by, updated_at)
				VALUES ($1, $2, CAST($3 AS jsonb), $4, CAST($5 AS jsonb), CAST($6 AS jsonb), CAST($7 AS timestamptz))
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					config = EXCLUDED.config,
					updated_by = EXCLUDED.updated_by,
					updated_at = EXCLUDED.updated_at
				WHERE hj_targets.owner_user_id = EXCLUDED.owner_user_id`,
				[
					target.id, target.name, jsonParam(target.config || {}),
					ownerId,
					jsonParam(target.created_by || null), jsonParam(target.updated_by || null),
					target.updated_at || new Date().toISOString(),
				],
			);
		},
		async deleteTarget(id) {
			if (!owner) return;
			if (!id || id === 'rocketride') return;
			await query('DELETE FROM hj_targets WHERE id = $1 AND owner_user_id = $2', [id, owner]);
		},
		async importAppState(runs, targets) {
			for (const target of targets) {
				await store.upsertTarget({ ...target, owner_user_id: target.owner_user_id || owner });
			}
			for (const run of runs.slice(0, MAX_SQL_RUNS)) {
				await store.upsertRun({ ...run, owner_user_id: run.owner_user_id || owner });
			}
		},
		async claimSandboxLeases(wanted, ttlSeconds, kind) {
			const n = Math.max(0, Math.floor(wanted));
			if (n < 1) return [];
			const expires = new Date(Date.now() + Math.max(60, ttlSeconds) * 1000).toISOString();
			const label = kind || 'verify';
			try {
				await query('DELETE FROM hj_sandbox_leases WHERE expires_at <= now()');
			} catch {
				/* ensureSchema creates the table; a first-call race still retries below */
			}
			const slots: number[] = [];
			for (let i = 0; i < n; i++) {
				const insert = () => query(
					`INSERT INTO hj_sandbox_leases (slot, owner_user_id, kind, created_at, expires_at)
					SELECT s, $1, $2, now(), CAST($3 AS timestamptz)
					FROM generate_series(1, $4) AS g(s)
					WHERE NOT EXISTS (SELECT 1 FROM hj_sandbox_leases l WHERE l.slot = s)
					ORDER BY s
					LIMIT 1
					RETURNING slot`,
					[owner || 'anon', label, expires, DAYTONA_ORG_SLOTS],
				);
				try {
					const res = await insert();
					const slot = Number(firstRow(res.rows)?.slot);
					if (!Number.isFinite(slot) || slot < 1) break;
					slots.push(slot);
				} catch {
					try {
						const res = await insert();
						const slot = Number(firstRow(res.rows)?.slot);
						if (!Number.isFinite(slot) || slot < 1) break;
						slots.push(slot);
					} catch {
						break;
					}
				}
			}
			return slots;
		},
		async releaseSandboxLeases(slots) {
			const ids = (slots || []).map((n) => Math.floor(Number(n))).filter((n) => n > 0);
			if (!ids.length) return;
			try {
				await query('DELETE FROM hj_sandbox_leases WHERE slot = ANY(CAST($1 AS integer[]))', [ids]);
			} catch {
				/* expired or already released */
			}
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
