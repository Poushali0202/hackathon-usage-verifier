/**
 * Live two-session Verify. Gated so `npm test` does not hit the engine.
 *
 *   $env:HJ_LIVE_TWO_STORE='1'; npx vitest run test/task1-two-store-live.e2e.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runRepos, type VerifyClient } from '../src/verify/session';
import { planWorkerCap } from '../src/verify/pool';
import type { PlanTier, Submission } from '../src/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride') as {
	RocketRideClient: new (opts: { uri: string; auth: string }) => {
		connect: () => Promise<{
			email?: string;
			userId?: string;
			organization?: { id?: string; name?: string } | null;
		}>;
		disconnect: () => Promise<void>;
		use: (opts: { pipeline: unknown; name: string; ttl: number }) => Promise<{ token: string }>;
		tool: (opts: unknown) => Promise<unknown>;
		chat: (opts: unknown) => Promise<unknown>;
		terminate: (token: string) => Promise<void>;
		account: {
			getOrg: (orgId?: string) => Promise<{ name?: string; memberCount?: number; plan?: string }>;
			listMembers: (orgId: string) => Promise<Array<{ userId: string; role?: string; status?: string }>>;
		};
	};
};

function loadEnv(file: string) {
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq < 1) continue;
		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = val;
	}
}

loadEnv(path.join(workspaceRoot, '.env'));

const TINY = 'https://github.com/octocat/Hello-World';

function repos(n: number, prefix: string): Submission[] {
	return Array.from({ length: n }, (_, i) => ({
		project: `${prefix}-${i + 1}`,
		github: TINY,
	}));
}

type Tracker = {
	peak: number;
	cpuDenials: number;
	boots: Array<{ label: string; token: string }>;
	live: Set<string>;
	open: (label: string, token: string) => void;
	close: (token: string) => void;
	denyCpu: () => void;
};

function makeTracker(): Tracker {
	const live = new Set<string>();
	const boots: Array<{ label: string; token: string }> = [];
	let peak = 0;
	let cpuDenials = 0;
	return {
		get peak() { return peak; },
		get cpuDenials() { return cpuDenials; },
		boots,
		live,
		open(label, token) {
			boots.push({ label, token });
			live.add(token);
			peak = Math.max(peak, live.size);
		},
		close(token) {
			live.delete(token);
		},
		denyCpu() {
			cpuDenials += 1;
		},
	};
}

function wrap(raw: InstanceType<typeof RocketRideClient>, label: string, tracker: Tracker): VerifyClient {
	return {
		async use(opts) {
			if (/explain/i.test(String(opts.name || ''))) throw new Error('explain skipped');
			try {
				const started = await raw.use(opts);
				tracker.open(label, started.token);
				return started;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw err;
			}
		},
		tool: (opts) => raw.tool(opts),
		chat: async () => { throw new Error('explain skipped'); },
		async terminate(token) {
			tracker.close(token);
			try { await raw.terminate(token); } catch { /* already gone */ }
		},
	};
}

async function sessionVerify(
	client: VerifyClient,
	plan: PlanTier,
	count: number,
	label: string,
	signal: AbortSignal,
) {
	const stages: string[] = [];
	const results = await runRepos({
		client,
		repos: repos(count, label),
		eventDate: '2026-09-16',
		historyPenalty: 2,
		runName: `store-${label}`,
		githubToken: process.env.ROCKETRIDE_GITHUB_TOKEN || '',
		plan,
		signal,
		onStage: (s) => stages.push(s),
	});
	return { plan, label, stages, results };
}

