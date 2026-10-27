import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	CUSTOM_TARGET_CAP_MESSAGE,
	canCreateCustomTarget,
	countedCustomTargets,
	duplicateTargetName,
	customTargetCap,
	customTargetCapUi,
} from '../src/entitlement';

const preset = { id: 'rocketride', is_preset: true };
const custom = (id: string) => ({ id, is_preset: false });

describe('custom target cap', () => {
	it('Developer with 0 or 1 custom targets can create; with 2 the New control is disabled with the exact message and a forced save is refused', () => {
		expect(canCreateCustomTarget('developer', [preset])).toBe(true);
		expect(customTargetCapUi('developer', [preset]).disabled).toBe(false);
		expect(canCreateCustomTarget('developer', [preset, custom('a')])).toBe(true);
		expect(customTargetCapUi('developer', [preset, custom('a')]).disabled).toBe(false);
		const atCap = [preset, custom('a'), custom('b')];
		expect(canCreateCustomTarget('developer', atCap)).toBe(false);
		expect(canCreateCustomTarget('developer', atCap, 'brand-new')).toBe(false);
		const ui = customTargetCapUi('developer', atCap);
		expect(ui.disabled).toBe(true);
		expect(ui.message).toBe(CUSTOM_TARGET_CAP_MESSAGE);
	});

	it('Company and Organizers can create well past 2', () => {
		const many = [preset, ...Array.from({ length: 8 }, (_, i) => custom(`c${i}`))];
		expect(customTargetCap('company')).toBeNull();
		expect(customTargetCap('organizers')).toBeNull();
		expect(canCreateCustomTarget('company', many)).toBe(true);
		expect(canCreateCustomTarget('organizers', many)).toBe(true);
		expect(customTargetCapUi('company', many).disabled).toBe(false);
		expect(customTargetCapUi('organizers', many).message).toBeNull();
	});

	it('the RocketRide preset never counts toward the cap', () => {
		expect(countedCustomTargets([preset])).toBe(0);
		expect(countedCustomTargets([preset, custom('a')])).toBe(1);
		expect(canCreateCustomTarget('developer', [preset])).toBe(true);
		expect(canCreateCustomTarget('developer', [preset, custom('a'), custom('b')])).toBe(false);
		expect(canCreateCustomTarget('developer', [custom('a'), custom('b')])).toBe(false);
	});

	it('grandfathers extras: a Developer with 3 can edit them, cannot create a 4th, and after deleting down to 1 can create again', () => {
		const three = [preset, custom('a'), custom('b'), custom('c')];
		expect(canCreateCustomTarget('developer', three, 'a')).toBe(true);
		expect(canCreateCustomTarget('developer', three, 'b')).toBe(true);
		expect(canCreateCustomTarget('developer', three, 'c')).toBe(true);
		expect(canCreateCustomTarget('developer', three)).toBe(false);
		expect(canCreateCustomTarget('developer', three, 'fourth')).toBe(false);
		expect(customTargetCapUi('developer', three).disabled).toBe(true);
		const one = [preset, custom('a')];
		expect(canCreateCustomTarget('developer', one)).toBe(true);
		expect(customTargetCapUi('developer', one).disabled).toBe(false);
	});

	it('plan change from Developer to Company unblocks creation without a reload assumption', () => {
		const atCap = [preset, custom('a'), custom('b')];
		expect(canCreateCustomTarget('developer', atCap)).toBe(false);
		expect(canCreateCustomTarget('company', atCap)).toBe(true);
		expect(customTargetCapUi('company', atCap).disabled).toBe(false);
	});

	it('the limit message matches the copy exactly and contains no em dash', () => {
		expect(CUSTOM_TARGET_CAP_MESSAGE).toBe(
			'The Developer plan includes 2 custom targets. Upgrade to Company for unlimited targets.',
		);
		expect(CUSTOM_TARGET_CAP_MESSAGE).not.toContain('\u2014');
		expect(customTargetCap('developer')).toBe(2);
	});
});

describe('Plans copy', () => {
	const src = fs.readFileSync(
		path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/pages/Pricing.tsx'),
		'utf8',
	);

	it('says 2 custom targets and Need more, never metered top-ups', () => {
		expect(src).toContain("'2 custom targets'");
		expect(src).toContain('Need more?');
		expect(src).toContain(
			'When your allowance runs out, the next run is refused. You can never spend more than you have paid. Upgrading to the next plan is the cheapest way to add capacity.',
		);
		expect(src).not.toMatch(/top-ups?/i);
		expect(src).not.toMatch(/auto-recharge/i);
		expect(src).not.toMatch(/premium per-KB/i);
		expect(src).not.toContain('\u2014');
	});
});

describe('duplicateTargetName (QA T1)', () => {
	const targets = [
		{ id: 'rocketride', name: 'RocketRide (preset)' },
		{ id: 'a', name: 'Cognee' },
		{ id: 'b', name: 'Hotdata' },
	];
	it('rejects a second target with the same name, ignoring case and whitespace', () => {
		expect(duplicateTargetName(targets, 'Cognee')).toBe(true);
		expect(duplicateTargetName(targets, '  cognee ')).toBe(true);
		expect(duplicateTargetName(targets, 'RocketRide (preset)')).toBe(true);
	});
	it('lets a target keep its own name on re-save and allows new names', () => {
		expect(duplicateTargetName(targets, 'Cognee', 'a')).toBe(false);
		expect(duplicateTargetName(targets, 'Hydra DB')).toBe(false);
		expect(duplicateTargetName(targets, '   ')).toBe(false);
	});
});
