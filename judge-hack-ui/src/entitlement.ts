import { planFromSubscription } from './billing';
import type { PlanTier } from './types';

/**
 * Flip to true only after Store Stripe prices and the webhook are live.
 * Josh: do not wire billing while staging checkout is not set up.
 * Converge: fail OPEN to the highest tier rather than lock testers out.
 * The tables and checkout code stay; this flag only disables enforcement.
 */
export const BILLING_LIVE = false;

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

export function resolvePlan(
	status: Parameters<typeof planFromSubscription>[0],
	entry: Parameters<typeof planFromSubscription>[1],
	fallback: PlanTier,
): PlanTier {
	if (!BILLING_LIVE) return OPEN_PLAN;
	return planFromSubscription(status, entry, fallback);
}
