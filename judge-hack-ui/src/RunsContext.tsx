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
import { consumedKbFromRuns, gateBatch, resultMetersKb } from './verify/meter';
import { createOrgLease, type OrgLease } from './verify/leases';
import {
	filterOwned,
	mergeRuns,
	mergeTargets,
	readTenantMeterKb,
	readTenantRuns,
	readTenantTargets,
	resultTotal,
	runFingerprint,
	settleOrphanedRuns,
	shouldRepairRun,
	stampOwner,
	writeTenantState,
} from './verify/sqlSchema';

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
	hydrateResults: (id: string) => void;
	makeOrgLease: (kind: string) => OrgLease;
};

const Ctx = createContext<RunsApi | null>(null);

function asRuns(appState: Record<string, unknown>, userId?: string): StoredRun[] {
	return readTenantRuns(appState, userId);
}

function asTargets(appState: Record<string, unknown>, userId?: string): TargetRecord[] {
	return withPreset(readTenantTargets(appState, userId));
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
	const ownerUserId = actor?.userId;
	const { appState, updateAppState, settings: wsSettings, updateSetting } = useWorkspace();
	const { getPref, setPref } = usePrefs();
	const { client, isConnected } = useShellConnection();
	const { desktopApps, getStatus } = useSubscriptions();
	const abortRef = useRef<AbortController | null>(null);
	const liveRef = useRef<StoredRun | null>(null);
	const sqlRef = useRef<SqlStore | null>(null);
	const runsRef = useRef<StoredRun[]>([]);
	const targetsRef = useRef<TargetRecord[]>([]);
	const upsertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingUpsertRef = useRef<StoredRun | null>(null);
	const appStateRef = useRef(appState);
	const hydratingRef = useRef<Set<string>>(new Set());
	const meterRef = useRef<number | undefined>(undefined);
	appStateRef.current = appState;

	const [runs, setRuns] = useState<StoredRun[]>(() => asRuns(appState, ownerUserId));
	const [targets, setTargets] = useState<TargetRecord[]>(() => asTargets(appState, ownerUserId));
	const [meterKb, setMeterKb] = useState(() => Math.max(
		readTenantMeterKb(appState, ownerUserId),
		consumedKbFromRuns(asRuns(appState, ownerUserId)),
	));
	if (meterRef.current == null) meterRef.current = meterKb;
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
		meter_kb_used: meterKb,
	};

	const persistAppState = useCallback((nextRuns: StoredRun[], nextTargets: TargetRecord[]) => {
		if (!ownerUserId) return;
		updateAppState((prev) => writeTenantState(
			prev,
			ownerUserId,
			mergeRuns(asRuns(prev, ownerUserId), nextRuns).slice(0, MAX_RUNS),
			nextTargets.filter((t) => !t.is_preset && t.id !== ROCKETRIDE_PRESET.id),
			meterRef.current ?? 0,
		));
	}, [ownerUserId, updateAppState]);
	const persistAppStateRef = useRef(persistAppState);
	persistAppStateRef.current = persistAppState;

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

	const flushSqlUpsert = useCallback((run?: StoredRun) => {
		const next = run || pendingUpsertRef.current;
		pendingUpsertRef.current = null;
		if (upsertTimerRef.current) {
			clearTimeout(upsertTimerRef.current);
			upsertTimerRef.current = null;
		}
		if (!next || !sqlRef.current) return;
		void sqlRef.current.upsertRun(next).catch((err) => {
			setStore((prev) => ({
				...prev,
				error: err instanceof Error ? err.message : String(err),
			}));
		});
	}, []);

	const scheduleSqlUpsert = useCallback((run: StoredRun) => {
		pendingUpsertRef.current = run;
		if (run.status !== 'running') {
			flushSqlUpsert(run);
			return;
		}
		if (upsertTimerRef.current) return;
		upsertTimerRef.current = setTimeout(() => flushSqlUpsert(), 2000);
	}, [flushSqlUpsert]);

	const writeRun = useCallback((run: StoredRun) => {
		const stamped: StoredRun = stampOwner({
			...run,
			updated_by: actor || run.updated_by,
			updated_at: new Date().toISOString(),
		}, ownerUserId);
		liveRef.current = stamped;
		setRuns((prev) => {
			const next = mergeRuns(prev, [stamped]).slice(0, MAX_RUNS);
			persistAppState(next, targetsRef.current);
			return next;
		});
		scheduleSqlUpsert(stamped);
	}, [actor, ownerUserId, persistAppState, scheduleSqlUpsert]);

	const hydrateResults = useCallback((id: string) => {
		const opened = sqlRef.current;
		if (!opened) return;
		const current = (liveRef.current?.id === id ? liveRef.current : undefined)
			|| runsRef.current.find((r) => r.id === id);
		if (!current || current.results.length || hydratingRef.current.has(id)) return;
		hydratingRef.current.add(id);
		void (async () => {
			try {
				const results = await opened.loadResults(id);
				if (!results.length) return;
				const filled: StoredRun = {
					...current,
					results,
					...countsFromResults(results),
					summary: current.summary || summarize(results),
				};
				setRuns((prev) => {
					const list = mergeRuns(prev, [filled]).slice(0, MAX_RUNS);
					persistAppStateRef.current(list, targetsRef.current);
					return list;
				});
				void opened.upsertRun(filled).catch(() => { /* grid already filled */ });
			} catch {
				/* keep the shell visible */
			} finally {
				hydratingRef.current.delete(id);
			}
		})();
	}, []);

	const saveTarget = useCallback((target: TargetRecord) => {
		if (target.is_preset || target.id === ROCKETRIDE_PRESET.id) return;
		const now = new Date().toISOString();
		const existing = targetsRef.current.find((t) => t.id === target.id);
		const stamped: TargetRecord = stampOwner({
			...target,
			config: scoringConfigForPlan(target.config || {}, plan),
			created_by: existing?.created_by || actor,
			updated_by: actor || target.updated_by,
			updated_at: now,
		}, ownerUserId);
		setTargets((prev) => {
			const next = withPreset([...prev.filter((t) => !t.is_preset && t.id !== stamped.id), stamped]);
			persistAppState(runsRef.current, next);
			return next;
		});
		if (sqlRef.current) void sqlRef.current.upsertTarget(stamped);
	}, [actor, ownerUserId, persistAppState, plan]);

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
		const nextRuns = asRuns(appStateRef.current, ownerUserId);
		setRuns(nextRuns);
		setTargets(asTargets(appStateRef.current, ownerUserId));
		const nextMeter = Math.max(
			readTenantMeterKb(appStateRef.current, ownerUserId),
			consumedKbFromRuns(nextRuns),
		);
		meterRef.current = nextMeter;
		setMeterKb(nextMeter);
		liveRef.current = null;
		if (!ownerUserId) setStore({ kind: 'appState', ready: true });
	}, [ownerUserId]);

	useEffect(() => {
		if (!ownerUserId || !client || !isConnected) return;
		let cancelled = false;
		void (async () => {
			try {
				const opened = await openSqlStore(client as SqlClient, storeVariant, ownerUserId);
				if (cancelled) {
					await opened.close();
					return;
				}
				await opened.ensureSchema();
				const remote = await opened.loadAll();
				const localRuns = mergeRuns(asRuns(appStateRef.current, ownerUserId), runsRef.current)
					.map((run) => stampOwner(run, ownerUserId));
				const localTargets = mergeTargets(
					asTargets(appStateRef.current, ownerUserId).filter((t) => !t.is_preset),
					targetsRef.current.filter((t) => !t.is_preset),
				).map((target) => stampOwner(target, ownerUserId));
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
				const live = liveRef.current;
				const showRuns = settleOrphanedRuns(
					filterOwned(
						mergeRuns(
							latest.runs,
							mergeRuns(
								asRuns(appStateRef.current, ownerUserId),
								live ? mergeRuns(runsRef.current, [live]) : runsRef.current,
							),
						).map((run) => stampOwner(run, ownerUserId)),
						ownerUserId,
					),
					live?.id,
				);
				const showTargets = filterOwned(
					mergeTargets(latest.targets, mergeTargets(
						asTargets(appStateRef.current, ownerUserId).filter((t) => !t.is_preset),
						targetsRef.current.filter((t) => !t.is_preset),
					)).map((target) => stampOwner(target, ownerUserId)),
					ownerUserId,
				);
				const keptRuns = mergeRuns(showRuns, runsRef.current);
				setRuns(keptRuns);
				setTargets(withPreset(showTargets));
				const previous = Math.max(resultTotal(runsRef.current), resultTotal(asRuns(appStateRef.current, ownerUserId)));
				if (resultTotal(keptRuns) >= previous) {
					persistAppStateRef.current(keptRuns, withPreset(showTargets));
				}
				setStore({ kind: 'sql', ready: true, imported: imported || undefined });
				for (const run of keptRuns) {
					const remoteRow = latest.runs.find((r) => r.id === run.id);
					if (shouldRepairRun(remoteRow, run)) {
						void opened.upsertRun(run).catch(() => { /* keep merged rows visible */ });
					}
				}
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
			flushSqlUpsert();
			const current = sqlRef.current;
			sqlRef.current = null;
			if (current) void current.close();
		};
	}, [client, isConnected, ownerUserId, storeVariant, flushSqlUpsert]);

	useEffect(() => {
		if (!store.ready) return;
		const localRuns = asRuns(appState, ownerUserId);
		const localTargets = asTargets(appState, ownerUserId).filter((t) => !t.is_preset);
		const storedMeter = readTenantMeterKb(appState, ownerUserId);
		if (storedMeter > (meterRef.current || 0)) {
			meterRef.current = storedMeter;
			setMeterKb(storedMeter);
		}
		if (!localRuns.length && !localTargets.length) return;
		const mergedRuns = mergeRuns(runsRef.current, localRuns);
		const mergedTargets = mergeTargets(targetsRef.current.filter((t) => !t.is_preset), localTargets);
		if (runFingerprint(mergedRuns) === runFingerprint(runsRef.current)) return;
		setRuns(mergedRuns);
		setTargets(withPreset(mergedTargets));
		const derived = consumedKbFromRuns(mergedRuns);
		if (derived > (meterRef.current || 0)) {
			meterRef.current = derived;
			setMeterKb(derived);
		}
		if (store.kind === 'sql' && sqlRef.current) {
			const opened = sqlRef.current;
			for (const run of mergedRuns) {
				const shown = runsRef.current.find((r) => r.id === run.id);
				if (shouldRepairRun(shown, run)) {
					void opened.upsertRun(run).catch(() => { /* keep workspace rows visible */ });
				}
			}
		}
	}, [appState, ownerUserId, store.kind, store.ready]);

	const getRun = useCallback((id: string) => {
		if (liveRef.current?.id === id) return liveRef.current;
		return runs.find((r) => r.id === id);
	}, [runs]);

	const stop = useCallback(() => abortRef.current?.abort(), []);

	const makeOrgLease = useCallback((kind: string): OrgLease => createOrgLease({
		async acquire(wanted, ttlSeconds) {
			const opened = sqlRef.current;
			if (!opened || wanted < 1) {
				return wanted < 1 ? [] : Array.from({ length: wanted }, (_, i) => -(i + 1));
			}
			try {
				return await opened.claimSandboxLeases(wanted, ttlSeconds, kind);
			} catch {
				return Array.from({ length: wanted }, (_, i) => -(i + 1));
			}
		},
		async releaseSlots(slots) {
			const real = (slots || []).filter((n) => n > 0);
			if (!real.length || !sqlRef.current) return;
			try { await sqlRef.current.releaseSandboxLeases(real); } catch { /* already gone */ }
		},
	}), []);

	const startBatch = useCallback((opts: StartOpts) => {
		if (!client || !isConnected) throw new Error('RocketRide is not connected yet.');
		if (abortRef.current) throw new Error('A verification is already running. Stop it before starting another.');
		const used = Math.max(meterRef.current || 0, consumedKbFromRuns(runsRef.current));
		meterRef.current = used;
		const gate = gateBatch(plan, used, opts.repos.length);
		if (gate.maxRepos < 1) throw new Error(gate.reason);
		const repos = opts.repos.slice(0, gate.maxRepos);
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
			total: repos.length,
			significant_count: 0,
			flagged_count: 0,
			done_count: 0,
			created_at,
			owner_user_id: ownerUserId,
			created_by: actor,
			updated_by: actor,
			updated_at: created_at,
			stage: gate.truncated
				? `Starting Daytona sandboxes… (${gate.reason})`
				: 'Starting Daytona sandboxes…',
		};
		writeRun(base);
		const ctrl = new AbortController();
		abortRef.current = ctrl;
		void (async () => {
			try {
				await runRepos({
					client,
					repos,
					eventDate: opts.eventDate,
					historyPenalty: opts.historyPenalty,
					runName: opts.name,
					customTarget,
					plan,
					orgLease: makeOrgLease('verify'),
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
						if (idx < 0) {
							const add = resultMetersKb(result);
							if (add > 0) {
								meterRef.current = (meterRef.current || 0) + add;
								setMeterKb(meterRef.current);
							}
						}
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
	}, [actor, client, isConnected, makeOrgLease, ownerUserId, plan, setPref, targets, writeRun]);

	const api = useMemo<RunsApi>(() => ({
		runs, targets, settings, store, saveSettings, getRun, saveTarget, deleteTarget, startBatch, stop, hydrateResults, makeOrgLease,
	}), [runs, targets, settings.grace_days, settings.history_penalty, settings.plan, settings.billingStatus, settings.meter_kb_used, store, getRun, saveTarget, deleteTarget, startBatch, stop, hydrateResults, makeOrgLease]);

	return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
};

export function useRuns(): RunsApi {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error('useRuns must be used inside RunsProvider');
	return ctx;
}
