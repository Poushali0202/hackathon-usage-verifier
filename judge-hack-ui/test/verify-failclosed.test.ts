import { describe, expect, it } from 'vitest';
import { normalizeResult } from '../src/verify/normalize';
import { parseDaytonaResult, parseExtractResult } from '../src/verify/parseResult';

describe('parseDaytonaResult fail-closed', () => {
	it('does not invent a verdict on truncated output', () => {
		const r = parseDaytonaResult({
			truncated: true,
			output: JSON.stringify({ status: 'complete', tag: 'Significant', score: 9, backbone: 'Yes' }),
		});
		expect(r.status).toBe('fetch_incomplete');
		expect(r.tag).toBeUndefined();
		expect(r.score).toBeUndefined();
		expect(r.backbone).toBeUndefined();
	});
	it('surfaces sandbox errors without a fake tag', () => {
		const r = parseDaytonaResult({ error: 'timeout', exit_code: 1 });
		expect(r.status).toBe('unverifiable');
		expect(r.reason).toMatch(/Daytona sandbox error/);
		expect(r.tag).toBeUndefined();
	});
	it('keeps a complete evaluator payload', () => {
		const r = parseDaytonaResult({
			output: JSON.stringify({ schema: 'hackjudge.daytona.v1', status: 'complete', tag: 'Moderate', score: 2.5, backbone: 'Partial' }),
		});
		expect(r.status).toBe('complete');
		expect(r.tag).toBe('Moderate');
		expect(r.score).toBe(2.5);
	});
});

describe('parseExtractResult fail-closed', () => {
	it('fails closed on truncated extract output', () => {
		const r = parseExtractResult({ truncated: true, output: '{}' });
		expect(r.status).toBe('failed');
		expect(r.reason).toMatch(/truncated/);
	});
});

describe('normalizeResult fail-closed', () => {
	const row = { project: 'Demo', github: 'https://github.com/acme/demo' };
	it('strips tag/score/backbone when the sandbox did not finish', () => {
		const r = normalizeResult({
			status: 'fetch_incomplete',
			tag: 'Significant',
			score: 8,
			backbone: 'Yes',
			reason: 'truncated',
		}, row, 1.2);
		expect(r.classify_failed).toBe(true);
		expect(r.tag).toBeUndefined();
		expect(r.score).toBeUndefined();
		expect(r.backbone).toBeUndefined();
	});
	it('keeps a complete generic verdict', () => {
		const r = normalizeResult({
			status: 'complete',
			tag: 'Significant',
			score: 4.5,
			backbone: 'Yes',
			target_name: 'LaserData',
			scoring: 'generic',
		}, row, 3);
		expect(r.classify_failed).toBeFalsy();
		expect(r.tag).toBe('Significant');
		expect(r.scoring).toBe('generic');
		expect(r.score).toBe(4.5);
	});
});
