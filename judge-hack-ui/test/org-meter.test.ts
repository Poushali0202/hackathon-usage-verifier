import { describe, expect, it } from 'vitest';
import { gateBatch } from '../src/verify/meter';
import { readOrgMeterKb, readTenantRuns } from '../src/verify/sqlSchema';

/** A run whose rows each meter the standard 500 KB. */
function run(owner: string, repoCount: number, id = `${owner}-${repoCount}`) {
	return {
		id,
		owner_user_id: owner,
		results: Array.from({ length: repoCount }, () => ({ status: 'complete', reason: '' })),
	};
}

describe('org-wide meter (the allowance belongs to the organization)', () => {
	it('sums every member bag: Alice used 15 MB, 5 left for everyone', () => {
		const appState = {
			tenant: {
				alice: { meter_kb_used: 15000, runs: [] },
				bob: { meter_kb_used: 2000, runs: [] },
			},
		};
		expect(readOrgMeterKb(appState)).toBe(17000);
		// Bob gating a batch: his own live usage is added on top of everyone else.
		const others = readOrgMeterKb(appState, 'bob');
		expect(others).toBe(15000);
		const gate = gateBatch('company', others + 2000, 20);
		expect(gate.remaining_kb).toBe(3000);
		expect(gate.maxRepos).toBe(6);
		expect(gate.truncated).toBe(true);
	});

	it('blocks the whole org once the shared allowance is empty', () => {
		const appState = { tenant: { alice: { meter_kb_used: 20000, runs: [] } } };
		const gate = gateBatch('company', readOrgMeterKb(appState, 'bob'), 5);
		expect(gate.blocked).toBe(true);
		expect(gate.maxRepos).toBe(0);
	});

	it('takes the larger of the durable counter and the derived run history per bag', () => {
		const appState = {
			tenant: {
				alice: { meter_kb_used: 1000, runs: [run('alice', 3)] }, // derived 1500 wins
				bob: { meter_kb_used: 4000, runs: [run('bob', 1)] }, // durable 4000 wins
			},
		};
		expect(readOrgMeterKb(appState)).toBe(5500);
	});

	it('counts legacy rows only when no bag covers their owner, unstamped always', () => {
		const appState = {
			tenant: { alice: { meter_kb_used: 1000, runs: [] } },
			runs: [
				run('alice', 4), // alice has a bag; her bag already accounts for her
				run('carol', 2), // no bag for carol: counts (1000)
				{ id: 'ancient', results: [{ status: 'complete', reason: '' }] }, // unstamped: counts (500)
			],
		};
		expect(readOrgMeterKb(appState)).toBe(1000 + 1000 + 500);
	});

	it('survives garbage shapes and empty state', () => {
		expect(readOrgMeterKb({})).toBe(0);
		expect(readOrgMeterKb({ tenant: null, runs: 'nope' })).toBe(0);
		expect(readOrgMeterKb({ tenant: { alice: { meter_kb_used: Number.NaN, runs: null } } })).toBe(0);
	});

	it('leaves run privacy untouched: tenant reads still filter by owner', () => {
		const appState = {
			tenant: {
				alice: { meter_kb_used: 0, runs: [run('alice', 1, 'a1')] },
				bob: { meter_kb_used: 0, runs: [run('bob', 1, 'b1')] },
			},
		};
		expect(readTenantRuns(appState, 'bob').map((r) => r.id)).toEqual(['b1']);
		expect(readTenantRuns(appState, 'alice').map((r) => r.id)).toEqual(['a1']);
		// while the meter still sees both
		expect(readOrgMeterKb(appState)).toBe(1000);
	});
});
