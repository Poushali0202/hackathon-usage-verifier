import { describe, expect, it } from 'vitest';
import { BILLING_LIVE, OPEN_PLAN, can, resolvePlan } from '../src/entitlement';

describe('entitlement (testing fail-open)', () => {
	it('keeps billing enforcement off until Store checkout is wired', () => {
		expect(BILLING_LIVE).toBe(false);
	});
	it('opens every gated feature while billing is paused', () => {
		expect(can('targets.custom-rubric', 'developer')).toBe(true);
		expect(can('runs.history-penalty', 'developer')).toBe(true);
		expect(can('meter.enforce', 'developer')).toBe(true);
	});
	it('resolves the highest tier so testers are not locked to Developer', () => {
		expect(resolvePlan('unsubscribed', undefined, 'developer')).toBe(OPEN_PLAN);
		expect(resolvePlan('canceled', undefined, 'developer')).toBe(OPEN_PLAN);
		expect(resolvePlan('subscribed', { stripePrices: [{ nickname: 'Developer' }] }, 'developer')).toBe(OPEN_PLAN);
	});
});
