import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useShellConnection } from 'shell';
import { useRuns } from './RunsContext';
import { explainPipeline, explainVerdict } from './verify/explain';
import {
	ANTHROPIC_KEY_NAME,
	NARRATION_COPY,
	applyNarration,
	batchConfirm,
	classifyNarrateError,
	endSummary,
	narratableIndexes,
	progressLine,
	readNarrationOn,
	type EnvKeysClient,
} from './verify/narration';
import type { VerifyClient } from './verify/session';

type NarrationApi = {
	narrationOn: boolean | null;
	busy: boolean;
	progress: string | null;
	toast: string | null;
	enableOpen: boolean;
	checkError: string | null;
	checking: boolean;
	openEnable: () => void;
	closeEnable: () => void;
	checkAgain: () => Promise<boolean>;
	refreshNarration: () => Promise<boolean>;
	narrateProject: (runId: string, index: number) => Promise<void>;
	narrateRun: (runId: string) => Promise<void>;
	cancelNarrate: () => void;
};

const Ctx = createContext<NarrationApi | null>(null);

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const NarrationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { client, isConnected } = useShellConnection();
	const { getRun, patchResult } = useRuns();
	const [narrationOn, setNarrationOn] = useState<boolean | null>(null);
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [enableOpen, setEnableOpen] = useState(false);
	const [checkError, setCheckError] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);
	const cancelRef = useRef(false);
	const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showToast = useCallback((text: string) => {
		setToast(text);
		if (toastTimer.current) window.clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToast(null), 5000);
	}, []);

	const refreshNarration = useCallback(async () => {
		if (!client || !isConnected) {
			setNarrationOn(false);
			return false;
		}
		try {
			const on = await readNarrationOn(client as unknown as EnvKeysClient);
			setNarrationOn(on);
			return on;
		} catch {
			setNarrationOn(false);
			return false;
		}
	}, [client, isConnected]);

	useEffect(() => {
		void refreshNarration();
	}, [refreshNarration]);

	const checkAgain = useCallback(async () => {
		setChecking(true);
		setCheckError(null);
		try {
			const on = await refreshNarration();
			if (on) {
				setEnableOpen(false);
				showToast(NARRATION_COPY.toastOn);
				return true;
			}
			setCheckError(NARRATION_COPY.notFound);
			return false;
		} finally {
			setChecking(false);
		}
	}, [refreshNarration, showToast]);

	const narrateOne = useCallback(async (runId: string, index: number): Promise<'ok' | 'transient' | 'auth'> => {
		const run = getRun(runId);
		const stored = run?.results[index];
		if (!stored || !client) return 'transient';
		const row = {
			project: stored.project || '',
			github: stored.github || '',
			names: stored.names,
			feedback: '',
			target_name: stored.target_name || run?.target_name,
		};
		try {
			const boot = await (client as VerifyClient).use({
				pipeline: explainPipeline,
				name: `Judge Hack narrate · ${stored.project || index}`,
				ttl: 300,
			});
			try {
				const explained = await explainVerdict(client as VerifyClient, boot.token, stored, row);
				const next = applyNarration(stored, explained);
				if (next === stored || next.explain_failed) return 'transient';
				patchResult(runId, index, next);
				return 'ok';
			} finally {
				await (client as VerifyClient).terminate(boot.token).catch(() => undefined);
			}
		} catch (err) {
			const kind = classifyNarrateError(err instanceof Error ? err.message : String(err));
			if (kind === 'rate') {
				await sleep(10_000);
				try {
					const boot = await (client as VerifyClient).use({
						pipeline: explainPipeline,
						name: `Judge Hack narrate retry · ${stored.project || index}`,
						ttl: 300,
					});
					try {
						const explained = await explainVerdict(client as VerifyClient, boot.token, stored, row);
						const next = applyNarration(stored, explained);
						if (next === stored || next.explain_failed) return 'transient';
						patchResult(runId, index, next);
						return 'ok';
					} finally {
						await (client as VerifyClient).terminate(boot.token).catch(() => undefined);
					}
				} catch (retryErr) {
					return classifyNarrateError(retryErr instanceof Error ? retryErr.message : String(retryErr)) === 'auth'
						? 'auth'
						: 'transient';
				}
			}
			return kind === 'auth' ? 'auth' : 'transient';
		}
	}, [client, getRun, patchResult]);

	const narrateIndexes = useCallback(async (runId: string, indexes: number[]) => {
		if (busy || !indexes.length) return;
		cancelRef.current = false;
		setBusy(true);
		setProgress(null);
		let k = 0;
		let m = 0;
		const n = indexes.length;
		try {
			for (let i = 0; i < indexes.length; i++) {
				if (cancelRef.current) {
					m += indexes.length - i;
					break;
				}
				setProgress(progressLine(i + 1, n));
				const outcome = await narrateOne(runId, indexes[i]);
				if (outcome === 'auth') {
					showToast(NARRATION_COPY.authFailure);
					m += indexes.length - i;
					return;
				}
				if (outcome === 'ok') k += 1;
				else m += 1;
			}
			if (n > 1 || m > 0) showToast(endSummary(k, n, m));
		} finally {
			setBusy(false);
			setProgress(null);
		}
	}, [busy, narrateOne, showToast]);

	const narrateProject = useCallback(async (runId: string, index: number) => {
		await narrateIndexes(runId, [index]);
	}, [narrateIndexes]);

	const narrateRun = useCallback(async (runId: string) => {
		const run = getRun(runId);
		const indexes = narratableIndexes(run?.results);
		if (indexes.length >= 2 && !window.confirm(batchConfirm(indexes.length))) return;
		await narrateIndexes(runId, indexes);
	}, [getRun, narrateIndexes]);

	const api = useMemo<NarrationApi>(() => ({
		narrationOn,
		busy,
		progress,
		toast,
		enableOpen,
		checkError,
		checking,
		openEnable: () => { setCheckError(null); setEnableOpen(true); },
		closeEnable: () => setEnableOpen(false),
		checkAgain,
		refreshNarration,
		narrateProject,
		narrateRun,
		cancelNarrate: () => { cancelRef.current = true; },
	}), [narrationOn, busy, progress, toast, enableOpen, checkError, checking, checkAgain, refreshNarration, narrateProject, narrateRun]);

	return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
};

export function useNarration(): NarrationApi {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error('useNarration must be used inside NarrationProvider');
	return ctx;
}

void ANTHROPIC_KEY_NAME;
