import { describe, expect, it } from 'vitest';
import {
	extractProse,
	extractProseFromResponse,
	hasUsableProse,
	sanitizeExplainProse,
} from '../src/verify/explainParse';
import { mergeProse } from '../src/verify/explain';

describe('extractProseFromResponse', () => {
	const good = {
		description: 'Hopper is a supply-chain agent that routes shipments.',
		rocketride_usage: 'RocketRide runs pipeline.pipe (10 nodes), called from check.ts:5.',
		justification: 'Significant because a called 10-node agent pipeline is load-bearing.',
	};

	it('reads answers[0] as a JSON string (Python client shape)', () => {
		const got = extractProseFromResponse({
			name: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
			path: '',
			objectId: '11111111-2222-3333-4444-555555555555',
			result_types: { answers: 'answers' },
			answers: [JSON.stringify(good)],
		});
		expect(got.description).toContain('Hopper');
		expect(got.rocketride_usage).toContain('pipeline.pipe');
		expect(hasUsableProse(got)).toBe(true);
	});

	it('reads an already-parsed object in answers (expectJson)', () => {
		const got = extractProseFromResponse({ answers: [good] });
		expect(got.description).toContain('Hopper');
		expect(got.rocketride_usage).toContain('check.ts:5');
	});

	it('reads a top-level parsed object', () => {
		const got = extractProseFromResponse(good);
		expect(got.justification).toContain('Significant');
	});

	it('unwraps markdown fences and usage aliases', () => {
		const got = extractProseFromResponse({
			answers: [`\`\`\`json\n${JSON.stringify({
				description: 'A demo app for checking out.',
				usage: 'Calls the LaserData SDK in src/client.ts:12.',
			})}\n\`\`\``],
		});
		expect(got.rocketride_usage).toContain('LaserData');
		expect(hasUsableProse(got)).toBe(true);
	});

	it('reads Answer-like getJson() without flattening the envelope', () => {
		const got = extractProseFromResponse({
			answers: [{
				getJson: () => good,
				getText: () => '',
			}],
		});
		expect(got.description).toContain('Hopper');
	});

	it('does not treat the prompt example JSON as the answer', () => {
		const promptEcho = `Return ONLY a strict JSON object:\n{\n  "description": "<1-2 sentences: what the project does>",\n  "rocketride_usage": "<1-2 sentences>"\n}`;
		const got = extractProseFromResponse({
			name: 'uuid',
			answers: [JSON.stringify(good)],
			text: [promptEcho],
		});
		expect(got.description).toContain('Hopper');
		expect(got.description).not.toContain('1-2 sentences');
	});

	it('rejects placeholder / tiny strings', () => {
		const got = sanitizeExplainProse({
			description: '<1-2 sentences: what the project does>',
			rocketride_usage: 'short',
		});
		expect(hasUsableProse(got)).toBe(false);
	});
});

describe('extractProse', () => {
	it('finds JSON buried in chatter', () => {
		const got = extractProse('Sure.\n{"description":"A weather bot for hikers.","rocketride_usage":"Uses chat_1 to ask Claude."}\nThanks');
		expect(got.description).toContain('weather bot');
	});
});

describe('mergeProse guardrails', () => {
	const base = {
		project: 'hopper',
		github: 'https://github.com/acme/hopper',
		tag: 'Less' as const,
		backbone: 'No' as const,
		score: 1,
		status: 'complete' as const,
		notes: 'Deterministic score 1.0 → Less / backbone No',
		pipelines: [],
	};

	it('never lets LLM JSON change tag, backbone, or score', () => {
		const next = mergeProse(base, {
			description: 'Hopper routes trucks across a regional network.',
			rocketride_usage: 'No RocketRide pipeline is called in application code.',
			justification: 'Less because the pipe is present but never invoked.',
			tag: 'Significant',
			backbone: 'Yes',
			score: 9,
		} as never);
		expect(next.tag).toBe('Less');
		expect(next.backbone).toBe('No');
		expect(next.score).toBe(1);
		expect(next.explain_failed).toBe(false);
		expect(next.description).toContain('trucks');
	});

	it('falls back to evidence prose without the old classifier banner', () => {
		const next = mergeProse(base, { explain_failed: true, explain_error: 'LLM reply did not contain description / usage JSON' });
		expect(next.explain_failed).toBe(true);
		expect(next.notes).not.toMatch(/classifier unreachable/);
		expect(next.explain_error).toMatch(/description \/ usage JSON/);
		expect(next.tag).toBe('Less');
	});
});
