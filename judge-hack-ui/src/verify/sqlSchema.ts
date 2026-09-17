import type { ActorStamp, StoredRun, TargetRecord, VerifyResult } from '../types';
import { countsFromResults, summarize } from '../format';

export const SQL_NODE_ID = 'sql_1';
export const MAX_SQL_RUNS = 40;

export const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS hj_targets (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		config JSONB NOT NULL DEFAULT CAST('{}' AS jsonb),
		owner_user_id TEXT,
		created_by JSONB,
		updated_by JSONB,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,
	`CREATE TABLE IF NOT EXISTS hj_runs (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		event_date TEXT,
		history_penalty DOUBLE PRECISION,
		target_id TEXT,
		target_name TEXT,
		status TEXT NOT NULL,
		total INTEGER,
		results JSONB NOT NULL DEFAULT CAST('[]' AS jsonb),
		summary JSONB,
		significant_count INTEGER NOT NULL DEFAULT 0,
		flagged_count INTEGER NOT NULL DEFAULT 0,
		done_count INTEGER NOT NULL DEFAULT 0,
		owner_user_id TEXT,
		created_by JSONB,
		updated_by JSONB,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		finished_at TIMESTAMPTZ,
		error TEXT,
		stage TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS hj_runs_created_at_idx ON hj_runs (created_at DESC)`,
	`CREATE TABLE IF NOT EXISTS hj_run_items (
		run_id TEXT NOT NULL,
		idx INTEGER NOT NULL,
		item JSONB NOT NULL,
		PRIMARY KEY (run_id, idx)
	)`,
	`CREATE INDEX IF NOT EXISTS hj_run_items_run_id_idx ON hj_run_items (run_id)`,
	`CREATE TABLE IF NOT EXISTS hj_sandbox_leases (
		slot INTEGER PRIMARY KEY,
		owner_user_id TEXT NOT NULL,
		kind TEXT NOT NULL DEFAULT 'verify',
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		expires_at TIMESTAMPTZ NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS hj_sandbox_leases_expires_idx ON hj_sandbox_leases (expires_at)`,
];

/** Existing workspaces created tables before owner_user_id existed. */
export const SCHEMA_MIGRATIONS = [
	`ALTER TABLE hj_runs ADD COLUMN IF NOT EXISTS owner_user_id TEXT`,
	`ALTER TABLE hj_targets ADD COLUMN IF NOT EXISTS owner_user_id TEXT`,
	`UPDATE hj_runs SET owner_user_id = CAST(created_by AS jsonb) ->> 'userId' WHERE owner_user_id IS NULL AND created_by IS NOT NULL`,
	`UPDATE hj_targets SET owner_user_id = CAST(created_by AS jsonb) ->> 'userId' WHERE owner_user_id IS NULL AND created_by IS NOT NULL`,
	`CREATE INDEX IF NOT EXISTS hj_runs_owner_created_at_idx ON hj_runs (owner_user_id, created_at DESC)`,
	`CREATE INDEX IF NOT EXISTS hj_targets_owner_updated_at_idx ON hj_targets (owner_user_id, updated_at DESC)`,
	`CREATE TABLE IF NOT EXISTS hj_sandbox_leases (
		slot INTEGER PRIMARY KEY,
		owner_user_id TEXT NOT NULL,
		kind TEXT NOT NULL DEFAULT 'verify',
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		expires_at TIMESTAMPTZ NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS hj_sandbox_leases_expires_idx ON hj_sandbox_leases (expires_at)`,
];

/** Metadata columns only — a 30-repo results JSONB on SELECT * is dropped by the execute payload cap. */
export const RUN_META_COLUMNS = [
	'id', 'name', 'event_date', 'history_penalty', 'target_id', 'target_name',
	'status', 'total', 'summary', 'significant_count', 'flagged_count', 'done_count',
	'owner_user_id', 'created_by', 'updated_by', 'created_at', 'updated_at', 'finished_at', 'error', 'stage',
].join(', ');

function asObject(value: unknown): Record<string, unknown> | undefined {
	if (!value) return undefined;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
		} catch {
			return undefined;
		}
	}
	return typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function asStamp(value: unknown): ActorStamp | undefined {
	const obj = asObject(value);
	if (!obj || typeof obj.userId !== 'string' || !obj.userId) return undefined;
	return {
		userId: obj.userId,
		email: typeof obj.email === 'string' ? obj.email : undefined,
		displayName: typeof obj.displayName === 'string' ? obj.displayName : undefined,
	};
}

