import type { PlanTier, StoredRun, VerifyResult } from '../types';

/** Matches the Plans page: $5 / MB, average repo 500 KB. */
export const AVG_REPO_KB = 500;

export const PLAN_BUDGET_KB: Record<PlanTier, number> = {
	developer: 4000,
	company: 20000,
	organizers: 40000,
};

export function planBudgetKb(plan?: string): number {
	if (plan === 'developer' || plan === 'company' || plan === 'organizers') return PLAN_BUDGET_KB[plan];
	return PLAN_BUDGET_KB.company;
}

export function remainingKb(plan: string | undefined, usedKb: number): number {
	return Math.max(0, planBudgetKb(plan) - Math.max(0, usedKb));
}

export function nextPlanTier(plan: string): string | undefined {
	if (plan === 'developer') return 'company';
	if (plan === 'company') return 'organizers';
	return undefined;
}

export function formatDataKb(kb: number): string {
	if (kb >= 1000) return `${+(kb / 1000).toFixed(1)} MB`;
	return `${Math.max(0, Math.round(kb))} KB`;
}

/** A row whose evaluation never started (or never fetched code) does not draw the prepaid meter. */
export function resultMetersKb(result: Pick<VerifyResult, 'reason' | 'status'>): number {
	const reason = String(result.reason || '');
	const status = String(result.status || '');
	if (/run stopped before this repo started/i.test(reason)) return 0;
	if (/no evaluator worker was available/i.test(reason)) return 0;
	if (/github token missing/i.test(reason)) return 0;
	if (/could not read your rocketride environment/i.test(reason)) return 0;
	if (/^Evaluator error:/i.test(reason)) return 0;
	if (/evaluator timed out/i.test(reason)) return 0;
	if (/included compute is busy/i.test(reason)) return 0;
	// Evaluator crashes and missing repos never produced scored code — do not drain prepaid.
	if (/TypeError|AttributeError|NameError|gather\(\) takes/i.test(reason)) return 0;
	if (/GitHub returned HTTP 404/i.test(reason)) return 0;
	if (status && status !== 'complete' && /takes from \d+ to \d+ positional arguments/i.test(reason)) return 0;
	return AVG_REPO_KB;
}

export function consumedKbFromRuns(runs: Array<Pick<StoredRun, 'results'>>): number {
	let kb = 0;
	for (const run of runs) {
		for (const row of run.results || []) kb += resultMetersKb(row);
	}
	return kb;
}

export type BatchGate = {
	maxRepos: number;
	remaining_kb: number;
	truncated: boolean;
	blocked: boolean;
	reason: string;
};

export function gateBatch(plan: string | undefined, usedKb: number, repoCount: number): BatchGate {
	const remaining_kb = remainingKb(plan, usedKb);
	const maxRepos = Math.floor(remaining_kb / AVG_REPO_KB);
	if (repoCount <= 0) {
		return { maxRepos: 0, remaining_kb, truncated: false, blocked: false, reason: 'Add at least one repository.' };
	}
	if (maxRepos < 1) {
		return {
			maxRepos: 0,
			remaining_kb,
			truncated: false,
			blocked: true,
			reason: 'Prepaid allowance is empty. The next verification is refused until you upgrade.',
		};
	}
	const allowed = Math.min(repoCount, maxRepos);
	return {
		maxRepos: allowed,
		remaining_kb,
		truncated: allowed < repoCount,
		blocked: false,
		reason: allowed < repoCount
			? `Only ${allowed} of ${repoCount} repos fit the remaining allowance.`
			: '',
	};
}
