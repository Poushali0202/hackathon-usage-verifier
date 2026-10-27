import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_APP_ID,
	assertAppId,
	countAppIdLiterals,
	namespaceOf,
	patchAppId,
	resolveAppId,
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore - plain ESM tool module, no types
} from '../tools/app-id.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD_ID = 'rocketride_apps.judge-hack';

const ID_FILES = [
	'package.json',
	path.join('src', 'AppDescriptor.ts'),
	path.join('src', 'billing.ts'),
	'judge-hack.rrapp',
];

function readAll(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const relative of ID_FILES) out[relative] = fs.readFileSync(path.join(appRoot, relative), 'utf8');
	return out;
}

describe('app id resolution', () => {
	it('defaults to the staging id and reads flag then env', () => {
		expect(DEFAULT_APP_ID).toBe('hackjudge.judge-hack');
		expect(resolveAppId([])).toBe(DEFAULT_APP_ID);
		expect(resolveAppId(['--app-id', PROD_ID])).toBe(PROD_ID);
		expect(resolveAppId([`--app-id=${PROD_ID}`])).toBe(PROD_ID);
	});

	it('rejects an id that is not <developerId>.<app>', () => {
		expect(() => assertAppId('judgehack')).toThrow();
		expect(() => assertAppId('')).toThrow();
		expect(() => resolveAppId(['--app-id'])).toThrow();
		expect(namespaceOf(DEFAULT_APP_ID)).toBe('hackjudge');
		expect(namespaceOf(PROD_ID)).toBe('rocketride_apps');
	});
});

describe('app id patch', () => {
	it('is a no-op when the id already matches', () => {
		const before = readAll();
		const restore = patchAppId(appRoot, DEFAULT_APP_ID);
		expect(readAll()).toEqual(before);
		restore();
		expect(readAll()).toEqual(before);
	});

	it('rewrites manifest, descriptor, billing and pack, then restores byte for byte', () => {
		const before = readAll();
		const restore = patchAppId(appRoot, PROD_ID);
		try {
			const during = readAll();
			expect(countAppIdLiterals(appRoot, DEFAULT_APP_ID)).toBe(0);
			expect(JSON.parse(during['package.json']).appManifest.id).toBe(PROD_ID);
			expect(JSON.parse(during['package.json']).appManifest.publisher).toBe('rocketride_apps');
			// The contributed settings keys carry the id; billing.ts derives them
			// from APP_ID, so they must move together.
			const props = JSON.parse(during['package.json']).appManifest.contributes.configuration.properties;
			expect(Object.keys(props)).toContain(`${PROD_ID}.graceDays`);
			expect(during[path.join('src', 'AppDescriptor.ts')]).toContain(`id: '${PROD_ID}'`);
			expect(during[path.join('src', 'billing.ts')]).toContain(`APP_ID = '${PROD_ID}'`);
			expect(JSON.parse(during['judge-hack.rrapp']).id).toBe(PROD_ID);
			// Stable identities must survive an id change.
			expect(JSON.parse(during['package.json']).appManifest.projectId)
				.toBe('bde4acbb-7db2-4a97-8d01-28214a1bc284');
			expect(JSON.parse(during['package.json']).name).toBe('hackjudge-judge-hack');
		} finally {
			restore();
		}
		expect(readAll()).toEqual(before);
	});

	it('restores once even if called twice', () => {
		const before = readAll();
		const restore = patchAppId(appRoot, PROD_ID);
		restore();
		restore();
		expect(readAll()).toEqual(before);
	});
});
