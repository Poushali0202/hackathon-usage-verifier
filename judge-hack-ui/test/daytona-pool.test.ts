import { describe, expect, it } from 'vitest';
import { daytonaWorkerCount, clonePipelineForSandbox } from '../src/verify/pool';

describe('daytonaWorkerCount', () => {
	it('never exceeds the repo count', () => {
		expect(daytonaWorkerCount(0)).toBe(0);
		expect(daytonaWorkerCount(1)).toBe(1);
		expect(daytonaWorkerCount(3)).toBe(3);
	});
	it('caps Developer at 4 and Company/Organizers at 8', () => {
		expect(daytonaWorkerCount(50)).toBe(4);
		expect(daytonaWorkerCount(50, 'developer')).toBe(4);
		expect(daytonaWorkerCount(50, 'company')).toBe(8);
		expect(daytonaWorkerCount(50, 'organizers')).toBe(8);
		expect(daytonaWorkerCount(5, 'company')).toBe(5);
	});
	it('honors an explicit override', () => {
		expect(daytonaWorkerCount(50, 'developer', 6)).toBe(6);
		expect(daytonaWorkerCount(2, 'company', 8)).toBe(2);
	});
	it('clonePipelineForSandbox gives each worker a distinct task identity', () => {
		const a = clonePipelineForSandbox({ project_id: 'bde4acbb-7db2-4a97-8d01-28214a1bc284', source: 'chat_1' });
		const b = clonePipelineForSandbox({ project_id: 'bde4acbb-7db2-4a97-8d01-28214a1bc284', source: 'chat_1' });
		expect(a.project_id).not.toBe('bde4acbb-7db2-4a97-8d01-28214a1bc284');
		expect(b.project_id).not.toBe(a.project_id);
		expect(a.source).toBe('chat_1');
	});
});
