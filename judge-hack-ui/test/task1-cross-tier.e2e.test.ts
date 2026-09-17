import { describe, expect, it } from 'vitest';
import { runRepos, type VerifyClient } from '../src/verify/session';
import { DAYTONA_ORG_SLOTS, DAYTONA_TIER1_VCPU, DAYTONA_VCPU_PER_SANDBOX, planWorkerCap } from '../src/verify/pool';
import { createMemoryOrgPool, isOrgBusyError, type OrgLease } from '../src/verify/leases';
import type { PlanTier, Submission } from '../src/types';

const VERDICT = JSON.stringify({
	schema: 'hackjudge.daytona.v1',
	status: 'unverifiable',
	reason: 'cross-tier e2e',
});

const ORG_SANDBOX_SLOTS = Math.floor(DAYTONA_TIER1_VCPU / DAYTONA_VCPU_PER_SANDBOX);

function repos(n: number, prefix: string): Submission[] {
	return Array.from({ length: n }, (_, i) => ({
		project: `${prefix}-${i}`,
		github: `https://github.com/acme/${prefix}-${i}`,
	}));
}

function sharedOrgClient(maxLive = ORG_SANDBOX_SLOTS): VerifyClient & {
	uses: Array<{ name: string; token: string }>;
	terms: string[];
	peak: number;
	cpuDenials: number;
} {
	const uses: Array<{ name: string; token: string }> = [];
	const terms: string[] = [];
	const live = new Set<string>();
	let seq = 0;
	let peak = 0;
	let cpuDenials = 0;
	return {
		uses,
		terms,
		get peak() { return peak; },
		get cpuDenials() { return cpuDenials; },
		async use({ name }) {
			const isExplain = /explain/i.test(name);
			if (!isExplain && live.size >= maxLive) {
				cpuDenials += 1;
				throw new Error('Failed to create sandbox: Total CPU limit exceeded. Maximum allowed: 10.');
			}
			const token = `${isExplain ? 'ex' : 'd'}-${++seq}`;
			uses.push({ name, token });
			if (!isExplain) {
				live.add(token);
				peak = Math.max(peak, live.size);
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
			throw new Error('explain skipped');
		},
		async terminate(token) {
			terms.push(token);
			live.delete(token);
		},
	};
}

async function runTier(
	client: VerifyClient,
	plan: PlanTier,
	count: number,
	label: string,
	orgLease?: OrgLease,
) {
	const stages: string[] = [];
	const collected: Awaited<ReturnType<typeof runRepos>> = [];
	try {
		const results = await runRepos({
			client,
			repos: repos(count, label),
			eventDate: '2026-09-16',
			historyPenalty: 2,
			runName: label,
			plan,
			orgLease,
			onStage: (s) => stages.push(s),
			onResult: (row) => { collected.push(row); },
		});
		const boots = (client as ReturnType<typeof sharedOrgClient>).uses.filter(
			(u) => u.token.startsWith('d-') && u.name.startsWith(label),
		);
		const gaps = results.filter((r) => /no daytona sandbox was available|cpu limit|included compute is busy/i.test(String(r.reason || '')));
		return { stages, results, boots, gaps };
	} catch (err) {
		if (!isOrgBusyError(err)) throw err;
		const boots = (client as ReturnType<typeof sharedOrgClient>).uses.filter(
			(u) => u.token.startsWith('d-') && u.name.startsWith(label),
		);
		return { stages, results: collected, boots, gaps: collected.filter((r) => /included compute is busy/i.test(String(r.reason || ''))) };
	}
}

describe('Task 1 cross-tier overflow (shared 10 vCPU org key)', { timeout: 30000 }, () => {
	it('Developer cannot borrow Company/Organizers worker count', () => {
		expect(planWorkerCap('developer')).toBe(2);
		expect(planWorkerCap('company')).toBe(3);
		expect(planWorkerCap('organizers')).toBe(3);
	});

	it('Developer + Company together fit the 10 vCPU pool without stealing caps', async () => {
		const client = sharedOrgClient();
		const [dev, company] = await Promise.all([
			runTier(client, 'developer', 4, 'dev'),
			runTier(client, 'company', 5, 'company'),
		]);
		expect(dev.stages.some((s) => s.includes('Starting 2 Daytona sandboxes'))).toBe(true);
		expect(company.stages.some((s) => s.includes('Starting 3 Daytona sandboxes'))).toBe(true);
		expect(dev.boots).toHaveLength(2);
		expect(company.boots).toHaveLength(3);
		expect(client.peak).toBeLessThanOrEqual(ORG_SANDBOX_SLOTS);
		expect(client.peak).toBe(5);
		expect(dev.results).toHaveLength(4);
		expect(company.results).toHaveLength(5);
		expect(dev.gaps).toHaveLength(0);
		expect(company.gaps).toHaveLength(0);
		expect(dev.results.every((r) => r.reason && /cpu limit/i.test(r.reason))).toBe(false);
		expect(client.uses.filter((u) => u.token.startsWith('d-')).every((u) => client.terms.includes(u.token))).toBe(true);
	});

	it('Company + Organizers (3+3) overflow the 10 vCPU pool; neither run jumps to 4 boxes', async () => {
		const client = sharedOrgClient();
		const [company, organizers] = await Promise.all([
			runTier(client, 'company', 5, 'co'),
			runTier(client, 'organizers', 5, 'org'),
		]);
		expect(company.boots.length).toBeLessThanOrEqual(3);
		expect(organizers.boots.length).toBeLessThanOrEqual(3);
		expect(company.boots.length + organizers.boots.length).toBeGreaterThan(3);
		expect(client.peak).toBeLessThanOrEqual(ORG_SANDBOX_SLOTS);
		expect(client.cpuDenials).toBeGreaterThan(0);
		expect(company.results).toHaveLength(5);
		expect(organizers.results).toHaveLength(5);
		const starved = [...company.gaps, ...organizers.gaps];
		expect(starved).toHaveLength(0);
		expect(client.uses.filter((u) => u.token.startsWith('d-')).every((u) => client.terms.includes(u.token))).toBe(true);
	});

	it('Developer + Organizers do not give Developer a third sandbox', async () => {
		const client = sharedOrgClient();
		const [dev, org] = await Promise.all([
			runTier(client, 'developer', 4, 'd2'),
			runTier(client, 'organizers', 5, 'o2'),
		]);
		expect(dev.boots).toHaveLength(2);
		expect(org.boots.length).toBeLessThanOrEqual(3);
		expect(client.peak).toBeLessThanOrEqual(ORG_SANDBOX_SLOTS);
		expect(dev.results).toHaveLength(4);
		expect(org.results).toHaveLength(5);
		expect(dev.gaps).toHaveLength(0);
		expect(org.gaps).toHaveLength(0);
	});

	it('SQL-style org lease stops Company + Organizers at 5 boxes (no Daytona overflow)', async () => {
		expect(DAYTONA_ORG_SLOTS).toBe(ORG_SANDBOX_SLOTS);
		const client = sharedOrgClient(99);
		const makeLease = createMemoryOrgPool(DAYTONA_ORG_SLOTS);
		const [company, organizers] = await Promise.all([
			runTier(client, 'company', 5, 'lease-co', makeLease()),
			runTier(client, 'organizers', 5, 'lease-org', makeLease()),
		]);
		expect(company.boots.length).toBeLessThanOrEqual(3);
		expect(organizers.boots.length).toBeLessThanOrEqual(3);
		expect(company.boots.length + organizers.boots.length).toBeLessThanOrEqual(DAYTONA_ORG_SLOTS);
		expect(client.peak).toBeLessThanOrEqual(DAYTONA_ORG_SLOTS);
		expect(client.cpuDenials).toBe(0);
		expect(company.results.length + organizers.results.length).toBe(10);
		expect(company.boots.length + organizers.boots.length).toBeGreaterThan(3);
	});
});
