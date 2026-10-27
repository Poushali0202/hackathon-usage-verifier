import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	onManageBillingRequest,
	openManageBilling,
	summarizeSubscription,
} from '../src/billing';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string) => fs.readFileSync(path.join(srcDir, rel), 'utf8');

describe('manage billing (platform panel is the lifecycle surface)', () => {
	it('notifies subscribers and honors unsubscribe', () => {
		let calls = 0;
		const off = onManageBillingRequest(() => { calls += 1; });
		openManageBilling();
		expect(calls).toBe(1);
		off();
		openManageBilling();
		expect(calls).toBe(1);
	});

	it('routes the subscribed current plan to manage billing, everything else to checkout', () => {
		const pricing = read('pages/Pricing.tsx');
		expect(pricing).toMatch(/hasSubscription && current === name\.toLowerCase\(\)\s*\?\s*openManageBilling\(\)/);
		expect(pricing).toContain('openCheckout(name.toLowerCase() as PlanTier)');
		expect(pricing).toContain('Manage billing');
		// Unsubscribed users resolve to the developer tier; their card must
		// still say Subscribe, so the manage gate requires a real subscription.
		expect(pricing).toMatch(/\[\s*'subscribed',\s*'trialing',\s*'past_due'\s*\]/);
	});

	it('summarizes an active subscription with a renew date', () => {
		const s = summarizeSubscription({
			planNickname: 'Developer',
			unitAmount: 2000,
			billingInterval: 'month',
			currentPeriodEnd: '2026-11-09T00:00:00Z',
			cancelAtPeriodEnd: false,
			status: 'active',
		});
		expect(s.plan).toBe('Developer · $20 per month');
		expect(s.status).toMatch(/^Renews on /);
		expect(s.ending).toBe(false);
	});

	it('summarizes a scheduled cancellation with a date', () => {
		const s = summarizeSubscription({
			planNickname: 'Developer',
			unitAmount: 2000,
			billingInterval: 'month',
			currentPeriodEnd: '2026-11-09T00:00:00Z',
			cancelAtPeriodEnd: true,
			status: 'active',
		});
		expect(s.status).toMatch(/^Cancels on /);
		expect(s.ending).toBe(true);
	});

	it('survives null period dates (saas #850 nulls them after a cancel)', () => {
		const s = summarizeSubscription({
			planNickname: 'Developer',
			unitAmount: 2000,
			billingInterval: 'month',
			currentPeriodEnd: null,
			cancelAtPeriodEnd: true,
			status: 'active',
		});
		expect(s.status).toBe('Ends when the current billing period ends.');
		expect(s.status).not.toContain('Invalid');
		expect(s.ending).toBe(true);
	});

	it('survives unparseable dates and missing rows', () => {
		const bad = summarizeSubscription({
			planNickname: 'Company',
			currentPeriodEnd: 'not-a-date',
			cancelAtPeriodEnd: false,
			status: 'active',
		});
		expect(bad.status).toBe('Active.');
		expect(bad.status).not.toContain('Invalid');
		const none = summarizeSubscription(null);
		expect(none.plan).toBe('No subscription found for this organization.');
		expect(none.ending).toBe(false);
	});

	it('flags past_due with a pointer to Account Billing', () => {
		const s = summarizeSubscription({
			planNickname: 'Developer',
			cancelAtPeriodEnd: false,
			status: 'past_due',
		});
		expect(s.status).toContain('past due');
		expect(s.status).toContain('Account Billing');
	});

	it('makes no subscription lifecycle calls from the app', () => {
		for (const rel of ['ManageBillingHost.tsx', 'billing.ts', 'pages/Pricing.tsx']) {
			const src = read(rel);
			expect(src).not.toContain('cancelSubscription');
			expect(src).not.toContain('createPortalSession');
		}
	});

	it('contains no em dashes in the new UI strings', () => {
		for (const rel of ['ManageBillingHost.tsx', 'billing.ts']) {
			expect(read(rel)).not.toContain('—');
		}
	});
});
