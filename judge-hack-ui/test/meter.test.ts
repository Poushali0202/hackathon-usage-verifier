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
	it('does not bill rows whose evaluation never started', () => {
		expect(resultMetersKb({ status: 'unverifiable', reason: 'Run stopped before this repo started' })).toBe(0);
		expect(resultMetersKb({ status: 'unverifiable', reason: 'No evaluator worker was available' })).toBe(0);
		expect(resultMetersKb({
			status: 'unverifiable',
			reason: 'Evaluator error: Pipeline is already running',
		})).toBe(0);
		expect(resultMetersKb({
			status: 'unverifiable',
			reason: 'GitHub token missing — add your personal access token in Settings → GitHub access',
		})).toBe(0);
		expect(resultMetersKb({
			status: 'unverifiable',
			reason: 'Could not read your RocketRide environment — no verdict without confirming your GitHub token',
		})).toBe(0);
		expect(resultMetersKb({
			status: 'unverifiable',
			reason: 'Included compute is busy. Retry in a moment.',
		})).toBe(0);
	});
	it('does not bill evaluator crashes or missing GitHub repos', () => {
		expect(resultMetersKb({
			status: 'unverifiable',
			reason: 'TypeError: gather() takes from 2 to 4 positional arguments but 5 were given',
		})).toBe(0);
		expect(resultMetersKb({ status: 'unverifiable', reason: 'GitHub returned HTTP 404' })).toBe(0);
	});
	it('bills a completed (or failed-after-fetch) row at the average repo size', () => {
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
