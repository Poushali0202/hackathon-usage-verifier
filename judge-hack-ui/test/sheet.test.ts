import { describe, expect, it } from 'vitest';
import { normalizeGithub, urlsFromText } from '../src/verify/sheet';

describe('normalizeGithub', () => {
	it('accepts https, git@, and trailing .git', () => {
		expect(normalizeGithub('https://github.com/laserdata/laser-sdk')).toBe('https://github.com/laserdata/laser-sdk');
		expect(normalizeGithub('git@github.com:acme/app.git')).toBe('https://github.com/acme/app');
		expect(normalizeGithub('https://github.com/acme/app.git?tab=readme')).toBe('https://github.com/acme/app');
	});
	it('rejects non-github strings', () => {
		expect(normalizeGithub('https://gitlab.com/acme/app')).toBeNull();
		expect(normalizeGithub('not a url')).toBeNull();
	});
});

describe('urlsFromText', () => {
	it('dedupes pasted repo lists', () => {
		const urls = urlsFromText('https://github.com/a/one\nhttps://github.com/a/one.git\nhttps://github.com/b/two');
		expect(urls).toEqual(['https://github.com/a/one', 'https://github.com/b/two']);
	});
});
