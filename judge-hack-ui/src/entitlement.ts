import { planFromSubscription } from './billing';
import type { PlanTier } from './types';

/**
 * Live Store checkout. Plans are Stripe recurring prices (`interval: month`),
 * the same shape Converge uses. The shell subscribe gate requires this mode
 * plus `appManifest.mode: subscription`.
 */
export const BILLING_LIVE = true;

export const OPEN_PLAN: PlanTier = 'organizers';

export type Feature = 'targets.custom-rubric' | 'runs.history-penalty' | 'meter.enforce';

const RANK: Record<PlanTier, number> = { developer: 0, company: 1, organizers: 2 };

/** One table decides paid gates. A pricing change is an edit here. */
export const FEATURE_TIER: Record<Feature, PlanTier> = {
	'targets.custom-rubric': 'company',
	'runs.history-penalty': 'company',
	'meter.enforce': 'developer',
};

export function can(feature: Feature, plan: PlanTier): boolean {
	if (!BILLING_LIVE) return true;
	return RANK[plan] >= RANK[FEATURE_TIER[feature]];
}

/** Developer custom-target cap. Null means unlimited. Preset never counts. */
export const DEVELOPER_CUSTOM_TARGET_CAP = 2;
export const CUSTOM_TARGET_CAP_MESSAGE =
	'The Developer plan includes 2 custom targets. Upgrade to Company for unlimited targets.';

export function customTargetCap(plan: PlanTier): number | null {
	if (!BILLING_LIVE) return null;
	return plan === 'developer' ? DEVELOPER_CUSTOM_TARGET_CAP : null;
}

export function isCountedCustomTarget(target: { is_preset?: boolean; id?: string }): boolean {
	return !target.is_preset && target.id !== 'rocketride';
}

export function countedCustomTargets(targets: Array<{ is_preset?: boolean; id?: string }>): number {
	return targets.filter(isCountedCustomTarget).length;
}

/** Edits of an already-saved custom target always pass. New ids must be under the cap. */
export function canCreateCustomTarget(
	plan: PlanTier,
	targets: Array<{ is_preset?: boolean; id?: string }>,
	existingId?: string,
): boolean {
	if (existingId && targets.some((t) => t.id === existingId && isCountedCustomTarget(t))) return true;
	const cap = customTargetCap(plan);
	if (cap == null) return true;
	return countedCustomTargets(targets) < cap;
}

export function customTargetCapUi(
	plan: PlanTier,
	targets: Array<{ is_preset?: boolean; id?: string }>,
): { disabled: boolean; message: string | null } {
	const blocked = !canCreateCustomTarget(plan, targets);
	return { disabled: blocked, message: blocked ? CUSTOM_TARGET_CAP_MESSAGE : null };
}

export function resolvePlan(
	status: Parameters<typeof planFromSubscription>[0],
	entry: Parameters<typeof planFromSubscription>[1],
	fallback: PlanTier,
): PlanTier {
	if (!BILLING_LIVE) return OPEN_PLAN;
	return planFromSubscription(status, entry, fallback);
}

/** The next paid tier to pitch in the sidebar, or null on the top tier (nothing to upsell). */
export function upgradeTier(plan: PlanTier | undefined): { tier: PlanTier; label: string; pitch: string } | null {
	if (plan === 'organizers') return null;
	if (plan === 'company') return { tier: 'organizers', label: 'Organizers', pitch: 'Unlimited targets, live streaming, API access.' };
	return { tier: 'company', label: 'Company', pitch: 'Git freshness checks and custom scoring.' };
}

/**
 * Another saved target already uses this name (case-insensitive, trimmed). Chips and selects
 * show names only, so two targets with one name are indistinguishable to a judge.
 */
export function duplicateTargetName(
	targets: Array<{ id?: string; name?: string }>,
	name: string,
	excludeId?: string,
): boolean {
	const key = name.trim().toLowerCase();
	if (!key) return false;
	return targets.some((t) => t.id !== excludeId && String(t.name || '').trim().toLowerCase() === key);
}
