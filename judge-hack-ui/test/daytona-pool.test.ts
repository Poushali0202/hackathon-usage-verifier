import { describe, expect, it } from 'vitest';
import { clonePipelineForSandbox, daytonaWorkerCount, isDaytonaCpuLimit, sandboxTtlSeconds } from '../src/verify/pool';

describe('daytonaWorkerCount', () => {
	it('never exceeds the repo count or the CPU-safe cap', () => {
		expect(daytonaWorkerCount(0)).toBe(0);
		expect(daytonaWorkerCount(1)).toBe(1);
		expect(daytonaWorkerCount(3)).toBe(2);
	});
	it('caps Developer at 2 and Company/Organizers at 3', () => {
		expect(daytonaWorkerCount(50)).toBe(2);
		expect(daytonaWorkerCount(50, 'developer')).toBe(2);
		expect(daytonaWorkerCount(50, 'company')).toBe(3);
		expect(daytonaWorkerCount(50, 'organizers')).toBe(3);
		expect(daytonaWorkerCount(2, 'company')).toBe(2);
	});
	it('returns 0 workers when the org pool has no remaining slots', () => {
		expect(daytonaWorkerCount(10, 'company', undefined, 0)).toBe(0);
		expect(daytonaWorkerCount(10, 'company', undefined, 2)).toBe(2);
		expect(daytonaWorkerCount(10, 'developer', undefined, 1)).toBe(1);
		expect(daytonaWorkerCount(10, 'company', 8, 5)).toBe(3);
	});
	it('clonePipelineForSandbox gives each worker a distinct task identity', () => {
		const a = clonePipelineForSandbox({ project_id: 'bde4acbb-7db2-4a97-8d01-28214a1bc284', source: 'chat_1' });
		const b = clonePipelineForSandbox({ project_id: 'bde4acbb-7db2-4a97-8d01-28214a1bc284', source: 'chat_1' });
		expect(a.project_id).not.toBe('bde4acbb-7db2-4a97-8d01-28214a1bc284');
		expect(b.project_id).not.toBe(a.project_id);
		expect(a.source).toBe('chat_1');
	});
});

describe('isDaytonaCpuLimit', () => {
	it('matches Daytona org quota errors', () => {
		expect(isDaytonaCpuLimit('Failed to create sandbox: Total CPU limit exceeded. Maximum allowed: 10.')).toBe(true);
		expect(isDaytonaCpuLimit('To increase concurrency limits, upgrade your organization\'s Tier by visiting https://app.daytona.io/dashboard/limits')).toBe(true);
		expect(isDaytonaCpuLimit('Pipeline is already running')).toBe(false);
	});
});

describe('sandboxTtlSeconds', () => {
	it('does not park a leftover box for 15 minutes after a short run', () => {
		expect(sandboxTtlSeconds(1, 1)).toBe(300);
		expect(sandboxTtlSeconds(1, 1)).toBeLessThan(900);
		expect(sandboxTtlSeconds(20, 2)).toBe(1920);
	});
});
