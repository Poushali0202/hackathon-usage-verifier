import type { ActorStamp, StoredRun, TargetRecord, VerifyResult } from '../types';
import { countsFromResults, summarize } from '../format';

export const SQL_NODE_ID = 'sql_1';
export const MAX_SQL_RUNS = 40;

export const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS hj_targets (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		config JSONB NOT NULL DEFAULT '{}'::jsonb,
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
		results JSONB NOT NULL DEFAULT '[]'::jsonb,
		summary JSONB,
		significant_count INTEGER NOT NULL DEFAULT 0,
		flagged_count INTEGER NOT NULL DEFAULT 0,
		done_count INTEGER NOT NULL DEFAULT 0,
		created_by JSONB,
		updated_by JSONB,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		finished_at TIMESTAMPTZ,
		error TEXT,
		stage TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS hj_runs_created_at_idx ON hj_runs (created_at DESC)`,
];

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

function asResults(value: unknown): VerifyResult[] {
	if (typeof value === 'string') {
		try {
			return asResults(JSON.parse(value));
		} catch {
			return [];
		}
	}
	return Array.isArray(value) ? value as VerifyResult[] : [];
}

export function rowToTarget(row: Record<string, unknown>): TargetRecord | null {
	const id = String(row.id || '');
	const name = String(row.name || '');
	if (!id || !name || id === 'rocketride') return null;
	return {
		id,
		name,
		config: asObject(row.config) || {},
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
