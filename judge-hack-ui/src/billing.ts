import { ConnectionManager } from 'shell';
import type { PlanTier } from './types';

export const APP_ID = 'hackjudge.judge-hack';

export const SETTING_GRACE_DAYS = `${APP_ID}.graceDays`;
export const SETTING_HISTORY_PENALTY = `${APP_ID}.historyPenalty`;
export const SETTING_STORE_VARIANT = `${APP_ID}.storeVariant`;

export const BILLING_PLANS = [
	{ nickname: 'Developer', amountCents: 2000, currency: 'usd', interval: 'month' as const },
	{ nickname: 'Company', amountCents: 10000, currency: 'usd', interval: 'month' as const },
	{ nickname: 'Organizers', amountCents: 20000, currency: 'usd', interval: 'month' as const },
] as const;

type AppStatus = 'auth' | 'free' | 'unsubscribed' | 'subscribed' | 'trialing' | 'past_due' | 'canceled';

export type BilledApp = {
	features?: string[];
	/** Catalog prices for the product. Do not use [0] as the subscribed plan. */
	stripePrices?: Array<{ nickname?: string }>;
	/** Nickname of the price the org is actually subscribed to. */
	planNickname?: string | null;
};

const PLAN_TIERS: PlanTier[] = ['developer', 'company', 'organizers'];

export function asPlanTier(value: unknown): PlanTier | undefined {
	return PLAN_TIERS.includes(value as PlanTier) ? value as PlanTier : undefined;
}

/** Map a Stripe price nickname onto a Judge Hack tier. */
export function planFromNickname(nickname?: string | null): PlanTier | undefined {
	const n = String(nickname || '').toLowerCase();
	if (!n) return undefined;
	if (n.includes('organizer')) return 'organizers';
	if (n.includes('developer')) return 'developer';
	if (n.includes('company')) return 'company';
	return undefined;
}

/**
 * Map subscribed-plan feature flags onto a tier.
 * These flags come from the subscribed price metadata, not the catalog.
 */
export function planFromFeatures(features?: string[]): PlanTier | undefined {
	const feats = (features || []).map((f) => String(f).toLowerCase());
	if (!feats.length) return undefined;
	if (feats.some((f) => f.includes('organizer'))) return 'organizers';
	if (feats.some((f) => f.includes('git-freshness') || f.includes('custom-rubric'))) return 'company';
	return 'developer';
}

export function planFromSubscription(
	status: AppStatus | undefined,
	entry: BilledApp | undefined,
	fallback: PlanTier,
): PlanTier {
	if (status === 'subscribed' || status === 'trialing') {
		return planFromNickname(entry?.planNickname)
			|| planFromFeatures(entry?.features)
			|| 'developer';
	}
	if (status === 'unsubscribed' || status === 'canceled' || status === 'past_due') return 'developer';
	return asPlanTier(fallback) || 'developer';
}

export function isCompanyPlan(plan: PlanTier): boolean {
	return plan === 'company' || plan === 'organizers';
}

const checkoutListeners = new Set<(plan?: PlanTier) => void>();

/** Subscribe to in-app checkout requests. Returns an unsubscribe. */
export function onCheckoutRequest(listener: (plan?: PlanTier) => void): () => void {
	checkoutListeners.add(listener);
	return () => { checkoutListeners.delete(listener); };
}

/** Open RocketRide Account (profile + billing) in the shell overlay. */
export function openAccount(): void {
	ConnectionManager.getInstance().emit('shell:openOverlay', { id: 'account' });
}

/** Open Settings → Environment Variables (org / team / user keys). */
export function openEnvironment(): void {
	ConnectionManager.getInstance().emit('shell:openOverlay', { id: 'environment' });
}

/**
 * Open the in-app checkout dialog (same Stripe CheckoutModal the Store
 * Subscribe button uses). Store listing checkout is `shell:subscribe`; this
 * path is for in-app Subscribe / Plans.
 */
export function openCheckout(plan?: PlanTier): void {
	checkoutListeners.forEach((fn) => fn(plan));
}

const manageBillingListeners = new Set<() => void>();

/** Subscribe to in-app manage-billing requests. Returns an unsubscribe. */
export function onManageBillingRequest(listener: () => void): () => void {
	manageBillingListeners.add(listener);
	return () => { manageBillingListeners.delete(listener); };
}

/**
 * Open the Manage billing dialog (current plan, renewal/cancel state, and
 * the route to the platform Billing panel). Lifecycle actions themselves
 * (cancel, change plan, payment methods) stay on the platform surface:
 * Account > Billing already implements them with org-admin gating.
 */
export function openManageBilling(): void {
	manageBillingListeners.forEach((fn) => fn());
}

/** The slice of the SDK's BillingDetail the Manage billing dialog renders. */
export type SubscriptionDetail = {
	planNickname?: string | null;
	unitAmount?: number | null;
	billingInterval?: string | null;
	/** ISO 8601 or null. Null happens in the wild (saas #850 nulls it after a cancel). */
	currentPeriodEnd?: string | null;
	cancelAtPeriodEnd?: boolean;
	status?: string;
};

export type SubscriptionSummary = {
	/** Plan line, e.g. "Developer · $20 per month". */
	plan: string;
	/** One status sentence. Never contains "Invalid Date". */
	status: string;
	/** True when the subscription is scheduled to end at period end. */
	ending: boolean;
};

function periodEndDate(iso?: string | null): string | null {
	if (!iso) return null;
	const t = new Date(iso);
	return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString();
}

/**
 * Render-ready summary of a subscription row. Date fields may be null or
 * unparseable (the platform nulls them after a cancel, saas #850), so every
 * branch has a dateless fallback.
 */
export function summarizeSubscription(detail?: SubscriptionDetail | null): SubscriptionSummary {
	if (!detail) {
		return { plan: 'No subscription found for this organization.', status: '', ending: false };
	}
	const nickname = detail.planNickname || 'Subscribed';
	const price = detail.unitAmount != null
		? ` · $${(detail.unitAmount / 100).toFixed(0)} per ${detail.billingInterval || 'month'}`
		: '';
	const date = periodEndDate(detail.currentPeriodEnd);
	if (detail.cancelAtPeriodEnd) {
		return {
			plan: nickname + price,
			status: date ? `Cancels on ${date}.` : 'Ends when the current billing period ends.',
			ending: true,
		};
	}
	if (detail.status === 'past_due') {
		return {
			plan: nickname + price,
			status: 'Payment past due. Open your Account Billing to update the payment method.',
			ending: false,
		};
	}
	return {
		plan: nickname + price,
		status: date ? `Renews on ${date}.` : 'Active.',
		ending: false,
	};
}
