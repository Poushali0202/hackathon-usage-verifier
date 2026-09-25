import type { PlanTier } from '../types';

/**
 * Evaluations run as tool_python calls on the shared RocketRide engine, one
 * repo at a time per worker task. Isolation is per-plan worker caps plus an
 * org-wide SQL lease (ORG_SLOTS) so overlapping judges queue instead of
 * saturating the engine and GitHub rate limits.
 */
export const ORG_SLOTS = 5;
export const WORKERS_DEFAULT = 2;
export const WORKERS_COMPANY = 3;

export function planWorkerCap(plan?: PlanTier): number {
	return (plan === 'company' || plan === 'organizers') ? WORKERS_COMPANY : WORKERS_DEFAULT;
}

export function workerCount(
	repoCount: number,
	plan?: PlanTier,
	override?: number,
	orgRemaining?: number,
): number {
	if (repoCount <= 0) return 0;
	const planCap = planWorkerCap(plan);
	const requested = override != null && Number.isFinite(override) && override > 0
		? Math.floor(override)
		: planCap;
	let cap = Math.min(planCap, requested);
	if (orgRemaining != null && Number.isFinite(orgRemaining)) {
		cap = Math.min(cap, Math.max(0, Math.floor(orgRemaining)));
	}
	if (cap <= 0) return 0;
	return Math.max(1, Math.min(cap, repoCount));
}

/** Task-token TTL is leftover insurance if terminate fails. */
export function workerTtlSeconds(repoCount: number, workers: number): number {
	const w = Math.max(1, workers);
	return Math.max(240, Math.ceil(Math.max(0, repoCount) / w) * 180 + 120);
}

/**
 * Task tokens are keyed by project_id + source. Two client.use() calls with the
 * same pipe identity return "Pipeline is already running" — the pool would
 * silently drop to one worker. Give each worker a fresh project_id.
 */
export function clonePipelineForWorker<T extends { project_id?: string }>(pipeline: T): T {
	const copy = JSON.parse(JSON.stringify(pipeline)) as T;
	copy.project_id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
		? crypto.randomUUID()
		: `hj-worker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return copy;
}