export function ownerIdOf(row: { owner_user_id?: string; created_by?: ActorStamp }): string | undefined {
	const owned = String(row.owner_user_id || '').trim();
	if (owned) return owned;
	return row.created_by?.userId;
}

export function belongsToUser(
	row: { owner_user_id?: string; created_by?: ActorStamp },
	userId: string | undefined,
): boolean {
	if (!userId) return false;
	return ownerIdOf(row) === userId;
}

export function filterOwned<T extends { owner_user_id?: string; created_by?: ActorStamp }>(
	rows: T[],
	userId: string | undefined,
): T[] {
	if (!userId) return [];
	return rows.filter((row) => belongsToUser(row, userId));
}

export function stampOwner<T extends { owner_user_id?: string }>(row: T, userId: string | undefined): T {
	if (!userId) return row;
	return { ...row, owner_user_id: row.owner_user_id || userId };
}

function asTenantBag(appState: Record<string, unknown>, userId: string): Record<string, unknown> | undefined {
	const tenant = asObject(appState.tenant);
	if (!tenant) return undefined;
	return asObject(tenant[userId]);
}

function legacyRows<T extends { owner_user_id?: string; created_by?: ActorStamp }>(
	raw: unknown,
	userId: string,
): T[] {
	const list = Array.isArray(raw) ? raw as T[] : [];
	const owned = filterOwned(list, userId);
	const unstamped = list.filter((row) => !ownerIdOf(row));
	const byId = new Map<string, T>();
	for (const row of [...owned, ...unstamped]) {
		const id = String((row as { id?: string }).id || '');
		if (id && !byId.has(id)) byId.set(id, row);
	}
	return [...byId.values()];
}

/** Per-user workspace cache. Shared top-level `runs`/`targets` are only a pre-tenancy fallback. */
export function readTenantRuns(appState: Record<string, unknown>, userId: string | undefined): StoredRun[] {
	if (!userId) return [];
	const bag = asTenantBag(appState, userId);
	if (bag && Array.isArray(bag.runs)) return filterOwned(bag.runs as StoredRun[], userId);
	return legacyRows<StoredRun>(appState.runs, userId);
}

export function readTenantTargets(appState: Record<string, unknown>, userId: string | undefined): TargetRecord[] {
	if (!userId) return [];
	const bag = asTenantBag(appState, userId);
	const raw = bag && Array.isArray(bag.targets) ? bag.targets : appState.targets;
	const rows = bag && Array.isArray(bag.targets)
		? filterOwned(raw as TargetRecord[], userId)
		: legacyRows<TargetRecord>(raw, userId);
	return rows.filter((t) => t && t.id && t.id !== 'rocketride' && !t.is_preset);
}

export function readTenantMeterKb(appState: Record<string, unknown>, userId: string | undefined): number {
	if (!userId) return 0;
	const bag = asTenantBag(appState, userId);
	const n = Number(bag?.meter_kb_used);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function writeTenantState(
	prev: Record<string, unknown>,
	userId: string,
	runs: StoredRun[],
	targets: TargetRecord[],
	meterKb?: number,
): Record<string, unknown> {
	const tenant = { ...(asObject(prev.tenant) || {}) };
	const prevBag = asObject(tenant[userId]) || {};
	const nextMeter = meterKb != null && Number.isFinite(meterKb)
		? Math.max(0, Math.floor(meterKb))
		: Number(prevBag.meter_kb_used);
	tenant[userId] = {
		...prevBag,
		runs: runs.map((run) => stampOwner(run, userId)).slice(0, MAX_SQL_RUNS),
		targets: targets
			.filter((t) => t && t.id && t.id !== 'rocketride' && !t.is_preset)
			.map((t) => stampOwner(t, userId)),
		meter_kb_used: Number.isFinite(nextMeter) && nextMeter > 0 ? nextMeter : 0,
	};
	return { ...prev, tenant };
}

export function asResults(value: unknown): VerifyResult[] {
	if (value == null) return [];
	if (Array.isArray(value)) return value as VerifyResult[];
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed || trimmed === '[]') return [];
		try {
			return asResults(JSON.parse(trimmed));
		} catch {
			return [];
		}
	}
	if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
		try {
			return asResults(new TextDecoder().decode(value as ArrayBufferView));
		} catch {
			return [];
		}
	}
	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		if ('results' in obj) return asResults(obj.results);
		if ('value' in obj && !('github' in obj) && !('project' in obj)) return asResults(obj.value);
		const keys = Object.keys(obj);
		if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
			return keys
				.sort((a, b) => Number(a) - Number(b))
				.map((k) => obj[k] as VerifyResult);
		}
	}
	return [];
}

