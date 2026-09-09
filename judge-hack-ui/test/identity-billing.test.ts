import { describe, expect, it } from 'vitest';
import { isCompanyPlan, planFromSubscription } from '../src/billing';
import { actorFrom } from '../src/identity';

describe('actorFrom', () => {
	it('requires a real userId and never invents an actor', () => {
		expect(actorFrom(null)).toBeUndefined();
		expect(actorFrom({} as never)).toBeUndefined();
		expect(actorFrom({ userId: 'u-1', email: 'a@b.c', preferredUsername: 'Ada' })).toEqual({
			userId: 'u-1',
			email: 'a@b.c',
			displayName: 'Ada',
		});
	});
});

describe('planFromSubscription', () => {
	it('maps live entitlements from nickname / features', () => {
		expect(planFromSubscription('subscribed', { stripePrices: [{ nickname: 'Organizers' }] }, 'developer')).toBe('organizers');
		expect(planFromSubscription('trialing', { features: ['git-freshness'] }, 'developer')).toBe('company');
		expect(planFromSubscription('subscribed', { stripePrices: [{ nickname: 'Developer' }] }, 'company')).toBe('developer');
	});
	it('drops canceled / past_due to Developer', () => {
		expect(planFromSubscription('canceled', { stripePrices: [{ nickname: 'Company' }] }, 'company')).toBe('developer');
		expect(planFromSubscription('past_due', undefined, 'company')).toBe('developer');
	});
	it('keeps the workspace usable before Store prices exist', () => {
		expect(planFromSubscription('free', undefined, 'company')).toBe('company');
		expect(planFromSubscription(undefined, undefined, 'developer')).toBe('developer');
	});
	it('treats Organizers as Company-gated', () => {
		expect(isCompanyPlan('developer')).toBe(false);
		expect(isCompanyPlan('company')).toBe(true);
		expect(isCompanyPlan('organizers')).toBe(true);
	});
});
