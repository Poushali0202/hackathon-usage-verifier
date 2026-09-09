import { ConnectionManager } from 'shell';
import type { PlanTier } from './types';

export const APP_ID = 'hackjudge.judge-hack';

export const SETTING_GRACE_DAYS = `${APP_ID}.graceDays`;
export const SETTING_HISTORY_PENALTY = `${APP_ID}.historyPenalty`;
export const SETTING_STORE_VARIANT = `${APP_ID}.storeVariant`;

export const BILLING_PLANS = [
	{ nickname: 'Developer', amountCents: 2000, currency: 'usd', interval: 'one_time' as const },
	{ nickname: 'Company', amountCents: 10000, currency: 'usd', interval: 'one_time' as const },
	{ nickname: 'Organizers', amountCents: 20000, currency: 'usd', interval: 'one_time' as const },
] as const;

type AppStatus = 'auth' | 'free' | 'unsubscribed' | 'subscribed' | 'trialing' | 'past_due' | 'canceled';

type BilledApp = {
	features?: string[];
	stripePrices?: Array<{ nickname?: string }>;
};

function nickOf(entry?: BilledApp): string {
	if (!entry) return '';
	const fromPrice = String(entry.stripePrices?.[0]?.nickname || '');
	const feats = (entry.features || []).join(' ');
	return `${fromPrice} ${feats}`.toLowerCase();
}

export function planFromSubscription(
	status: AppStatus | undefined,
	entry: BilledApp | undefined,
	fallback: PlanTier,
): PlanTier {
	if (status === 'subscribed' || status === 'trialing') {
		const blob = nickOf(entry);
		if (blob.includes('organizer')) return 'organizers';
		if (blob.includes('developer') && !blob.includes('company')) return 'developer';
		if (blob.includes('company') || blob.includes('git-freshness') || blob.includes('custom-rubric')) return 'company';
		return 'company';
	}
	if (status === 'unsubscribed' || status === 'canceled' || status === 'past_due') return 'developer';
	// free / auth / undefined — Store prices are not live yet; keep the workspace usable.
	return fallback === 'developer' ? 'developer' : 'company';
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

/**
 * Open the in-app checkout dialog. Do not emit shell:subscribe here — in the
 * Design preview that opens the host CheckoutModal, which hangs while it
 * waits for Store Stripe prices that are not live yet.
 */
export function openCheckout(plan?: PlanTier): void {
	checkoutListeners.forEach((fn) => fn(plan));
}