export function rowToTarget(row: Record<string, unknown>): TargetRecord | null {
	const id = String(row.id || '');
	const name = String(row.name || '');
	if (!id || !name || id === 'rocketride') return null;
	return {
		id,
		name,
		config: asObject(row.config) || {},
		owner_user_id: row.owner_user_id != null ? String(row.owner_user_id) : undefined,
		created_by: asStamp(row.created_by),
		updated_by: asStamp(row.updated_by),
		updated_at: row.updated_at != null ? String(row.updated_at) : undefined,
	};
}

export function rowToRun(row: Record<string, unknown>): StoredRun | null {
	const id = String(row.id || '');
	if (!id) return null;
	const results = asResults(row.results);
	const counts = countsFromResults(results);
	const status = String(row.status || 'done');
	return {
		id,
		name: String(row.name || 'Run'),
		event_date: String(row.event_date || ''),
		history_penalty: Number(row.history_penalty || 0),
		target_name: String(row.target_name || 'RocketRide'),
		target_id: row.target_id != null ? String(row.target_id) : undefined,
		status: (status === 'running' || status === 'stopped' || status === 'error' ? status : 'done'),
		results,
		total: Number(row.total || results.length || 0),
		summary: asObject(row.summary) as StoredRun['summary'] || summarize(results),
		significant_count: Number(row.significant_count ?? counts.significant_count),
		flagged_count: Number(row.flagged_count ?? counts.flagged_count),
		done_count: Number(row.done_count ?? counts.done_count),
		created_at: row.created_at != null ? String(row.created_at) : new Date().toISOString(),
		owner_user_id: row.owner_user_id != null ? String(row.owner_user_id) : undefined,
		created_by: asStamp(row.created_by),
		updated_by: asStamp(row.updated_by),
		updated_at: row.updated_at != null ? String(row.updated_at) : undefined,
		finished_at: row.finished_at != null ? String(row.finished_at) : undefined,
		error: row.error != null ? String(row.error) : undefined,
		stage: row.stage != null ? String(row.stage) : undefined,
	};
}

export function jsonParam(value: unknown): string {
	return JSON.stringify(value ?? null);
}

export function pruneRunIds(ids: string[], keep = MAX_SQL_RUNS): string[] {
	return ids.slice(keep);
}

export function shouldImportAppState(remoteRuns: number, remoteTargets: number, localRuns: number, localTargets: number): boolean {
	return remoteRuns === 0 && remoteTargets === 0 && (localRuns > 0 || localTargets > 0);
}

/** SQL wins when it has rows. Empty SQL must not wipe workspace rows that hydrated late. */
export function pickStoreRows<T>(remote: T[], local: T[]): T[] {
	return remote.length ? remote : local;
}

function resultCount(run: StoredRun | undefined): number {
	return run?.results?.length || 0;
}

export function resultTotal(runs: StoredRun[]): number {
	return runs.reduce((n, r) => n + resultCount(r), 0);
}

function stampMs(value?: string): number {
	if (!value) return 0;
	const n = Date.parse(value);
	return Number.isFinite(n) ? n : 0;
}

/** Prefer the copy that actually has verdicts. Status-only SQL shells must not replace a finished workspace run. */
export function pickRicherRun(a: StoredRun | undefined, b: StoredRun | undefined): StoredRun | undefined {
	if (!a) return b;
	if (!b) return a;
	const aN = resultCount(a);
	const bN = resultCount(b);
	if (aN !== bN) return aN > bN ? a : b;
	const aDone = a.status !== 'running';
	const bDone = b.status !== 'running';
	if (aDone !== bDone) return aDone ? a : b;
	return stampMs(b.updated_at || b.finished_at) > stampMs(a.updated_at || a.finished_at) ? b : a;
}

export function mergeRuns(remote: StoredRun[], local: StoredRun[]): StoredRun[] {
	const byId = new Map<string, StoredRun>();
	for (const run of remote) {
		if (run?.id) byId.set(run.id, run);
	}
	for (const run of local) {
		if (!run?.id) continue;
		const picked = pickRicherRun(byId.get(run.id), run);
		if (picked) byId.set(run.id, picked);
	}
	return [...byId.values()].sort((a, b) => stampMs(b.created_at) - stampMs(a.created_at));
}

