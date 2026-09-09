import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthUser, usePrefs, useShellConnection, useSubscriptions, useWorkspace } from 'shell';
import {
	APP_ID,
	SETTING_GRACE_DAYS,
	SETTING_HISTORY_PENALTY,
	SETTING_STORE_VARIANT,
	planFromSubscription,
} from './billing';
import { countsFromResults, summarize } from './format';
import { actorFrom } from './identity';
import type { JudgeSettings, StoredRun, StoreStatus, Submission, TargetRecord, VerifyResult } from './types';
import { scoringConfigForPlan } from './verify/architecture';
import { runRepos } from './verify/session';
import { classifySqlError, openSqlStore, shouldImportAppState, type SqlClient, type SqlStore, type StoreVariant } from './verify/sqlStore';

const MAX_RUNS = 40;
export const ROCKETRIDE_PRESET: TargetRecord = {
	id: 'rocketride',
	name: 'RocketRide',
	is_preset: true,
	config: {},
};

export function resolveTargetId(targets: TargetRecord[], preferred?: string): string {
	if (preferred && targets.some((t) => t.id === preferred)) return preferred;
	return targets[0]?.id || ROCKETRIDE_PRESET.id;
}

type StartOpts = {
	name: string;
	eventDate: string;
	historyPenalty: number;
	repos: Submission[];
	targetId?: string;
};

type RunsApi = {
	runs: StoredRun[];
	targets: TargetRecord[];
	settings: JudgeSettings;
	store: StoreStatus;
	saveSettings: (next: Partial<JudgeSettings>) => void;
	getRun: (id: string) => StoredRun | undefined;
	saveTarget: (target: TargetRecord) => void;
	deleteTarget: (id: string) => void;
	startBatch: (opts: StartOpts) => string;
	stop: () => void;
};

const Ctx = createContext<RunsApi | null>(null);

function asRuns(appState: Record<string, unknown>): StoredRun[] {
	const raw = appState.runs;
	return Array.isArray(raw) ? (raw as StoredRun[]) : [];
}

function asTargets(appState: Record<string, unknown>): TargetRecord[] {
	const raw = appState.targets;
	const custom = Array.isArray(raw) ? (raw as TargetRecord[]).filter((t) => t && t.id && !t.is_preset) : [];
	return [ROCKETRIDE_PRESET, ...custom];
}

