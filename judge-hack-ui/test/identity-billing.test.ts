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
	it('maps the subscribed nickname, not catalog stripePrices[0]', () => {
		const catalog = {
			stripePrices: [{ nickname: 'Company' }, { nickname: 'Organizers' }, { nickname: 'Developer' }],
			features: ['core-scoring', 'excel-export'],
			planNickname: 'Developer',
		};
		expect(planFromSubscription('subscribed', catalog, 'company')).toBe('developer');
		expect(planFromSubscription('subscribed', { planNickname: 'Organizers' }, 'developer')).toBe('organizers');
		expect(planFromSubscription('trialing', { features: ['git-freshness'] }, 'developer')).toBe('company');
	});
	it('does not treat the product catalog as the subscribed plan', () => {
		expect(planFromSubscription('subscribed', {
			stripePrices: [{ nickname: 'Company' }],
			features: ['core-scoring', 'excel-export'],
		}, 'company')).toBe('developer');
	});
	it('drops canceled / past_due to Developer', () => {
		expect(planFromSubscription('canceled', { stripePrices: [{ nickname: 'Company' }] }, 'company')).toBe('developer');
		expect(planFromSubscription('past_due', undefined, 'company')).toBe('developer');
	});
	it('uses the fallback only when there is no subscription yet', () => {
		expect(planFromSubscription('free', undefined, 'company')).toBe('company');
		expect(planFromSubscription(undefined, undefined, 'developer')).toBe('developer');
		expect(planFromSubscription('auth', undefined, 'organizers')).toBe('organizers');
	});
	it('treats Organizers as Company-gated', () => {
		expect(isCompanyPlan('developer')).toBe(false);
		expect(isCompanyPlan('company')).toBe(true);
		expect(isCompanyPlan('organizers')).toBe(true);
	});
});
