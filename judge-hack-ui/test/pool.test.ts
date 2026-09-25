import { describe, expect, it } from 'vitest';
import { clonePipelineForWorker, ORG_SLOTS, workerCount, workerTtlSeconds } from '../src/verify/pool';

describe('workerCount', () => {
	it('never exceeds repo count and never goes below 1 for non-empty sheets', () => {
		expect(workerCount(0)).toBe(0);
		expect(workerCount(1)).toBe(1);
		expect(workerCount(3)).toBe(2);
	});
	it('caps by plan', () => {
		expect(workerCount(50)).toBe(2);
		expect(workerCount(50, 'developer')).toBe(2);
		expect(workerCount(50, 'company')).toBe(3);
		expect(workerCount(50, 'organizers')).toBe(3);
		expect(workerCount(2, 'company')).toBe(2);
	});
	it('respects the org-wide remaining slots', () => {
		expect(workerCount(10, 'company', undefined, 0)).toBe(0);
		expect(workerCount(10, 'company', undefined, 2)).toBe(2);
		expect(workerCount(10, 'developer', undefined, 1)).toBe(1);
		expect(workerCount(10, 'company', 8, 5)).toBe(3);
		expect(ORG_SLOTS).toBe(5);
	});
	it('clonePipelineForWorker gives each worker a distinct task identity', () => {
		const a = clonePipelineForWorker({ project_id: '3f6b9d2e-5c41-4a8f-9e07-6d2b8c1a4f53', source: 'chat_1' });
		const b = clonePipelineForWorker({ project_id: '3f6b9d2e-5c41-4a8f-9e07-6d2b8c1a4f53', source: 'chat_1' });
		expect(a.project_id).not.toBe(b.project_id);
		expect(a.source).toBe('chat_1');
	});
});

describe('workerTtlSeconds', () => {
	it('scales with repos per worker but keeps a floor', () => {
		expect(workerTtlSeconds(1, 1)).toBe(300);
		expect(workerTtlSeconds(1, 1)).toBeLessThan(900);
		expect(workerTtlSeconds(20, 2)).toBe(1920);
	});
});
