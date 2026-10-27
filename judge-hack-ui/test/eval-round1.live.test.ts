/**
 * Round 1 live eval. Gated: not part of `npm.cmd run build`.
 *
 *   $env:HJ_EVAL_ROUND1='1'; npx.cmd vitest run test/eval-round1.live.test.ts
 *
 * Uses the same runRepos / extractTarget / parseCsv path as Quick verify,
 * New run, and Targets Prefill. Never logs secret values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inferArchitectureTemplate, ARCHITECTURE_TEMPLATES } from '../src/verify/architecture';
import { extractTarget, runRepos, type VerifyClient } from '../src/verify/session';
import { parseCsv } from '../src/verify/sheet';
import { isFlagged, summarize } from '../src/format';
import { ANTHROPIC_KEY_NAME, narrationOnFromNames, explainVerdictConflicts } from '../src/verify/narration';
import { GITHUB_TOKEN_KEY } from '../src/verify/githubToken';
import type { ExtractedTarget, Submission, VerifyResult } from '../src/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');
const evalsDir = path.join(appRoot, 'evals');
const require = createRequire(path.join(appRoot, 'package.json'));
const { RocketRideClient } = require('rocketride') as {
	RocketRideClient: new (opts: { uri: string; auth: string }) => {
		connect: () => Promise<{
			email?: string;
			userId?: string;
			preferredUsername?: string;
			organization?: { id?: string; name?: string } | null;
		}>;
		disconnect: () => Promise<void>;
		use: VerifyClient['use'];
		tool: VerifyClient['tool'];
		chat: VerifyClient['chat'];
		terminate: VerifyClient['terminate'];
		account: {
			getEnv: (scope: 'org' | 'team' | 'user', scopeId?: string) => Promise<Record<string, string>>;
			getEnvironmentKeys: () => Promise<string[]>;
		};
		listDeployments: (appId: string) => Promise<Array<{
			registryVersion: number;
			buildStatus?: string;
			state?: string;
			rungs?: string[];
		}>>;
		whereApp: (appId: string) => Promise<Array<{
			rung?: string;
			handle?: string;
			version?: number;
			state?: string;
		}>>;
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

const LIVE = process.env.HJ_EVAL_ROUND1 === '1';

function windowLabel(w: VerifyResult['event_window']): string {
	if (!w) return '';
	if (Array.isArray(w)) return `${w[0]} → ${w[1]}`;
	return `${w.start || ''} → ${w.end || ''}`;
}

function failedRow(r: VerifyResult): boolean {
	return !!r.classify_failed || r.repo_accessible === false
		|| r.status === 'unverifiable' || r.status === 'fetch_incomplete';
}

function sawVerdict(r: VerifyResult): string {
	if (failedRow(r)) {
		return `FAILED, score "-", backbone "-", status=${r.status || ''} reason=${JSON.stringify(String(r.reason || r.notes || ''))}`;
	}
	const win = windowLabel(r.event_window);
	const earliest = r.earliest_commit ? String(r.earliest_commit).slice(0, 10) : '';
	return [
		`tag=${r.tag}`,
		`score=${r.score}`,
		`backbone=${r.backbone}`,
		`flagged=${isFlagged(r)}`,
		`predates=${!!r.project_predates}`,
		earliest ? `earliest_commit=${earliest}` : '',
		win ? `event_window=${win}` : '',
		r.history_penalty != null ? `history_penalty=${r.history_penalty}` : '',
		`explain_failed=${!!r.explain_failed}`,
	].filter(Boolean).join(', ');
}

function toolbarLine(results: VerifyResult[]): string {
	const tags = summarize(results).tags;
	const parts = Object.entries(tags).map(([t, n]) => `${t}: ${n}`);
	return `${results.length} / ${results.length} verified; ${parts.join(', ')}`;
}

function hopperOf(results: VerifyResult[]): VerifyResult | undefined {
	return results.find((r) => /vraj00222\/hopper/i.test(String(r.github || '')));
}

function zodOf(results: VerifyResult[]): VerifyResult | undefined {
	return results.find((r) => /colinhacks\/zod/i.test(String(r.github || '')));
}

function filesNamedIn(text: string): string[] {
	return [...String(text || '').matchAll(/\b[\w./-]+\.(ts|tsx|js|jsx|py|pipe|json|md|toml|yml|yaml)\b/gi)]
		.map((m) => m[0]);
}

function evidenceBlob(r: VerifyResult): string {
	return [
		...(r.evidence || []),
		...(r.pipelines || []).map((p) => p.name),
		r.rocketride_usage,
		r.notes,
		r.justification,
	].map((x) => String(x || '')).join('\n');
}

type CaseRow = {
	id: string;
	did: string;
	expected: string;
	saw: string;
	verdict: 'PASS' | 'FAIL' | 'UNCLEAR';
	screenshot?: string;
	advisory?: boolean;
};

function judge(ok: boolean, saw: string, expected: string, extraFail?: string): { verdict: CaseRow['verdict']; saw: string } {
	if (extraFail) return { verdict: 'FAIL', saw: `${saw}. ${extraFail}` };
	return { verdict: ok ? 'PASS' : 'FAIL', saw };
}

describe.skipIf(!LIVE)('eval round 1 live', () => {
	it('runs the seed answer key on staging and writes EVALS-ROUND-1.md', async () => {
		const uri = process.env.ROCKETRIDE_URI;
		const auth = process.env.ROCKETRIDE_APIKEY;
		expect(uri && auth, 'workspace .env must have ROCKETRIDE_URI / ROCKETRIDE_APIKEY').toBeTruthy();

		const sheet = parseCsv(fs.readFileSync(path.join(evalsDir, 'eval-sheet.csv'), 'utf8'));
		const headers = parseCsv(fs.readFileSync(path.join(evalsDir, 'eval-sheet-headers.csv'), 'utf8'));
		const sheetUrls = sheet.map((r) => r.github);
		const headerUrls = headers.map((r) => r.github);
		expect(sheet).toHaveLength(5);
		expect(headerUrls).toEqual(sheetUrls);

		const client = new RocketRideClient({ uri: uri as string, auth: auth as string });
		const info = await client.connect();
		const accountName = String(info.email || info.preferredUsername || 'signed-in').replace(/@.*/, '');
		let buildLine = 'version not listed';
		try {
			const pins = await client.whereApp('hackjudge.judge-hack');
			buildLine = (pins || []).map((p) => `${p.handle || p.rung}=v${p.version} ${p.state}`).join('; ');
		} catch (err) {
			buildLine = `whereApp failed (${err instanceof Error ? err.message : 'error'})`;
		}

		let githubPresent = false;
		let githubReadError = '';
		try {
			const userEnv = await client.account.getEnv('user');
			githubPresent = !!(userEnv && typeof userEnv === 'object' && String(userEnv[GITHUB_TOKEN_KEY] || '').trim());
		} catch (err) {
			githubReadError = err instanceof Error ? err.message : 'getEnv user failed';
		}

		let narrationOn = false;
		try {
			const names = await client.account.getEnvironmentKeys();
			narrationOn = narrationOnFromNames(names);
		} catch {
			narrationOn = false;
		}

		const cases: CaseRow[] = [];
		const note = (row: CaseRow) => { cases.push(row); };
		const githubToken = githubPresent
			? String((await client.account.getEnv('user'))[GITHUB_TOKEN_KEY] || '')
			: '';

		if (!githubPresent) {
			for (const id of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12', 'E13']) {
				note({
					id,
					did: 'Could not start the case',
					expected: 'Live verify on staging',
					saw: githubReadError || 'GitHub token missing in user Environment Variables',
					verdict: 'UNCLEAR',
				});
			}
		} else {
			const verify = async (repos: Submission[], eventDate: string, runName: string, customTarget?: { name: string; config: Record<string, unknown> }) => {
				return runRepos({
					client: client as unknown as VerifyClient,
					repos,
					eventDate,
					historyPenalty: 2,
					runName,
					githubToken,
					customTarget,
					plan: 'developer',
				});
			};

			console.log('eval-r1: E1 hopper 2026-08-03');
			const e1 = (await verify([{ project: 'hopper', github: 'https://github.com/vraj00222/hopper' }], '2026-08-03', 'QA-eval-r1-E1'))[0];
			const e1ok = !failedRow(e1) && e1.tag === 'Significant' && Number(e1.score) === 4.5 && e1.backbone === 'Yes' && !isFlagged(e1);
			note({
				id: 'E1',
				did: 'Quick-verify path: vraj00222/hopper, RocketRide preset, event 2026-08-03, penalty 2',
				expected: 'Significant, 4.5, backbone Yes, Built on "in window"',
				...judge(e1ok, sawVerdict(e1), 'Significant 4.5 Yes in-window', e1ok && isFlagged(e1) ? 'flagged unexpectedly' : undefined),
			});

			const e2 = (await verify([{ project: 'hopper', github: 'https://github.com/vraj00222/hopper' }], '2026-09-10', 'QA-eval-r1-E2'))[0];
			const e2win = windowLabel(e2.event_window);
			const e2ok = !failedRow(e2) && e2.tag === 'Moderate' && Number(e2.score) === 2.5 && isFlagged(e2)
				&& String(e2.earliest_commit || '').startsWith('2026-08-03')
				&& /2026-09-08/.test(e2win) && /2026-09-12/.test(e2win);
			note({
				id: 'E2',
				did: 'Quick-verify path: vraj00222/hopper, event 2026-09-10, penalty 2',
				expected: 'Moderate, 2.5, Flagged, work back to 2026-08-03, window 2026-09-08 to 2026-09-12, penalty minus 2',
				...judge(e2ok, sawVerdict(e2), 'Moderate 2.5 flagged window'),
			});

			const e3 = (await verify([{ project: 'hello-world', github: 'https://github.com/octocat/Hello-World' }], '2026-08-03', 'QA-eval-r1-E3'))[0];
			note({
				id: 'E3',
				did: 'Quick-verify path: octocat/Hello-World, event 2026-08-03, penalty 2',
				expected: 'None, 0.0, backbone No',
				...judge(!failedRow(e3) && e3.tag === 'None' && Number(e3.score) === 0 && e3.backbone === 'No', sawVerdict(e3), 'None 0.0 No'),
			});

			const e4 = (await verify([{ project: 'p-map', github: 'https://github.com/sindresorhus/p-map' }], '2026-08-03', 'QA-eval-r1-E4'))[0];
			note({
				id: 'E4',
				did: 'Quick-verify path: sindresorhus/p-map, event 2026-08-03, penalty 2',
				expected: 'None, 0.0, backbone No',
				...judge(!failedRow(e4) && e4.tag === 'None' && Number(e4.score) === 0 && e4.backbone === 'No', sawVerdict(e4), 'None 0.0 No'),
			});

			const e5 = (await verify([{ project: 'zod', github: 'https://github.com/colinhacks/zod' }], '2026-08-03', 'QA-eval-r1-E5'))[0];
			note({
				id: 'E5',
				did: 'Quick-verify path: colinhacks/zod, event 2026-08-03, penalty 2',
				expected: 'None, 0.0, backbone No',
				...judge(!failedRow(e5) && e5.tag === 'None' && Number(e5.score) === 0 && e5.backbone === 'No', sawVerdict(e5), 'None 0.0 No'),
			});

			const e6 = (await verify([{ project: 'trailbridge', github: 'https://github.com/Mr-Shockwave/Trailbridge' }], '2026-08-03', 'QA-eval-r1-E6'))[0];
			const e6ok = failedRow(e6) && (e6.tag == null || e6.tag === '') && (e6.score == null || !Number.isFinite(Number(e6.score)));
			note({
				id: 'E6',
				did: 'Quick-verify path: Mr-Shockwave/Trailbridge, event 2026-08-03, penalty 2',
				expected: 'FAILED, score "-", backbone "-", never a scored tag',
				...judge(e6ok, sawVerdict(e6), 'FAILED no tag'),
			});

			const e7 = await verify(sheet, '2026-08-03', 'QA-eval-r1-sheet');
			const tags7 = summarize(e7).tags;
			const e7ok = e7.length === 5
				&& (tags7.Significant || 0) === 1
				&& (tags7.None || 0) === 3
				&& (tags7.FAILED || 0) === 1;
			const hopper7 = hopperOf(e7);
			note({
				id: 'E7',
				did: 'Batch path named QA-eval-r1-sheet, event 2026-08-03, penalty 2, preset, eval-sheet.csv',
				expected: '5 / 5 verified; toolbar Significant: 1, None: 3, FAILED: 1; hopper dossier agrees',
				...judge(e7ok && hopper7?.tag === 'Significant' && Number(hopper7?.score) === 4.5, `${toolbarLine(e7)}; hopper ${hopper7 ? sawVerdict(hopper7) : 'missing'}`, '5/5 Sig1 None3 FAILED1'),
			});

			const e12same = hopper7 && Number(e1.score) === Number(hopper7.score) && e1.tag === hopper7.tag && e1.backbone === hopper7.backbone;
			note({
				id: 'E12',
				did: 'Compare hopper score from E1 and from E7',
				expected: 'Identical (4.5 both)',
				...judge(!!e12same, `E1 score=${e1.score} tag=${e1.tag}; E7 hopper score=${hopper7?.score} tag=${hopper7?.tag}`, '4.5 both'),
			});

			const e13 = await verify(headers, '2026-08-03', 'QA-eval-r1-headers');
			const tags13 = summarize(e13).tags;
			const mapped = headerUrls.length === 5 && headerUrls.every((u, i) => u === sheetUrls[i]);
			const e13ok = mapped && e13.length === 5
				&& (tags13.Significant || 0) === (tags7.Significant || 0)
				&& (tags13.None || 0) === (tags7.None || 0)
				&& (tags13.FAILED || 0) === (tags7.FAILED || 0);
			note({
				id: 'E13',
				did: 'Batch path named QA-eval-r1-headers, eval-sheet-headers.csv (Project Name / GitHub URL)',
				expected: 'Same 5 repos and URLs; counts match E7',
				...judge(e13ok, `mapped=${mapped} urls=${headerUrls.join(' ')}; ${toolbarLine(e13)}`, 'same 5 URLs and counts'),
			});

			let extracted: ExtractedTarget = { status: 'failed', reason: 'not run' };
			try {
				extracted = await extractTarget(client as unknown as VerifyClient, {
					githubUrl: 'https://github.com/topoteretes/cognee',
					docsUrl: 'https://docs.cognee.ai/',
				}, githubToken);
			} catch (err) {
				extracted = { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
			}
			const cfg = extracted.config || {};
			const name = String(cfg.name || extracted.config?.name || '');
			const invocation = String(cfg.invocation || '');
			const hosted = String(cfg.hosted_markers || '');
			const cli = String(cfg.cli_verbs || '');
			const types = cfg.types;
			const archId = inferArchitectureTemplate(types, cfg.architecture_template);
			const archLabel = ARCHITECTURE_TEMPLATES[archId].label;
			const nameOk = /cognee/i.test(name) && !/tier\s*1/i.test(name);
			const invOk = /import\s+cognee/i.test(invocation) || /cognee\.add/i.test(invocation) || /cognify/i.test(invocation);
			const envOk = /COGNEE[_A-Z]*KEY|cognee[_-]?api[_-]?key/i.test(`${hosted} ${JSON.stringify(cfg)}`);
			const cliOk = /cognee-cli/i.test(cli) || /cognee-cli/i.test(invocation);
			const archOk = /sdk|library/i.test(archLabel);
			const docsWarn = (extracted.warnings || []).some((w) => /docs/i.test(w));
			const e9ok = extracted.status === 'complete' && nameOk && invOk && envOk && cliOk && archOk;
			note({
				id: 'E9',
				did: 'Prefill path: github.com/topoteretes/cognee + docs.cognee.ai, in-session as Eval-R1-Cognee (not persisted)',
				expected: 'Name Cognee not TIER 1; invocation tokens; consumer env keys; cognee-cli; architecture SDK / library',
				...judge(e9ok, `status=${extracted.status} name=${JSON.stringify(name)} arch=${archLabel} invocation=${JSON.stringify(invocation.slice(0, 240))} hosted=${JSON.stringify(hosted.slice(0, 160))} cli=${JSON.stringify(cli.slice(0, 160))} warnings=${JSON.stringify(extracted.warnings || [])} docs_warning=${docsWarn}`, 'Cognee prefill shape'),
			});

			const cogneeTarget = {
				name: 'Eval-R1-Cognee',
				config: { ...cfg, name: name || 'Cognee' },
			};
			const e8 = (await verify(
				[{ project: 'hopper', github: 'https://github.com/vraj00222/hopper' }],
				'2026-08-03',
				'QA-eval-r1-E8',
				cogneeTarget,
			))[0];
			note({
				id: 'E8',
				did: 'Quick-verify path: vraj00222/hopper against Eval-R1-Cognee, event 2026-08-03, penalty 2',
				expected: 'None. hopper does not use Cognee',
				...judge(!failedRow(e8) && e8.tag === 'None', sawVerdict(e8), 'None'),
			});

			const hopperProse = [hopper7?.description, hopper7?.rocketride_usage, hopper7?.justification].join('\n');
			const invented = filesNamedIn(hopperProse).filter((f) => !evidenceBlob(hopper7 || {}).toLowerCase().includes(f.toLowerCase()));
			const proseConflict = hopper7 ? explainVerdictConflicts({
				tag: undefined,
				backbone: undefined,
				score: undefined,
			}, hopper7) : false;
			const impliesOther = /moderate|none tag|backbone no|score\s*[0-9]/i.test(hopperProse)
				&& !/significant/i.test(hopperProse || '');
			if (!narrationOn && hopper7?.explain_failed) {
				note({
					id: 'E10',
					did: 'Read hopper prose from E7',
					expected: 'No contradicting tag/score/backbone; no invented file names. Keyless fallback is a PASS state',
					saw: `AI narration off. explain_failed=${hopper7.explain_failed} label would be "Summary from verified evidence" (brief still names "Model explanation unavailable"). prose=${JSON.stringify(hopperProse.slice(0, 400))}`,
					verdict: 'PASS',
					advisory: true,
				});
			} else if (!narrationOn) {
				note({
					id: 'E10',
					did: 'Read hopper prose from E7',
					expected: 'Model prose, or keyless fallback',
					saw: 'Anthropic key name not in merged environment key names',
					verdict: 'UNCLEAR',
					advisory: true,
				});
			} else {
				const e10ok = !!hopper7 && !hopper7.explain_failed && invented.length === 0 && !proseConflict && !impliesOther;
				note({
					id: 'E10',
					did: 'Read hopper prose from E7',
					expected: 'Paragraphs never state or imply a different tag, score, or backbone; no invented file names',
					saw: `explain_failed=${hopper7?.explain_failed} invented_files=${JSON.stringify(invented)} description=${JSON.stringify(String(hopper7?.description || '').slice(0, 280))} usage=${JSON.stringify(String(hopper7?.rocketride_usage || '').slice(0, 280))}`,
					verdict: e10ok ? 'PASS' : 'FAIL',
					advisory: true,
				});
			}

			const zod7 = zodOf(e7);
			const zodProse = [zod7?.description, zod7?.rocketride_usage, zod7?.justification].join('\n');
			const zodClaims = /(?<!no (?:real )?)rocketride (?:pipeline|sdk|client)|client\.use|\.pipe\b|pipeline is actively called/i.test(zodProse);
			if (!narrationOn && zod7?.explain_failed) {
				note({
					id: 'E11',
					did: 'Read zod prose from E7',
					expected: 'A None repo must not claim RocketRide usage',
					saw: `AI narration off, evidence fallback. usage=${JSON.stringify(String(zod7?.rocketride_usage || '').slice(0, 280))}`,
					verdict: /no .*pipeline usage was found|none of the|not used/i.test(String(zod7?.rocketride_usage || '')) || !zodClaims ? 'PASS' : 'FAIL',
					advisory: true,
				});
			} else if (!narrationOn) {
				note({
					id: 'E11',
					did: 'Read zod prose from E7',
					expected: 'A None repo must not claim RocketRide usage',
					saw: 'Anthropic key name not in merged environment key names',
					verdict: 'UNCLEAR',
					advisory: true,
				});
			} else {
				note({
					id: 'E11',
					did: 'Read zod prose from E7',
					expected: 'A None repo must not claim RocketRide usage',
					saw: `tag=${zod7?.tag} explain_failed=${zod7?.explain_failed} usage=${JSON.stringify(String(zod7?.rocketride_usage || '').slice(0, 320))}`,
					verdict: zod7?.tag === 'None' && !zodClaims ? 'PASS' : 'FAIL',
					advisory: true,
				});
			}
		}

		await client.disconnect();

		const passed = cases.filter((c) => c.verdict === 'PASS').length;
		const failed = cases.filter((c) => c.verdict === 'FAIL').length;
		const unclear = cases.filter((c) => c.verdict === 'UNCLEAR').length;
		const today = new Date().toISOString().slice(0, 10);
		const defects = cases.filter((c) => c.verdict === 'FAIL');

		const report = [
			'# Judge Hack evals, Round 1',
			'',
			`Date: ${today}`,
			'Host: https://staging.rocketride.ai',
			'App: hackjudge.judge-hack',
			`Build (whereApp): ${buildLine}`,
			`Account: ${accountName} (name only)`,
			`AI narration key name present: ${narrationOn ? 'yes' : 'no'}`,
			'Storage: not observed in the browser. This round called the same `runRepos` / `extractTarget` / `parseCsv` functions Quick verify, New run, and Targets Prefill use, against the signed-in staging connection. Named UI runs were not written to SQL, so there is no blob-fallback banner to quote.',
			'Method: live staging pipes (Python V1 + Explain V1 + extract). Not fixture `run_eval.py`. Not guessed from earlier hopper 4.5 notes.',
			'Cleanup: Eval-R1-Cognee was extracted in-session and not saved on Targets, so there was nothing to delete. Engine cases used run names QA-eval-r1-E1..E6, QA-eval-r1-sheet, QA-eval-r1-headers, QA-eval-r1-E8 (in-process only).',
			'',
			'Framing for Shashi: first eval round on the seed answer key; add your evals on top of this.',
			'',
			'| Case | Did | Expected | Saw | Verdict |',
			'|---|---|---|---|---|',
			...cases.map((c) => `| ${c.id}${c.advisory ? ' (advisory)' : ''} | ${c.did.replace(/\|/g, '/')} | ${c.expected.replace(/\|/g, '/')} | ${c.saw.replace(/\|/g, '/')} | ${c.verdict} |`),
			'',
			`Totals: ${passed} PASS, ${failed} FAIL, ${unclear} UNCLEAR (${cases.length} cases).`,
			'',
			'## Defects',
			'',
			defects.length ? defects.map((c) => [
				`#### ${c.id}: ${c.expected}`,
				`Severity: ${c.id === 'E12' || c.id === 'E8' || c.id === 'E1' || c.id === 'E6' ? 'high' : (c.advisory ? 'low (advisory surface)' : 'medium')}`,
				'Address: staging.rocketride.ai / hackjudge.judge-hack (live pipe path, not a browser bar)',
				`Saw: "${c.saw.replace(/"/g, "'")}"`,
				`Expected: "${c.expected.replace(/"/g, "'")}"`,
				`Steps: ${c.did}`,
				'Screenshot: (none; this round was not a browser screenshot pass)',
				'',
			].join('\n')).join('\n') : 'None. Every case that could be judged passed.',
			'',
		].join('\n');

		fs.mkdirSync(evalsDir, { recursive: true });
		fs.writeFileSync(path.join(evalsDir, 'EVALS-ROUND-1.md'), report);
		const status = [
			'# Judge Hack evals status',
			'',
			'These evals test the decision-making, LLM, and agent-adjacent surfaces of Judge Hack against a fixed public-repo answer key: the deterministic engine (tag / score / backbone / pre-event flag), advisory explain prose, Targets Prefill, and sheet column mapping. The dummy pipe agent must never produce a verdict. Round 1 is the seed; later rounds add Shashi\'s cases on top and re-check open defects.',
			'',
			`## Round 1 (${today}, staging @me)`,
			'',
			`| Passed | Failed | Unclear |`,
			`|---:|---:|---:|`,
			`| ${passed} | ${failed} | ${unclear} |`,
			'',
			'### Defects open',
			'',
			defects.length ? defects.map((c) => `- ${c.id}: ${c.saw}`).join('\n') : '- None.',
			'',
			'Fixes that come out of this round must cite `evals/EVALS-ROUND-1.md`. Round 2 re-checks every open defect before new cases are added.',
			'',
		].join('\n');
		fs.writeFileSync(path.join(evalsDir, 'STATUS.md'), status);
		try {
			fs.writeFileSync(path.join('C:/Users/Poushali/Downloads/EVALS-ROUND-1.md'), report);
			fs.writeFileSync(path.join('C:/Users/Poushali/Downloads/Judge-Hack-evals-STATUS.md'), status);
		} catch {
			/* Downloads copy is optional */
		}

		expect(cases).toHaveLength(13);
	}, 2_400_000);
});
