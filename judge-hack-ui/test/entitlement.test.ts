import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BILLING_LIVE, OPEN_PLAN, can, resolvePlan, upgradeTier } from '../src/entitlement';

describe('entitlement (Converge-style Store checkout)', () => {
	it('enforces plans once Stripe recurring checkout is live', () => {
		expect(BILLING_LIVE).toBe(true);
	});
	it('declares subscription mode with monthly prices (not one_time)', () => {
		const pkg = JSON.parse(fs.readFileSync(
			path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
			'utf8',
		));
		expect(pkg.appManifest.mode).toBe('subscription');
		const plans = pkg.appManifest.billing.plans as Array<{
			nickname: string; amountCents: number; interval: string; metadata?: { kind?: string };
		}>;
		expect(plans.every((p) => p.interval === 'month')).toBe(true);
		// Three paid tiers plus exactly one hidden $0 promo-base plan: it must
		// carry kind=promo_base (the checkout picker hides it) and a nickname
		// that resolves to the organizers tier, and it must stay $0 (hackathon
		// codes may only target a $0 price; the code is the gate, not a discount).
		const paid = plans.filter((p) => p.amountCents > 0);
		const promoBase = plans.filter((p) => p.metadata?.kind === 'promo_base');
		expect(paid.length).toBe(3);
		expect(promoBase.length).toBe(1);
		expect(promoBase[0].amountCents).toBe(0);
		expect(promoBase[0].nickname.toLowerCase()).toContain('organizer');
	});
	it('gates Company features on the Company plan', () => {
		expect(can('targets.custom-rubric', 'developer')).toBe(false);
		expect(can('targets.custom-rubric', 'company')).toBe(true);
		expect(can('runs.history-penalty', 'developer')).toBe(false);
		expect(can('meter.enforce', 'developer')).toBe(true);
	});
	it('maps unpaid to Developer and paid nicknames to the matching tier', () => {
		expect(resolvePlan('unsubscribed', undefined, 'developer')).toBe('developer');
		expect(resolvePlan('canceled', undefined, 'company')).toBe('developer');
		expect(resolvePlan('subscribed', { planNickname: 'Developer' }, 'company')).toBe('developer');
		expect(resolvePlan('subscribed', { planNickname: 'Organizers' }, 'developer')).toBe('organizers');
		expect(resolvePlan('subscribed', {
			stripePrices: [{ nickname: 'Company' }],
			features: ['core-scoring', 'excel-export'],
		}, 'company')).toBe('developer');
		expect(OPEN_PLAN).toBe('organizers');
	});
});

describe('upgradeTier (QA A3)', () => {
	it('has nothing to upsell on the top tier', () => {
		expect(upgradeTier('organizers')).toBeNull();
	});
	it('points Company at Organizers and everyone else at Company', () => {
		expect(upgradeTier('company')?.tier).toBe('organizers');
		expect(upgradeTier('developer')?.tier).toBe('company');
		expect(upgradeTier(undefined)?.tier).toBe('company');
	});
});
