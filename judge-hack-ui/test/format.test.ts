import { describe, expect, it } from 'vitest';
import {
	breakdownNet,
	countsFromResults,
	estimateAllowance,
	genericScoreMath,
	GENERIC_TAG_THRESHOLDS,
	isFlagged,
	runDuration,
	scoringSummary,
	summarize,
	usesPipelineRubric,
} from '../src/format';

describe('usesPipelineRubric', () => {
	it('uses the pipeline path for the RocketRide preset', () => {
		expect(usesPipelineRubric({})).toBe(true);
		expect(usesPipelineRubric({ target_name: 'RocketRide' })).toBe(true);
		expect(usesPipelineRubric({ scoring: 'pipeline', target_name: 'LaserData' })).toBe(true);
	});
	it('uses the generic path for custom products', () => {
		expect(usesPipelineRubric({ target_name: 'LaserData' })).toBe(false);
		expect(usesPipelineRubric({ scoring: 'generic' })).toBe(false);
	});
});

describe('genericScoreMath', () => {
	it('identifies a floored negative net', () => {
		const line = genericScoreMath({
			score: 0,
			tag: 'None',
			backbone: 'No',
			breakdown: [
				{ signal: 'platform_deploy', points: 1.5 },
				{ signal: 'predates', points: -2 },
			],
		});
		expect(line).toContain('+1.5');
		expect(line).toContain('-2');
		expect(line).toContain('floored to 0.0');
		expect(line).toContain('None');
	});
	it('maps a typical genuine score to Significant', () => {
		const line = genericScoreMath({
			score: 4.5,
			tag: 'Significant',
			backbone: 'Yes',
			breakdown: [
				{ signal: 'dependency', points: 1 },
				{ signal: 'invocation', points: 1.5 },
				{ signal: 'api_usage', points: 1.5 },
				{ signal: 'hosted', points: 0.5 },
			],
		});
		expect(line).toContain(`Significant ${GENERIC_TAG_THRESHOLDS.significant}`);
		expect(breakdownNet([
			{ points: 1 }, { points: 1.5 }, { points: 1.5 }, { points: 0.5 },
		])).toBe(4.5);
	});
});

describe('scoringSummary / flags / allowance', () => {
	it('counts significant and flagged rows', () => {
		const results = [
			{ tag: 'Significant' },
			{ tag: 'None', project_predates: true },
			{ tag: 'Moderate', classify_failed: true },
		];
		expect(countsFromResults(results)).toEqual({
			done_count: 3, significant_count: 1, flagged_count: 1,
		});
		expect(summarize(results).tags.FAILED).toBe(1);
		expect(isFlagged({ history_tampered: [{ sha: 'abc' }] })).toBe(true);
	});
	it('returns null when a batch fits the plan budget', () => {
		expect(estimateAllowance(4, 'developer')).toBeNull();
	});
	it('warns when a developer sheet exceeds 4 MB', () => {
		const a = estimateAllowance(20, 'developer');
		expect(a?.budget_kb).toBe(4000);
		expect(a?.next_tier).toBe('company');
		expect(a?.est_verified_rows).toBe(8);
		expect(a?.blocked).toBe(false);
	});
	it('blocks when the prepaid remainder is empty', () => {
		const a = estimateAllowance(1, 'developer', 4000);
		expect(a?.blocked).toBe(true);
		expect(a?.est_verified_rows).toBe(0);
	});
	it('formats run duration', () => {
		const start = '2026-09-01T00:00:00.000Z';
		expect(runDuration({ created_at: start, finished_at: '2026-09-01T00:00:12.000Z', status: 'done' } as never, Date.parse(start) + 12000)).toBe('12s');
	});
	it('mentions pipeline call counts on the RocketRide path', () => {
		expect(scoringSummary({
			score: 5, tag: 'Significant', backbone: 'Yes',
			pipelines: [{ called: true }, { called: false }],
		})).toContain('1/2 pipeline(s) called');
	});
});
