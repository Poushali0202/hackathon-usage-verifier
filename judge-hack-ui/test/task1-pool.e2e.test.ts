import { describe, expect, it } from 'vitest';
import { runRepos, type VerifyClient } from '../src/verify/session';
import { sandboxTtlSeconds } from '../src/verify/pool';
import type { Submission } from '../src/types';

const VERDICT = JSON.stringify({
	schema: 'hackjudge.daytona.v1',
	status: 'unverifiable',
	reason: 'pool e2e does not need a scored verdict',
});

function repos(n: number): Submission[] {
	return Array.from({ length: n }, (_, i) => ({
		project: `p${i}`,
		github: `https://github.com/acme/p${i}`,
	}));
}

function mockClient(opts?: { denyFirst?: number }): VerifyClient & {
	uses: Array<{ name: string; ttl: number; project_id?: string; token: string }>;
	terms: string[];
	peakDaytona: number;
} {
	const uses: Array<{ name: string; ttl: number; project_id?: string; token: string }> = [];
	const terms: string[] = [];
	const live = new Set<string>();
	let seq = 0;
	let denied = opts?.denyFirst ?? 0;
	let peakDaytona = 0;
	const client: VerifyClient & { uses: typeof uses; terms: string[]; peakDaytona: number } = {
		uses,
		terms,
		get peakDaytona() { return peakDaytona; },
		async use({ pipeline, name, ttl }) {
			const isExplain = /explain/i.test(name);
			if (!isExplain && denied > 0) {
				denied -= 1;
				throw new Error('Failed to create sandbox: Total CPU limit exceeded. Maximum allowed: 10.');
			}
			const token = `${isExplain ? 'ex' : 'd'}-${++seq}`;
			uses.push({ name, ttl, project_id: (pipeline as { project_id?: string }).project_id, token });
			live.add(token);
			if (!isExplain) {
				peakDaytona = Math.max(peakDaytona, [...live].filter((t) => t.startsWith('d-')).length);
			}
			return { token };
		},
		async tool(opts) {
			const command = String((opts.input as { command?: string } | undefined)?.command || '');
			if (command.includes('run_verify')) {
				await new Promise((resolve) => setTimeout(resolve, 400));
			}
			return { exit_code: 0, output: VERDICT };
		},
		async chat() {
			throw new Error('explain skipped in pool e2e');
		},
		async terminate(token) {
			terms.push(token);
			live.delete(token);
		},
	};
	return client;
}

describe('Task 1 pool e2e (mocked Daytona client)', { timeout: 20000 }, () => {
	it('Developer: at most 2 live sandboxes, each with a unique project_id, all terminated', async () => {
		const client = mockClient();
		const stages: string[] = [];
		const results = await runRepos({
			client,
			repos: repos(4),
			eventDate: '2026-09-16',
			historyPenalty: 2,
			runName: 'Task1 developer',
			plan: 'developer',
			onStage: (s) => stages.push(s),
		});
		const daytona = client.uses.filter((u) => u.token.startsWith('d-'));
		expect(stages.some((s) => s.includes('Starting 2 Daytona sandboxes'))).toBe(true);
		expect(daytona).toHaveLength(2);
		expect(new Set(daytona.map((u) => u.project_id)).size).toBe(2);
		expect(client.peakDaytona).toBe(2);
		expect(client.peakDaytona).toBeLessThanOrEqual(2);
		expect(results).toHaveLength(4);
		expect(daytona.every((u) => client.terms.includes(u.token))).toBe(true);
	});

	it('Company: 3 sandboxes for 4+ repos; override 8 cannot raise the cap', async () => {
		const client = mockClient();
		const stages: string[] = [];
		await runRepos({
			client,
			repos: repos(5),
			eventDate: '2026-09-16',
			historyPenalty: 2,
			runName: 'Task1 company',
			plan: 'company',
			concurrency: 8,
			onStage: (s) => stages.push(s),
		});
		const daytona = client.uses.filter((u) => u.token.startsWith('d-'));
		expect(stages.some((s) => s.includes('Starting 3 Daytona sandboxes'))).toBe(true);
		expect(daytona).toHaveLength(3);
		expect(client.peakDaytona).toBe(3);
		expect(daytona[0].ttl).toBe(sandboxTtlSeconds(5, 3));
	});

	it('one repo never opens a pool of 2', async () => {
		const client = mockClient();
		const stages: string[] = [];
		await runRepos({
			client,
			repos: repos(1),
			eventDate: '2026-09-16',
			historyPenalty: 2,
			runName: 'Task1 single',
			plan: 'company',
			onStage: (s) => stages.push(s),
		});
		expect(stages.some((s) => s.includes('Starting the Daytona sandbox'))).toBe(true);
		expect(client.uses.filter((u) => u.token.startsWith('d-'))).toHaveLength(1);
		expect(client.peakDaytona).toBe(1);
	});

	it('CPU limit on boot retries with 1 sandbox and still terminates', async () => {
		const client = mockClient({ denyFirst: 3 });
		const stages: string[] = [];
		const results = await runRepos({
			client,
			repos: repos(3),
			eventDate: '2026-09-16',
			historyPenalty: 2,
			runName: 'Task1 cpu',
			plan: 'company',
			onStage: (s) => stages.push(s),
		});
		expect(stages.some((s) => /retrying with 1 sandbox/i.test(s))).toBe(true);
		const daytonaOk = client.uses.filter((u) => u.token.startsWith('d-'));
		expect(daytonaOk).toHaveLength(1);
		expect(results).toHaveLength(3);
		expect(client.terms).toContain(daytonaOk[0].token);
	});
});