describe.skipIf(process.env.HJ_LIVE_TWO_STORE !== '1')('two Store-session live Verify', { timeout: 420_000 }, () => {
	it('two isolated clients can click Verify at once; plan caps hold; org pool is shared', async () => {
		const uri = process.env.ROCKETRIDE_URI;
		const auth = process.env.ROCKETRIDE_APIKEY;
		if (!uri || !auth) throw new Error('Missing ROCKETRIDE_URI or ROCKETRIDE_APIKEY');

		const leftRaw = new RocketRideClient({ uri, auth });
		const rightRaw = new RocketRideClient({ uri, auth });
		const leftInfo = await leftRaw.connect();
		const rightInfo = await rightRaw.connect();
		const orgId = leftInfo.organization?.id;
		const org = orgId ? await leftRaw.account.getOrg(orgId) : await leftRaw.account.getOrg();
		let memberCount = org.memberCount ?? 0;
		let memberIds = 0;
		try {
			if (orgId) {
				const members = await leftRaw.account.listMembers(orgId);
				memberCount = members.length;
				memberIds = new Set(members.map((m) => m.userId)).size;
			}
		} catch {
			memberIds = 1;
		}
		console.log(`org=${org.name || 'unknown'} members=${memberCount} unique_ids=${memberIds || 1} left_user=${(leftInfo.userId || '').slice(0, 8)} right_user=${(rightInfo.userId || '').slice(0, 8)} same_identity=${leftInfo.userId === rightInfo.userId}`);

		const overlap = async (aPlan: PlanTier, aRepos: number, bPlan: PlanTier, bRepos: number) => {
			const tracker = makeTracker();
			const aCtrl = new AbortController();
			const bCtrl = new AbortController();
			const aClient = wrap(leftRaw, aPlan, tracker);
			const bClient = wrap(rightRaw, bPlan, tracker);
			const expected = planWorkerCap(aPlan) + planWorkerCap(bPlan);
			const hold = (async () => {
				const t0 = Date.now();
				while (Date.now() - t0 < 90_000) {
					if (tracker.live.size >= Math.min(expected, aRepos + bRepos) && tracker.live.size >= 2) {
						await new Promise((r) => setTimeout(r, 12_000));
						aCtrl.abort();
						bCtrl.abort();
						return;
					}
					await new Promise((r) => setTimeout(r, 400));
				}
				aCtrl.abort();
				bCtrl.abort();
			})();
			const [a, b] = await Promise.all([
				sessionVerify(aClient, aPlan, aRepos, aPlan, aCtrl.signal),
				sessionVerify(bClient, bPlan, bRepos, bPlan, bCtrl.signal),
				hold,
			]);
			const aBoots = tracker.boots.filter((row) => row.label === aPlan).length;
			const bBoots = tracker.boots.filter((row) => row.label === bPlan).length;
			console.log(`${aPlan}+${bPlan} peak=${tracker.peak} ${aPlan}_boots=${aBoots} ${bPlan}_boots=${bBoots} cpu_denials=${tracker.cpuDenials} ${aPlan}_rows=${a.results.length} ${bPlan}_rows=${b.results.length}`);
			return { a, b, aBoots, bBoots, peak: tracker.peak, cpuDenials: tracker.cpuDenials };
		};

		try {
			const fit = await overlap('developer', 2, 'company', 3);
			expect(fit.a.stages.some((s) => s.includes('Starting 2 evaluators'))).toBe(true);
			expect(fit.b.stages.some((s) => s.includes('Starting 3 evaluators'))).toBe(true);
			expect(fit.aBoots).toBeLessThanOrEqual(2);
			expect(fit.bBoots).toBeLessThanOrEqual(3);
			expect(fit.a.results).toHaveLength(2);
			expect(fit.b.results).toHaveLength(3);
			expect(fit.peak).toBeGreaterThanOrEqual(2);

			const overflow = await overlap('company', 3, 'organizers', 3);
			expect(overflow.aBoots).toBeLessThanOrEqual(3);
			expect(overflow.bBoots).toBeLessThanOrEqual(3);
			expect(overflow.a.results).toHaveLength(3);
			expect(overflow.b.results).toHaveLength(3);
			expect(overflow.peak).toBeGreaterThan(3);

			process.stdout.write(`FINDING members=${memberCount} same_rr_user=${leftInfo.userId === rightInfo.userId} fit_peak=${fit.peak} overflow_peak=${overflow.peak} overflow_cpu=${overflow.cpuDenials}\n`);
			const out = path.join(appRoot, '.tmp-two-store-findings.json');
			fs.writeFileSync(out, JSON.stringify({
				memberCount,
				memberIds: memberIds || 1,
				sameIdentity: leftInfo.userId === rightInfo.userId,
				fitPeak: fit.peak,
				fitDevBoots: fit.aBoots,
				fitCompanyBoots: fit.bBoots,
				overflowPeak: overflow.peak,
				overflowCompanyBoots: overflow.aBoots,
				overflowOrganizersBoots: overflow.bBoots,
				overflowCpuDenials: overflow.cpuDenials,
			}, null, 2));
		} finally {
			await Promise.all([leftRaw.disconnect(), rightRaw.disconnect()]);
		}
	});
});
