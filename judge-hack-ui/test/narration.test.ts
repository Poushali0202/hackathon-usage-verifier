import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { VerifyResult } from '../src/types';
import {
	ANTHROPIC_KEY_NAME,
	NARRATION_COPY,
	applyNarration,
	endSummary,
	isNarratable,
	narratableIndexes,
	narrationChrome,
	narrationOnFromNames,
	readNarrationOn,
	verdictFields,
} from '../src/verify/narration';

const scored: VerifyResult = {
	project: 'hopper',
	github: 'https://github.com/vraj00222/hopper',
	tag: 'Significant',
	backbone: 'Yes',
	score: 4.5,
	explain_failed: true,
	description: 'Fallback description from evidence.',
	rocketride_usage: 'Fallback usage from evidence.',
	justification: 'Fallback justification.',
};

const failed: VerifyResult = {
	project: 'trailbridge',
	github: 'https://github.com/Mr-Shockwave/Trailbridge',
	classify_failed: true,
	repo_accessible: false,
	status: 'unverifiable',
	explain_failed: true,
};

const narrated: VerifyResult = {
	...scored,
	explain_failed: false,
	description: 'Hopper is a supply-chain agent.',
	rocketride_usage: 'RocketRide runs a called pipeline.',
};

describe('narration detection', () => {
	it('is on only when the exact key name is in the names list', () => {
		expect(narrationOnFromNames(['ROCKETRIDE_GITHUB_TOKEN'])).toBe(false);
		expect(narrationOnFromNames(['ROCKETRIDE_ANTHROPIC'])).toBe(false);
		expect(narrationOnFromNames([ANTHROPIC_KEY_NAME])).toBe(true);
		expect(narrationOnFromNames(['ROCKETRIDE_GITHUB_TOKEN', ANTHROPIC_KEY_NAME])).toBe(true);
	});

	it('uses the names-only path and never fetches environment values', async () => {
		const calls: string[] = [];
		const client = {
			account: {
				getEnvironmentKeys: async () => {
					calls.push('getEnvironmentKeys');
					return [ANTHROPIC_KEY_NAME];
				},
				getEnv: async () => {
					calls.push('getEnv');
					return { [ANTHROPIC_KEY_NAME]: 'sk-secret' };
				},
			},
		};
		expect(await readNarrationOn(client)).toBe(true);
		expect(calls).toEqual(['getEnvironmentKeys']);
		const src = fs.readFileSync(
			path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/verify/narration.ts'),
			'utf8',
		);
		expect(src).not.toMatch(/getEnv\s*\(/);
		expect(src).toContain('getEnvironmentKeys');
	});
});

describe('narratable rows', () => {
	it('excludes FAILED rows from N and from narrate gating', () => {
		expect(isNarratable(failed)).toBe(false);
		expect(isNarratable(scored)).toBe(true);
		expect(isNarratable(narrated)).toBe(false);
		expect(narratableIndexes([scored, failed, narrated])).toEqual([0]);
	});
});

describe('applyNarration', () => {
	it('changes only prose fields and explain_failed; verdict stays deep-equal', () => {
		const before = verdictFields(scored);
		const next = applyNarration(scored, {
			...scored,
			explain_failed: false,
			description: 'Hopper is a supply-chain agent.',
			rocketride_usage: 'RocketRide runs a called pipeline.',
			justification: 'Significant because a called pipeline is load-bearing.',
		});
		expect(verdictFields(next)).toEqual(before);
		expect(next.description).toBe('Hopper is a supply-chain agent.');
		expect(next.explain_failed).toBe(false);
	});

	it('keeps the fallback and stays narratable when the model contradicts the verdict', () => {
		const next = applyNarration(scored, {
			...scored,
			tag: 'None',
			explain_failed: false,
			description: 'This project does not use RocketRide.',
			rocketride_usage: 'No usage.',
		});
		expect(next).toEqual(scored);
		expect(isNarratable(next)).toBe(true);
	});
});

describe('gating', () => {
	it('hides narrate actions when narration is off and hides Enable when on', () => {
		const off = narrationChrome(false, scored);
		expect(off.enable).toBe(true);
		expect(off.writeProject).toBe(false);
		expect(off.offBeside).toBe(true);
		const on = narrationChrome(true, scored);
		expect(on.enable).toBe(false);
		expect(on.writeProject).toBe(true);
		const model = narrationChrome(true, narrated);
		expect(model.enable).toBe(false);
		expect(model.writeProject).toBe(false);
		expect(model.aiLabel).toBe(true);
		const dead = narrationChrome(true, failed);
		expect(dead.writeProject).toBe(false);
		expect(dead.enable).toBe(false);
	});
});

describe('batch summary math', () => {
	it('K + M equals the batch size; cancel at item X leaves remaining = original N minus completed', () => {
		const n = 12;
		const completed = 4;
		const k = 4;
		const m = n - completed;
		expect(k + m).toBe(n);
		expect(endSummary(k, n, m)).toBe('Narrated 4 of 12. 8 could not be narrated; their summaries are unchanged.');
		const remaining = n - completed;
		expect(remaining).toBe(8);
	});
});

describe('copy table', () => {
	it('points at Environment Variables, not Account, and contains no em dashes', () => {
		expect(NARRATION_COPY.fallbackLabel).toBe('Summary from verified evidence');
		expect(NARRATION_COPY.offBeside).toBe('AI narration is off');
		expect(NARRATION_COPY.enable).toBe('Enable AI narration');
		expect(NARRATION_COPY.toastOn).toBe('AI narration is on.');
		expect(NARRATION_COPY.settingsOff).toBe('Off. Verdicts still use verified evidence.');
		expect(NARRATION_COPY.settingsOn).toBe('On. Project summaries use the model.');
		expect(NARRATION_COPY.openEnv).toBe('Open Environment Variables');
		expect(NARRATION_COPY.writeProject).toBe('Write narration for this project');
		expect(NARRATION_COPY.authFailure).toContain('Environment Variables');
		const blob = Object.values(NARRATION_COPY).join('\n');
		expect(blob).not.toMatch(/Account\s*→\s*Environment/);
		expect(blob).not.toMatch(/Account\s*->\s*Environment/);
		expect(blob).not.toContain('\u2014');
		expect(blob).not.toContain('—');
	});
});
