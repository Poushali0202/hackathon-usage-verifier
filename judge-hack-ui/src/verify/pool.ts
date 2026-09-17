import type { PlanTier } from '../types';

/**
 * We provide Daytona on the org key. Isolation is per-plan sandbox caps plus
 * an org-wide SQL lease (DAYTONA_ORG_SLOTS) plus tear-down — not BYOC, not an
 * occupancy lock. Daytona itself has been observed to allow more than 5 live
 * boxes on this org key, so the app enforces the 10 vCPU / 5-box wall.
 */
export const DAYTONA_VCPU_PER_SANDBOX = 2;
export const DAYTONA_TIER1_VCPU = 10;
export const DAYTONA_ORG_SLOTS = Math.floor(DAYTONA_TIER1_VCPU / DAYTONA_VCPU_PER_SANDBOX);
export const DAYTONA_WORKERS_DEFAULT = 2;
export const DAYTONA_WORKERS_COMPANY = 3;

export function isDaytonaCpuLimit(message: string): boolean {
	return /cpu limit exceeded|concurrency limits|maximum allowed:\s*\d+|app\.daytona\.io\/dashboard\/limits/i.test(message || '');
}

export function planWorkerCap(plan?: PlanTier): number {
	return (plan === 'company' || plan === 'organizers') ? DAYTONA_WORKERS_COMPANY : DAYTONA_WORKERS_DEFAULT;
}

export function daytonaWorkerCount(
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

/** TTL is leftover insurance if terminate fails. Keep it tight on the 10 vCPU pool. */
export function sandboxTtlSeconds(repoCount: number, workers: number): number {
	const w = Math.max(1, workers);
	return Math.max(240, Math.ceil(Math.max(0, repoCount) / w) * 180 + 120);
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