export function mergeTargets(remote: TargetRecord[], local: TargetRecord[]): TargetRecord[] {
	const byId = new Map<string, TargetRecord>();
	for (const target of remote) {
		if (target?.id) byId.set(target.id, target);
	}
	for (const target of local) {
		if (!target?.id) continue;
		const cur = byId.get(target.id);
		if (!cur) byId.set(target.id, target);
		else if (stampMs(target.updated_at) >= stampMs(cur.updated_at)) byId.set(target.id, target);
	}
	return [...byId.values()];
}

/** A previous tab/publish leaves status=running with no live worker. Stop showing it as live. */
export function settleOrphanedRuns(runs: StoredRun[], liveId?: string | null): StoredRun[] {
	return runs.map((run) => {
		if (run.status !== 'running' || (liveId && run.id === liveId)) return run;
		return {
			...run,
			status: 'stopped',
			finished_at: run.finished_at || run.updated_at || new Date().toISOString(),
			stage: run.stage || 'Session ended before this run finished',
		};
	});
}

export function runFingerprint(runs: StoredRun[]): string {
	return runs.map((r) => `${r.id}:${r.results.length}:${r.status}:${r.done_count}:${r.updated_at || ''}`).join('|');
}

function asItem(value: unknown): VerifyResult | undefined {
	if (value == null) return undefined;
	const parsed = asResults(value);
	if (parsed.length) return parsed[0];
	if (typeof value === 'object' && !Array.isArray(value)) return value as VerifyResult;
	return undefined;
}

export function parseResultItem(value: unknown): VerifyResult | undefined {
	return asItem(value);
}

export function attachRunItems(runs: StoredRun[], itemRows: Record<string, unknown>[]): StoredRun[] {
	const byRun = new Map<string, VerifyResult[]>();
	for (const row of itemRows) {
		const runId = String(row.run_id || row.runId || '');
		if (!runId) continue;
		const idx = Number(row.idx ?? row.index ?? -1);
		const item = asItem(row.item);
		if (!item) continue;
		const list = byRun.get(runId) || [];
		if (Number.isFinite(idx) && idx >= 0) list[idx] = item;
		else list.push(item);
		byRun.set(runId, list);
	}
	return runs.map((run) => {
		const items = (byRun.get(run.id) || []).filter(Boolean);
		if (!items.length) return run;
		const counts = countsFromResults(items);
		return {
			...run,
			results: items,
			total: run.total || items.length,
			summary: run.summary || summarize(items),
			significant_count: run.significant_count || counts.significant_count,
			flagged_count: run.flagged_count || counts.flagged_count,
			done_count: Math.max(run.done_count || 0, counts.done_count),
		};
	});
}

export function applyResultsBlobs(runs: StoredRun[], rows: Record<string, unknown>[]): StoredRun[] {
	const byId = new Map<string, VerifyResult[]>();
	for (const row of rows) {
		const id = String(row.id || '');
		const results = asResults(row.results);
		if (id && results.length) byId.set(id, results);
	}
	return runs.map((run) => {
		if (run.results.length) return run;
		const results = byId.get(run.id);
		if (!results?.length) return run;
		const counts = countsFromResults(results);
		return {
			...run,
			results,
			total: run.total || results.length,
			summary: run.summary || summarize(results),
			significant_count: run.significant_count || counts.significant_count,
			flagged_count: run.flagged_count || counts.flagged_count,
			done_count: Math.max(run.done_count || 0, counts.done_count),
		};
	});
}

export function shouldRepairRun(remote: StoredRun | undefined, merged: StoredRun): boolean {
	return resultCount(merged) > resultCount(remote);
}

export function assertReadOnlySql(sql: string): string {
	const stripped = sql
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/--[^\n]*/g, ' ')
		.trim();
	if (!stripped) throw new Error('SQL is empty');
	if (!/^(select|with)\b/i.test(stripped)) {
		throw new Error('Only SELECT (or WITH … SELECT) is allowed');
	}
	if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|execute|call)\b/i.test(stripped)) {
		throw new Error('Write/DDL statements are not allowed from this panel');
	}
	if (/::/.test(stripped)) {
		throw new Error('Avoid Postgres :: casts (SQLAlchemy treats :name as a bind). Use CAST(x AS type).');
	}
	return stripped;
}
