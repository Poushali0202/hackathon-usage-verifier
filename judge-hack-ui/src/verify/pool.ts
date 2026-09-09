import type { PlanTier } from '../types';

/** Original FastAPI app used 4. Company / Organizers get 8 so a 40–50 repo sheet can finish in minutes. */
export const DAYTONA_WORKERS_DEFAULT = 4;
export const DAYTONA_WORKERS_COMPANY = 8;

export function daytonaWorkerCount(repoCount: number, plan?: PlanTier, override?: number): number {
	if (repoCount <= 0) return 0;
	const cap = override
		?? ((plan === 'company' || plan === 'organizers') ? DAYTONA_WORKERS_COMPANY : DAYTONA_WORKERS_DEFAULT);
	return Math.max(1, Math.min(cap, repoCount));
}

/**
 * Task tokens are keyed by project_id + source. Two client.use() calls with the
 * same pipe identity return "Pipeline is already running" — the pool would
 * silently drop to one sandbox. Give each worker a fresh project_id.
 */
export function clonePipelineForSandbox<T extends { project_id?: string }>(pipeline: T): T {
	const copy = JSON.parse(JSON.stringify(pipeline)) as T;
	copy.project_id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
		? crypto.randomUUID()
		: `hj-sandbox-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return copy;
}
