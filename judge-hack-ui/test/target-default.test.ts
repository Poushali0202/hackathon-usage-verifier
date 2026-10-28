/**
 * QA N2: opening, creating or saving a target on the Targets page silently changed which target
 * Quick verify and New run pre-select, so one click could score a whole event against the wrong
 * rubric. The shared `hj.targetId` preference may be written in exactly one place: when a run
 * actually starts (RunsContext). These are source-level guards so the rule cannot creep back.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', rel), 'utf8');

describe('target pre-selection (QA N2)', () => {
	it('the Targets page never writes the shared target preference', () => {
		const targets = src('pages/Targets.tsx');
		expect(targets).not.toContain("'hj.targetId'");
		expect(targets).not.toContain('setPref(');
	});

	it('only a started run records the last-used target', () => {
		const ctx = src('RunsContext.tsx');
		expect(ctx.match(/setPref\('hj\.targetId'/g)?.length).toBe(1);
		for (const page of ['pages/NewRun.tsx', 'pages/QuickVerify.tsx']) {
			expect(src(page)).toContain("getPref('hj.targetId')");
			expect(src(page)).not.toContain("setPref('hj.targetId'");
		}
	});
});
