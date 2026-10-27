import { describe, expect, it } from 'vitest';
import {
	TARGET_NAMES,
	assertTarget,
	assertTargetName,
	deployPair,
	devPair,
	hostOf,
	parseAudience,
	requireTarget,
	resolveAudience,
	resolveTarget,
	targetOf,
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - plain ESM tool module, no types
} from '../tools/env.mjs';

const STAGING = 'https://staging.rocketride.ai';
const CLOUD = 'https://api.rocketride.ai';
const SHELL = 'https://cloud.rocketride.ai';
const LOCAL = 'http://localhost:4000';

describe('target recognition', () => {
	it('maps each known host to its target, and nothing else', () => {
		expect(targetOf(STAGING)).toBe('staging');
		expect(targetOf(CLOUD)).toBe('cloud');
		expect(targetOf(SHELL)).toBe('cloud');
		expect(targetOf(LOCAL)).toBe('local');
		expect(targetOf('https://example.com')).toBeNull();
		expect(targetOf('not a url')).toBeNull();
	});

	it('does not confuse staging for production on a substring', () => {
		// 'staging.rocketride.ai' must never satisfy --target cloud.
		expect(targetOf(STAGING)).not.toBe('cloud');
		expect(() => assertTarget('cloud', STAGING)).toThrow(/REFUSED/);
	});

	it('ignores port and path when classifying', () => {
		expect(targetOf('https://api.rocketride.ai:443/v1/')).toBe('cloud');
		expect(hostOf('https://api.rocketride.ai:8443/x')).toBe('api.rocketride.ai:8443');
	});
});

describe('assertTarget', () => {
	it('passes when the named target matches the configured host', () => {
		expect(assertTarget('staging', STAGING)).toBe('staging');
		expect(assertTarget('cloud', CLOUD)).toBe('cloud');
		expect(assertTarget('local', LOCAL)).toBe('local');
	});

	it('refuses a mismatch and names both sides', () => {
		expect(() => assertTarget('staging', CLOUD)).toThrow(/REFUSED/);
		expect(() => assertTarget('staging', CLOUD)).toThrow(/api\.rocketride\.ai/);
		expect(() => assertTarget('staging', CLOUD)).toThrow(/that is cloud/);
	});

	it('refuses an unrecognised host rather than assuming', () => {
		expect(() => assertTarget('cloud', 'https://example.com')).toThrow(/unrecognised host/);
	});

	it('rejects a target name that is not one of the three', () => {
		expect(() => assertTargetName('prod')).toThrow(/Unknown target/);
		expect(assertTargetName('CLOUD')).toBe('cloud');
		expect(TARGET_NAMES).toEqual(['cloud', 'staging', 'local']);
	});
});

describe('target resolution', () => {
	it('reads --target, --target=, then ROCKETRIDE_TARGET', () => {
		expect(resolveTarget(['--target', 'staging'], {})).toBe('staging');
		expect(resolveTarget(['--target=cloud'], {})).toBe('cloud');
		expect(resolveTarget([], { ROCKETRIDE_TARGET: 'local' })).toBe('local');
	});

	it('prefers the flag over the environment', () => {
		expect(resolveTarget(['--target', 'staging'], { ROCKETRIDE_TARGET: 'cloud' })).toBe('staging');
	});

	it('has no default - a write must name the target', () => {
		expect(resolveTarget([], {})).toBeNull();
		expect(() => requireTarget([], 'the deploy')).toThrow(/Name the target for the deploy/);
	});

	it('rejects a bare --target with no value', () => {
		expect(() => resolveTarget(['--target'], {})).toThrow(/needs a value/);
		expect(() => resolveTarget(['--target', '--app-id'], {})).toThrow(/needs a value/);
	});
});

describe('connection pairs', () => {
	it('keeps the dev pair and the deploy pair separate', () => {
		const env = {
			ROCKETRIDE_URI: STAGING,
			ROCKETRIDE_APIKEY: 'dev-key',
			ROCKETRIDE_DEPLOY_URI: CLOUD,
			ROCKETRIDE_DEPLOY_APIKEY: 'deploy-key',
		};
		expect(devPair(env)).toEqual({ uri: STAGING, auth: 'dev-key' });
		expect(deployPair(env)).toEqual({ uri: CLOUD, auth: 'deploy-key' });
	});

	it('never falls back to the dev pair when the deploy pair is absent', () => {
		const env = { ROCKETRIDE_URI: STAGING, ROCKETRIDE_APIKEY: 'dev-key' };
		expect(() => deployPair(env)).toThrow(/No deployment target configured/);
		expect(() => deployPair(env)).toThrow(/do not substitute the dev pair/);
	});

	it('asks for the extension when the dev pair is absent', () => {
		expect(() => devPair({})).toThrow(/Missing ROCKETRIDE_URI/);
	});
});

describe('audience', () => {
	it('accepts only the three named forms', () => {
		expect(parseAudience('@me')).toBe('@me');
		expect(parseAudience('@public')).toBe('@public');
		expect(parseAudience('@team/Development')).toBe('@team/Development');
		expect(parseAudience(' @team/Dev Team ')).toBe('@team/Dev Team');
	});

	it('refuses an unnamed or malformed audience', () => {
		expect(() => parseAudience('')).toThrow(/must be @me/);
		expect(() => parseAudience('me')).toThrow(/must be @me/);
		expect(() => parseAudience('@team/')).toThrow(/must be @me/);
		expect(() => parseAudience('@everyone')).toThrow(/must be @me/);
	});

	it('is absent rather than guessed when no flag is passed', () => {
		expect(resolveAudience([])).toBeNull();
		expect(resolveAudience(['--audience', '@me'])).toBe('@me');
		expect(resolveAudience(['--audience=@team/Development'])).toBe('@team/Development');
		expect(() => resolveAudience(['--audience'])).toThrow(/needs a value/);
	});
});
