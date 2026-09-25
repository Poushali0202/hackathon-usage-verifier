import type { StoredRun } from './types';
import { AVG_REPO_KB, nextPlanTier, planBudgetKb, remainingKb } from './verify/meter';

export function runDuration(r: StoredRun | undefined, now = Date.now()): string | null {
	if (!r?.created_at) return null;
	const start = new Date(r.created_at).getTime();
	const end = r.finished_at
		? new Date(r.finished_at).getTime()
		: (r.status === 'running' ? now : null);
	if (end == null || !Number.isFinite(start) || end < start) return null;
	const s = Math.round((end - start) / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function usesPipelineRubric(r: { scoring?: unknown; target_name?: string }): boolean {
	const mode = String(r.scoring || '').toLowerCase();
	if (mode === 'generic') return false;
	if (mode === 'pipeline') return true;
	return !r.target_name || r.target_name === 'RocketRide';
}

export const GENERIC_TAG_THRESHOLDS = { significant: 4.0, moderate: 2.0, less: 1.0 };

export function breakdownNet(breakdown?: Array<{ points?: number }>): number {
	return (breakdown || []).reduce((s, b) => s + Number(b.points || 0), 0);
}

/** One-line score identity for generic (non-RAG) verdicts. */
export function genericScoreMath(r: {
	score?: number; tag?: string; backbone?: string;
	breakdown?: Array<{ signal: string; points: number }>;
}): string {
	const parts = (r.breakdown || []).map((b) => {
		const n = Number(b.points || 0);
		const sign = n > 0 ? '+' : '';
		return `${sign}${n}`;
	});
	const net = breakdownNet(r.breakdown);
	const netTxt = `${net > 0 ? '+' : ''}${net.toFixed(1)}`;
	const floor = Math.max(0, Math.round(net * 10) / 10);
	const eq = parts.length ? `${parts.join(' ')} = ${netTxt}` : netTxt;
	if (net < 0) {
		return `${eq}, floored to ${floor.toFixed(1)} (scores cannot go below 0). Below Less (${GENERIC_TAG_THRESHOLDS.less}) → ${r.tag || 'None'}. Tag None/Less forces backbone ${r.backbone || 'No'}.`;
	}
	return `${eq}. Significant ${GENERIC_TAG_THRESHOLDS.significant} / Moderate ${GENERIC_TAG_THRESHOLDS.moderate} / Less ${GENERIC_TAG_THRESHOLDS.less} → ${r.tag || 'None'} / backbone ${r.backbone || 'No'}.`;
}

export function scoringSummary(r: {
	score?: number; tag?: string; backbone?: string;
	pipelines?: Array<{ called?: boolean }>;
	pipelines_called?: number; pipelines_total?: number;
	breakdown?: Array<{ signal: string; points: number }>;
	scoring?: unknown; target_name?: string;
}): string {
	const head = `Deterministic score ${r.score ?? 0} → ${r.tag || 'None'} / backbone ${r.backbone || 'No'}`;
	if (!usesPipelineRubric(r)) {
		const hits = (r.breakdown || []).filter((b) => b.points > 0).map((b) => b.signal).slice(0, 4);
		return hits.length ? `${head} (SDK & platform: ${hits.join('; ')}).` : `${head} (SDK & platform signals).`;
	}
	const called = typeof r.pipelines_called === 'number'
		? r.pipelines_called
		: (r.pipelines || []).filter((p) => p.called).length;
	const total = typeof r.pipelines_total === 'number'
		? r.pipelines_total
		: (r.pipelines || []).length;
	return `${head}; ${called}/${total} pipeline(s) called.`;
}

export function targetRubricHelp(target: { name?: string; is_preset?: boolean } | undefined): string {
	if (!target || target.is_preset) {
		return 'Scores committed pipelines, agent and LLM nodes, and whether RocketRide is the backbone. Use a custom target for other products.';
	}
	return `${target.name} scores SDK install, call sites, API usage, artifacts, and deploy evidence.`;
}

export function isFlagged(r: { project_predates?: unknown; history_tampered?: unknown[]; reused_pipelines?: unknown[] }): boolean {
	return !!r.project_predates
		|| (r.history_tampered?.length || 0) > 0
		|| (r.reused_pipelines?.length || 0) > 0;
}

export function summarize(results: Array<{ tag?: string; backbone?: string; classify_failed?: boolean; repo_accessible?: boolean }>): { tags: Record<string, number>; backbone: Record<string, number> } {
	const tags: Record<string, number> = {};
	const backbone: Record<string, number> = {};
	for (const r of results) {
		const failed = !!r.classify_failed || r.repo_accessible === false;
		const t = failed ? 'FAILED' : (r.tag || 'None');
		const b = r.backbone || (failed ? '—' : '?');
		tags[t] = (tags[t] || 0) + 1;
		backbone[b] = (backbone[b] || 0) + 1;
	}
	return { tags, backbone };
}

export function countsFromResults(results: Array<{ tag?: string; project_predates?: unknown; history_tampered?: unknown[]; reused_pipelines?: unknown[] }>) {
	return {
		done_count: results.length,
		significant_count: results.filter((r) => String(r.tag || '').toLowerCase().startsWith('sig')).length,
		flagged_count: results.filter(isFlagged).length,
	};
}

/** Remaining prepaid MB vs this sheet. Null when the batch fits. */
export function estimateAllowance(repoCount: number, plan: string, usedKb = 0) {
	const estimated_kb = repoCount * AVG_REPO_KB;
	const budget_kb = planBudgetKb(plan);
	const remaining_kb = remainingKb(plan, usedKb);
	const next_tier = nextPlanTier(plan);
	if (remaining_kb <= 0) {
		return {
			estimated_kb,
			budget_kb,
			remaining_kb: 0,
			used_kb: usedKb,
			est_verified_rows: 0,
			next_tier,
			blocked: true,
		};
	}
	if (estimated_kb <= remaining_kb) return null;
	return {
		estimated_kb,
		budget_kb,
		remaining_kb,
		used_kb: usedKb,
		est_verified_rows: Math.max(1, Math.floor(remaining_kb / AVG_REPO_KB)),
		next_tier,
		blocked: false,
	};
}