function asNumber(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function withPreset(custom: TargetRecord[]): TargetRecord[] {
	return [ROCKETRIDE_PRESET, ...custom.filter((t) => t.id !== ROCKETRIDE_PRESET.id)];
}

export const RunsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const user = useAuthUser();
	const actor = actorFrom(user);
	const { appState, updateAppState, settings: wsSettings, updateSetting } = useWorkspace();
	const { getPref, setPref } = usePrefs();
	const { client, isConnected } = useShellConnection();
	const { desktopApps, getStatus } = useSubscriptions();
	const abortRef = useRef<AbortController | null>(null);
	const liveRef = useRef<StoredRun | null>(null);
	const sqlRef = useRef<SqlStore | null>(null);
	const runsRef = useRef<StoredRun[]>([]);
	const targetsRef = useRef<TargetRecord[]>([]);

	const [runs, setRuns] = useState<StoredRun[]>(() => asRuns(appState));
	const [targets, setTargets] = useState<TargetRecord[]>(() => asTargets(appState));
	const [store, setStore] = useState<StoreStatus>({ kind: 'appState', ready: false });
	runsRef.current = runs;
	targetsRef.current = targets;

	const billingStatus = getStatus(APP_ID);
	const billedApp = desktopApps.find((a) => a.id === APP_ID);
	const prefPlan = getPref('hj.plan') === 'developer' ? 'developer' : 'company';
	const plan = planFromSubscription(billingStatus, billedApp, prefPlan);
	const storeVariant: StoreVariant = wsSettings[SETTING_STORE_VARIANT] === 'external' ? 'external' : 'default';

	const settings: JudgeSettings = {
		grace_days: asNumber(wsSettings[SETTING_GRACE_DAYS] ?? getPref('hj.grace_days'), 2),
		history_penalty: asNumber(wsSettings[SETTING_HISTORY_PENALTY] ?? getPref('hj.history_penalty'), 2),
		plan,
		billingStatus,
	};

	const persistAppState = useCallback((nextRuns: StoredRun[], nextTargets: TargetRecord[]) => {
		updateAppState((prev) => ({
			...prev,
			runs: nextRuns.slice(0, MAX_RUNS),
			targets: nextTargets.filter((t) => !t.is_preset && t.id !== ROCKETRIDE_PRESET.id),
		}));
	}, [updateAppState]);

	const saveSettings = (next: Partial<JudgeSettings>) => {
		if (next.grace_days != null) {
			updateSetting(SETTING_GRACE_DAYS, next.grace_days);
			setPref('hj.grace_days', next.grace_days);
		}
		if (next.history_penalty != null) {
			updateSetting(SETTING_HISTORY_PENALTY, next.history_penalty);
			setPref('hj.history_penalty', next.history_penalty);
		}
		if (next.plan) setPref('hj.plan', next.plan);
	};

	const writeRun = useCallback((run: StoredRun) => {
		const stamped: StoredRun = {
			...run,
			updated_by: actor || run.updated_by,
			updated_at: new Date().toISOString(),
		};
		liveRef.current = stamped;
		setRuns((prev) => {
			const next = [stamped, ...prev.filter((r) => r.id !== stamped.id)].slice(0, MAX_RUNS);
			persistAppState(next, targetsRef.current);
			return next;
		});
		if (sqlRef.current) void sqlRef.current.upsertRun(stamped);
	}, [actor, persistAppState]);

	const saveTarget = useCallback((target: TargetRecord) => {
		if (target.is_preset || target.id === ROCKETRIDE_PRESET.id) return;
		const now = new Date().toISOString();
		const existing = targetsRef.current.find((t) => t.id === target.id);
		const stamped: TargetRecord = {
			...target,
			config: scoringConfigForPlan(target.config || {}, plan),
			created_by: existing?.created_by || actor,
			updated_by: actor || target.updated_by,
			updated_at: now,
		};
		setTargets((prev) => {
			const next = withPreset([...prev.filter((t) => !t.is_preset && t.id !== stamped.id), stamped]);
			persistAppState(runsRef.current, next);
			return next;
		});
		if (sqlRef.current) void sqlRef.current.upsertTarget(stamped);
	}, [actor, persistAppState, plan]);

	const deleteTarget = useCallback((id: string) => {
		if (id === ROCKETRIDE_PRESET.id) return;
		setTargets((prev) => {
			const next = withPreset(prev.filter((t) => t.id !== id));
			persistAppState(runsRef.current, next);
			return next;
		});
		if (sqlRef.current) void sqlRef.current.deleteTarget(id);
	}, [persistAppState]);

	useEffect(() => {
		if (!client || !isConnected) return;
		let cancelled = false;
		void (async () => {
			try {
				const opened = await openSqlStore(client as SqlClient, storeVariant);
				if (cancelled) {
					await opened.close();
					return;
				}
				await opened.ensureSchema();
				const remote = await opened.loadAll();
				const localRuns = runsRef.current;
				const localTargets = targetsRef.current.filter((t) => !t.is_preset);
				let imported = 0;
				if (shouldImportAppState(remote.runs.length, remote.targets.length, localRuns.length, localTargets.length)) {
					await opened.importAppState(localRuns, localTargets);
					imported = localRuns.length + localTargets.length;
				}
				const latest = imported
					? await opened.loadAll()
					: remote;
				if (cancelled) {
					await opened.close();
					return;
				}
				sqlRef.current = opened;
				if (latest.runs.length) setRuns(latest.runs);
				if (latest.targets.length) setTargets(withPreset(latest.targets));
				setStore({ kind: 'sql', ready: true, imported: imported || undefined });
			} catch (err) {
				if (cancelled) return;
				sqlRef.current = null;
				const classified = classifySqlError(err);
				setStore({
					kind: 'appState',
					ready: true,
					error: classified.message,
					broker: classified.broker,
				});
			}
		})();
		return () => {
			cancelled = true;
			const current = sqlRef.current;
			sqlRef.current = null;
			if (current) void current.close();
		};
	}, [client, isConnected, storeVariant]);

	const getRun = useCallback((id: string) => {
		if (liveRef.current?.id === id) return liveRef.current;
		return runs.find((r) => r.id === id);
	}, [runs]);

	const stop = useCallback(() => abortRef.current?.abort(), []);

	const startBatch = useCallback((opts: StartOpts) => {
		if (!client || !isConnected) throw new Error('RocketRide is not connected yet.');
		if (abortRef.current) throw new Error('A verification is already running. Stop it before starting another.');
		const target = targets.find((t) => t.id === opts.targetId) || ROCKETRIDE_PRESET;
		if (target.id) setPref('hj.targetId', target.id);
		const customTarget = target.is_preset
			? undefined
			: { name: target.name, config: scoringConfigForPlan(target.config || {}, plan) };
		const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
			? crypto.randomUUID()
			: `run-${Date.now()}`;
		const created_at = new Date().toISOString();
		const base: StoredRun = {
			id,
			name: opts.name,
			event_date: opts.eventDate,
			history_penalty: opts.historyPenalty,
			target_name: target.name,
			target_id: target.id,
			status: 'running',
			results: [],
			total: opts.repos.length,
			significant_count: 0,
			flagged_count: 0,
			done_count: 0,
			created_at,
			created_by: actor,
			updated_by: actor,
			updated_at: created_at,
			stage: 'Starting Daytona sandboxes…',
		};
		writeRun(base);
		const ctrl = new AbortController();
		abortRef.current = ctrl;
		void (async () => {
			try {
				await runRepos({
					client,
					repos: opts.repos,
					eventDate: opts.eventDate,
					historyPenalty: opts.historyPenalty,
					runName: opts.name,
					customTarget,
					plan,
					signal: ctrl.signal,
					onStart: (total) => {
						const r = liveRef.current;
						if (!r || r.id !== id) return;
						writeRun({ ...r, total });
					},
					onStage: (stage) => {
						const r = liveRef.current;
						if (!r || r.id !== id) return;
						writeRun({ ...r, stage });
					},
					onResult: (result: VerifyResult) => {
						const r = liveRef.current;
						if (!r || r.id !== id) return;
						const key = result.github || result.project || '';
						const idx = key
							? r.results.findIndex((row) => (row.github || row.project) === key)
							: -1;
						const results = idx >= 0
							? r.results.map((row, i) => (i === idx ? result : row))
							: [...r.results, result];
						writeRun({ ...r, results, ...countsFromResults(results), summary: summarize(results) });
					},
				});
				const r = liveRef.current;
				if (!r || r.id !== id) return;
				writeRun({
					...r,
					status: ctrl.signal.aborted ? 'stopped' : 'done',
					finished_at: new Date().toISOString(),
					summary: summarize(r.results),
					...countsFromResults(r.results),
				});
			} catch (error) {
				const r = liveRef.current;
				if (!r || r.id !== id) return;
				if (ctrl.signal.aborted) {
					writeRun({ ...r, status: 'stopped', finished_at: new Date().toISOString() });
				} else {
					writeRun({
						...r,
						status: 'error',
						error: error instanceof Error ? error.message : String(error),
						finished_at: new Date().toISOString(),
					});
				}
			} finally {
				if (abortRef.current === ctrl) abortRef.current = null;
			}
		})();
		return id;
	}, [actor, client, isConnected, plan, setPref, targets, writeRun]);

	const api = useMemo<RunsApi>(() => ({
		runs, targets, settings, store, saveSettings, getRun, saveTarget, deleteTarget, startBatch, stop,
	}), [runs, targets, settings.grace_days, settings.history_penalty, settings.plan, settings.billingStatus, store, getRun, saveTarget, deleteTarget, startBatch, stop]);

	return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
};

export function useRuns(): RunsApi {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error('useRuns must be used inside RunsProvider');
	return ctx;
}
