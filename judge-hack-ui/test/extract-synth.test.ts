import { describe, expect, it } from 'vitest';
import { mergeExtractConfig, parseExtractLlmJson, verifyExtractField } from '../src/verify/extractSynth';

describe('parseExtractLlmJson', () => {
	it('reads fenced JSON', () => {
		const obj = parseExtractLlmJson('```json\n{"name":"Cognee","dependency_names":"cognee"}\n```');
		expect(obj?.name).toBe('Cognee');
		expect(obj?.dependency_names).toBe('cognee');
	});
	it('rejects unrelated JSON', () => {
		expect(parseExtractLlmJson('{"foo":1}')).toBeNull();
	});
});

describe('verifyExtractField', () => {
	it('keeps tokens evidenced in the corpus and drops prose', () => {
		const corpus = 'cognee add search import from pipeline';
		expect(verifyExtractField('cognee.add | the graph | import cognee', corpus, ' | ')).toBe('import cognee');
	});
});

describe('mergeExtractConfig', () => {
	it('prefers verified LLM fields over empty deterministic ones', () => {
		const { config, usedLlm } = mergeExtractConfig(
			{ name: '', invocation: '', dependency_names: 'cognee' },
			{ name: 'Cognee', invocation: 'cognee.add | the graph', dependency_names: 'cognee' },
			'from cognee import cognee.add search',
		);
		expect(usedLlm).toBe(true);
		expect(config.name).toBe('Cognee');
		expect(config.invocation).toBe('cognee.add');
		expect(config.dependency_names).toBe('cognee');
	});
	it('keeps the deterministic draft when the LLM is missing', () => {
		const { config, usedLlm } = mergeExtractConfig({ name: 'Hotdata', cli_verbs: 'hotdata query' }, null, 'hotdata query');
		expect(usedLlm).toBe(false);
		expect(config.name).toBe('Hotdata');
	});
});
