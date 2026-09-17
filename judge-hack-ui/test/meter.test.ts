import { describe, expect, it } from 'vitest';
import {
	AVG_REPO_KB,
	consumedKbFromRuns,
	formatDataKb,
	gateBatch,
	planBudgetKb,
	remainingKb,
	resultMetersKb,
} from '../src/verify/meter';

describe('plan budgets', () => {
	it('matches the $5/MB listing', () => {
		expect(planBudgetKb('developer')).toBe(4000);
		expect(planBudgetKb('company')).toBe(20000);
		expect(planBudgetKb('organizers')).toBe(40000);
		expect(formatDataKb(4000)).toBe('4 MB');
	});
});

describe('resultMetersKb', () => {
	it('does not bill rows that never occupied a sandbox', () => {
		expect(resultMetersKb({ status: 'unverifiable', reason: 'Run stopped before this repo started' })).toBe(0);
		expect(resultMetersKb({ status: 'unverifiable', reason: 'No Daytona sandbox was available' })).toBe(0);
		expect(resultMetersKb({
			status: 'unverifiable',
			reason: 'Daytona sandbox error: Total CPU limit exceeded. Maximum allowed: 10.',
		})).toBe(0);
		expect(resultMetersKb({
			status: 'unverifiable',
			reason: 'Included compute is busy. Retry in a moment.',
		})).toBe(0);
	});
	it('bills a completed (or failed-after-clone) row at the average repo size', () => {
		expect(resultMetersKb({ status: 'complete', tag: 'Significant' })).toBe(AVG_REPO_KB);
		expect(resultMetersKb({ status: 'unverifiable', reason: 'repo inaccessible' })).toBe(AVG_REPO_KB);
	});
});

describe('gateBatch', () => {
	it('refuses the next run at zero remaining', () => {
		const gate = gateBatch('developer', 4000, 1);
		expect(gate.blocked).toBe(true);
		expect(gate.maxRepos).toBe(0);
		expect(gate.reason).toMatch(/empty/i);
	});
	it('truncates a sheet that would overshoot remaining allowance', () => {
		const gate = gateBatch('developer', 0, 20);
		expect(gate.blocked).toBe(false);
		expect(gate.maxRepos).toBe(8);
		expect(gate.truncated).toBe(true);
		expect(remainingKb('developer', 0)).toBe(4000);
	});
	it('counts prior runs against the remaining budget', () => {
		const used = consumedKbFromRuns([
			{ results: [{ status: 'complete' }, { status: 'complete' }] },
		]);
		expect(used).toBe(1000);
		expect(gateBatch('developer', used, 8).maxRepos).toBe(6);
	});
});
