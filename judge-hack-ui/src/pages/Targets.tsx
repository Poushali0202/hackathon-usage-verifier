import React, { useState } from 'react';
import { usePrefs, useShellConnection } from 'shell';
import { isCompanyPlan } from '../billing';
import { GithubTokenNotice, Page, TagPill, TierLockModal, OrgBusyModal } from '../components/bits';
import { ROCKETRIDE_PRESET, useRuns } from '../RunsContext';
import type { ExtractedTarget, TargetRecord, VerifyResult } from '../types';
import { requireGithubToken, type EnvClient } from '../verify/githubToken';
import { extractTarget, testTargetRepo, type VerifyClient } from '../verify/session';
import { isOrgBusyError } from '../verify/leases';
import {
	ARCHITECTURE_TEMPLATES,
	inferArchitectureTemplate,
	isStockArchitecture,
	scoringConfigForPlan,
} from '../verify/architecture';
import { normalizeGithub } from '../verify/sheet';

const LASERDATA_SAMPLE_REPO = 'https://github.com/laserdata/laser-sdk';

/** Deterministic LaserData target — tokens from the public SDK (npm/PyPI/crates), not LLM-invented. */
const LASERDATA_CONFIG: Record<string, unknown> = {
	types: ['code', 'platform', 'api'],
	architecture_template: 'data_platform',
	architecture: [
		{ id: 'install', label: 'Package installed', signal: 'dependency', load_bearing: false },
		{ id: 'client', label: 'Laser SDK', signal: 'invocation', load_bearing: true },
		{ id: 'stream', label: 'Live stream / API', signal: 'api_usage', load_bearing: true },
		{ id: 'config', label: 'Connection / env', signal: 'hosted', load_bearing: false },
		{ id: 'cloud', label: 'laserdata.cloud', signal: 'platform_deploy', load_bearing: true },
	],
	dependency_names: '@laserdata/laser-sdk, laser-sdk, laser-wire',
	artifacts: 'tool_laserdata_memory',
	invocation: 'Laser.connect | Laser.connectEnv | Laser.connect_env | Laser.local | from laser_sdk | laser_sdk:: | @laserdata/laser-sdk | tool_laserdata_memory',
	hosted_markers: 'LASER_CONNECTION_STRING, LASER_STREAM, LASER_TLS_CERT, LASER_NO_TLS, laserdata.cloud',
	cli_verbs: '',
	competitors: 'kafka, pulsar, redpanda',
	neutral: 'apache iggy, supabase',
	platform_domains: 'laserdata.cloud, laserdata.com',
	platform_files: '',
	platform_markers: 'LASER_CONNECTION_STRING',
};

const TYPES: [string, string][] = [
	['code', 'Code / SDK'],
	['platform', 'Platform / hosting'],
	['api', 'API / service'],
];

type FieldDef = [string, string, string, string];

const CODE_FIELDS: FieldDef[] = [
	['dependency_names', 'What is the package called?', 'Names that show up in package.json, requirements.txt, Cargo.toml, go.mod.', 'e.g. yourlib, @you/sdk'],
	['invocation', 'How does their code call you?', 'Function or import patterns that mean they actually used it, not just listed it.', 'e.g. client.run | YourClient'],
	['artifacts', 'Any files that only exist when they used you?', 'Config or output files your tooling writes.', 'e.g. *.pipe, .yourrc'],
	['hosted_markers', 'Env keys or API hosts we should look for?', 'Secrets names, hostnames, or SDK env prefixes.', 'e.g. YOURLIB_*, api.you.dev'],
	['cli_verbs', 'CLI commands, if any', '', 'e.g. yourlib deploy'],
];

const PLATFORM_FIELDS: FieldDef[] = [
	['platform_domains', 'Where do live projects show up?', 'Your product domains, preview URLs, or dashboard hosts.', 'e.g. *.yourplatform.app'],
	['platform_files', 'Config files only your platform writes?', '', 'e.g. vercel.json, yourplatform.yaml'],
	['platform_markers', 'Account or workspace tokens?', 'Env keys that mean they have an account with you.', 'e.g. YOURPLATFORM_TOKEN'],
	['platform_badges', 'README badges or “deployed on” claims?', '', 'e.g. Deployed on …'],
];

const OTHER_FIELDS: FieldDef[] = [
	['competitors', 'Who else would count as a competing product?', 'If we see these instead, it is not your backbone.', 'e.g. rival-sdk'],
	['neutral', 'Tools that should never count against them', 'Complementary infra (databases, auth) — not rivals.', 'e.g. supabase, firebase'],
];

const SCORE_SIGNALS: [string, string, number, string][] = [
	['dependency', 'Installed your package', 1.0, 'Listed in a manifest. Proves install, not use.'],
	['invocation', 'Calls it in code (3+ places)', 1.5, 'The core proof of real use.'],
	['invocation_deep', 'Uses it throughout (8+ places)', 1.0, 'Bonus when calls run through the whole codebase.'],
	['api_usage', 'Hits your API at runtime', 1.5, 'Live calls to your hosts, with or without the SDK.'],
	['hosted', 'Configured your keys', 0.5, 'Env vars or API keys are wired up. Setup is not usage.'],
	['file_spread', 'Present in 2+ files', 0.5, 'Not a single pasted example.'],
	['artifact', 'Committed your config files', 1.0, 'Files your tooling writes are in the repo.'],
	['platform_deploy', 'Shipped on your platform', 1.5, 'A live deployment on your domains.'],
];

const SCORE_THRESHOLDS: [string, string, number][] = [
	['significant', 'Significant', 4.0],
	['moderate', 'Moderate', 2.0],
	['less', 'Less', 1.0],
];

const STRICTNESS: Record<string, { label: string; thresholds: Record<string, number> }> = {
	lenient: { label: 'Lenient', thresholds: { significant: 3, moderate: 1.5, less: 0.5 } },
	balanced: { label: 'Balanced (default)', thresholds: { significant: 4, moderate: 2, less: 1 } },
	strict: { label: 'Strict', thresholds: { significant: 5.5, moderate: 3, less: 1.5 } },
};

type Weights = Record<string, number | string>;
type Thresholds = Record<string, number | string>;

const EXTRACT_KEYS = [
	'dependency_names', 'artifacts', 'invocation', 'hosted_markers', 'cli_verbs',
	'platform_domains', 'platform_files', 'platform_markers',
] as const;

const MAX_UPLOADS = 8;
const MAX_UPLOAD_CHARS = 250_000;

async function readUploads(files: File[]): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const file of files.slice(0, MAX_UPLOADS)) {
		const text = await file.text();
		out[file.name] = text.slice(0, MAX_UPLOAD_CHARS);
	}
	return out;
}

export default function Targets() {
	const { targets, saveTarget, deleteTarget, settings, makeOrgLease } = useRuns();
	const { client, isConnected } = useShellConnection();
	const { setPref } = usePrefs();
	const canTuneScore = isCompanyPlan(settings.plan);
	const [selId, setSelId] = useState(targets[0]?.id || ROCKETRIDE_PRESET.id);
	const [draft, setDraft] = useState<TargetRecord | null>(null);
	const [tab, setTab] = useState<'code' | 'hosted' | 'score'>('code');
	const [lockOpen, setLockOpen] = useState(false);
	const [msg, setMsg] = useState('');
	const [xUrl, setXUrl] = useState('');
	const [xDocs, setXDocs] = useState('');
	const [xPkg, setXPkg] = useState('');
	const [xFiles, setXFiles] = useState<File[]>([]);
	const [xBusy, setXBusy] = useState(false);
	const [xInfo, setXInfo] = useState<ExtractedTarget | null>(null);
	const [tUrl, setTUrl] = useState('');
	const [tBusy, setTBusy] = useState(false);
	const [tRes, setTRes] = useState<(VerifyResult & { error?: string }) | null>(null);
	const [orgBusyOpen, setOrgBusyOpen] = useState(false);

	const sel = draft || targets.find((t) => t.id === selId) || targets[0];
	const form: Record<string, unknown> = {
		types: (sel?.config.types as string[]) || ['code'],
		...sel?.config,
		name: sel?.name || '',
	};
	const weights = (form.weights as Weights) || {};
	const thresholds = (form.thresholds as Thresholds) || {};
	const readOnly = !!sel?.is_preset && !draft;
	const hasSource = xUrl.includes('github.com') || !!xDocs.trim() || !!xPkg.trim() || xFiles.length > 0;

	const patch = (next: TargetRecord) => {
		setDraft(next);
		setSelId(next.id);
	};

	const set = (k: string, v: unknown) => {
		if (readOnly || !sel) return;
		patch({
			id: sel.id,
			name: k === 'name' ? String(v) : sel.name,
			is_preset: false,
			config: { ...sel.config, types: form.types, [k]: v },
		});
	};

	const archId = inferArchitectureTemplate(form.types, form.architecture_template);
	function setArchitectureTemplate(id: keyof typeof ARCHITECTURE_TEMPLATES) {
		if (readOnly || !sel) return;
		patch({
			id: sel.id,
			name: sel.name,
			is_preset: false,
			config: {
				...sel.config,
				types: form.types,
				architecture_template: id,
				architecture: ARCHITECTURE_TEMPLATES[id].panes,
			},
		});
	}

	const selectedTypes = (): string[] => {
		const t = form.types;
		return Array.isArray(t) && t.length ? t.map(String) : ['code'];
	};

	function toggleType(kind: string) {
		const current = selectedTypes();
		const on = current.includes(kind);
		const next = on
			? (current.length > 1 ? current.filter((x) => x !== kind) : current)
			: [...current, kind];
		if (kind === 'platform' && next.includes('platform')) setTab('hosted');
		else setTab('code');
		if (readOnly && sel) {
			const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
				? crypto.randomUUID()
				: `target-${Date.now()}`;
			const inferred = inferArchitectureTemplate(next);
			patch({
				id,
				name: '',
				is_preset: false,
				config: {
					...sel.config,
					types: next,
					architecture_template: inferred,
					architecture: ARCHITECTURE_TEMPLATES[inferred].panes,
				},
			});
			setMsg('Started a custom target. Save it to use in runs — the RocketRide preset stays as-is.');
			return;
		}
		set('types', next);
		if (!readOnly && sel) {
			const inferred = inferArchitectureTemplate(next, form.architecture_template);
			const keepCustom = isStockArchitecture(form.architecture, archId) === false
				&& Array.isArray(form.architecture);
			if (!keepCustom && inferred !== archId) {
				patch({
					id: sel.id,
					name: sel.name,
					is_preset: false,
					config: {
						...sel.config,
						types: next,
						architecture_template: inferred,
						architecture: ARCHITECTURE_TEMPLATES[inferred].panes,
					},
				});
			}
		}
	}

	function startNew() {
		const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `target-${Date.now()}`;
		const created: TargetRecord = {
			id,
			name: '',
			is_preset: false,
			config: {
				types: ['code'],
				architecture_template: 'sdk',
				architecture: ARCHITECTURE_TEMPLATES.sdk.panes,
			},
		};
		setDraft(created);
		setSelId(id);
		setTab('code');
		setMsg('');
		setXInfo(null);
		setTRes(null);
		setXUrl('');
		setXDocs('');
		setXPkg('');
		setXFiles([]);
	}

	function loadLaserdataExample() {
		const existing = targets.find((t) => t.id === 'laserdata' || t.name.trim().toLowerCase() === 'laserdata');
		setXInfo(null);
		setTRes(null);
		setTab('code');
		setTUrl(LASERDATA_SAMPLE_REPO);
		setXUrl(LASERDATA_SAMPLE_REPO);
		if (existing) {
			setDraft(null);
			setSelId(existing.id);
			setPref('hj.targetId', existing.id);
			setMsg('LaserData target selected. Test it on the sample repo below — or pick it on Quick verify / New run.');
			return;
		}
		const created: TargetRecord = {
			id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `laserdata-${Date.now()}`,
			name: 'LaserData',
			is_preset: false,
			config: { ...LASERDATA_CONFIG },
		};
		saveTarget(created);
		setPref('hj.targetId', created.id);
		setDraft(null);
		setSelId(created.id);
		setMsg('LaserData example saved. Test it below, or pick it as the target on Quick verify / New run.');
	}

	function pick(t: TargetRecord) {
		setDraft(null);
		setSelId(t.id);
		setMsg('');
		setXInfo(null);
		setTRes(null);
	}

	function save() {
		const current = draft || sel;
		if (!current || current.is_preset) return;
		if (!current.name.trim()) { setMsg('Give the target a name.'); return; }
		const cfg = { ...current.config };
		const nextArch = inferArchitectureTemplate(cfg.types, cfg.architecture_template);
		const keepCustom = Array.isArray(cfg.architecture)
			&& !isStockArchitecture(cfg.architecture, inferArchitectureTemplate(cfg.types, cfg.architecture_template));
		saveTarget({
			...current,
			name: current.name.trim(),
			is_preset: false,
			config: {
				...cfg,
				architecture_template: nextArch,
				architecture: keepCustom
					? cfg.architecture
					: ARCHITECTURE_TEMPLATES[nextArch].panes,
			},
		});
		setPref('hj.targetId', current.id);
		setDraft(null);
		setSelId(current.id);
		setMsg('Saved — this target is live for new runs');
		setTimeout(() => setMsg((m) => (m.startsWith('Saved') ? '' : m)), 3500);
	}

	async function prefill(filesOverride?: File[]) {
		if (readOnly || !sel || !client || !isConnected) {
			setMsg(isConnected ? 'Create a custom target first.' : 'RocketRide is not connected yet.');
			return;
		}
		const files = filesOverride ?? xFiles;
		setXBusy(true); setXInfo(null); setMsg('');
		try {
			const uploads = files.length ? await readUploads(files) : undefined;
			const githubToken = await requireGithubToken(client as unknown as EnvClient);
			const res = await extractTarget(client as VerifyClient, {
				githubUrl: xUrl.trim() || undefined,
				docsUrl: xDocs.trim() || undefined,
				pkg: xPkg.trim() || undefined,
				uploads,
			}, githubToken, makeOrgLease('prefill'));
			if (res.status && res.status !== 'complete') {
				setMsg(res.reason || 'Extract did not return a config.');
				setXInfo(res);
				return;
			}
			const c = res.config || {};
			const types = Array.isArray(c.types) && c.types.length
				? c.types as string[]
				: (form.types as string[]);
			const extractedName = String(c.name || '').trim();
			const nextArch = inferArchitectureTemplate(types, c.architecture_template || form.architecture_template);
			const keepCustom = Array.isArray(form.architecture)
				&& !isStockArchitecture(form.architecture, archId);
			patch({
				id: sel.id,
				is_preset: false,
				name: sel.name.trim() || extractedName,
				config: {
					...sel.config,
					types,
					architecture_template: nextArch,
					architecture: keepCustom
						? form.architecture
						: ARCHITECTURE_TEMPLATES[nextArch].panes,
					...Object.fromEntries(EXTRACT_KEYS.filter((k) => c[k]).map((k) => [k, c[k]])),
				},
			});
			setXInfo(res);
			setMsg('');
		} catch (e) {
			if (isOrgBusyError(e)) {
				setOrgBusyOpen(true);
				setMsg('Included compute is busy. Retry in a moment.');
			} else {
				setMsg(e instanceof Error ? e.message : String(e));
			}
		}
		setXBusy(false);
	}

	const hasSuggestion = (field: string, value: string) =>
		String(form[field] || '').split(',').map((s) => s.trim().toLowerCase()).includes(value.toLowerCase());

	const addSuggestion = (field: string, value: string) => {
		const items = String(form[field] || '').split(',').map((s) => s.trim()).filter(Boolean);
		const i = items.findIndex((x) => x.toLowerCase() === value.toLowerCase());
		if (i >= 0) items.splice(i, 1); else items.push(value);
		set(field, items.join(', '));
	};

	async function runTest() {
		if (!client || !isConnected || !sel) {
			setTRes({ error: 'RocketRide is not connected yet.' });
			return;
		}
		const url = normalizeGithub(tUrl.trim());
		if (!url) { setTRes({ error: 'Paste a GitHub repository URL.' }); return; }
		setTBusy(true); setTRes(null);
		try {
			const current = draft || sel;
			const githubToken = await requireGithubToken(client as unknown as EnvClient);
			const res = await testTargetRepo(client as VerifyClient, url, {
				name: current.name || 'Target',
				config: scoringConfigForPlan({ types: ['code'], ...current.config }, settings.plan),
			}, githubToken, makeOrgLease('test'));
			setTRes(res);
		} catch (e) {
			if (isOrgBusyError(e)) {
				setOrgBusyOpen(true);
				setTRes({ error: 'Included compute is busy. Retry in a moment.' });
			} else {
				setTRes({ error: e instanceof Error ? e.message : String(e) });
			}
		}
		setTBusy(false);
	}

	const Field = ([key, label, hint, ph]: FieldDef) => (
		<div className="field tokens" key={key}>
			<label htmlFor={`t-${key}`}>{label}</label>
			{hint ? <div className="help" style={{ margin: '-2px 0 6px' }}>{hint}</div> : null}
			<input id={`t-${key}`} type="text" value={String(form[key] || '')} placeholder={ph} readOnly={readOnly}
				onChange={(e) => set(key, e.target.value)} />
		</div>
	);

	const suggestions = xInfo?.suggestions || {};
	const wv = (k: string, d: number) => {
		const v = parseFloat(String(weights[k] ?? ''));
		return Number.isFinite(v) ? v : d;
	};
	const tv = (k: string, d: number) => {
		const v = parseFloat(String(thresholds[k] ?? ''));
		return Number.isFinite(v) ? v : d;
	};

	return (
		<Page title="Targets">
			<p className="muted" style={{ margin: '-8px 0 18px', fontSize: 13.5 }}>
				Name the product teams are judged on. You describe how they use it;
				Judge Hack scores that against a fixed rubric. Custom targets live in this workspace.
			</p>
			<GithubTokenNotice action="Prefill and repository tests" />
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, maxWidth: 820 }}>
				{targets.map((t) => (
					<button key={t.id} type="button"
						className={`btn sm ${sel?.id === t.id && !draft ? '' : 'ghost'}`}
						onClick={() => pick(t)}>
						{t.name}{t.is_preset ? ' (preset)' : ''}
					</button>
				))}
				<button className="btn ghost sm" type="button" onClick={startNew}>New target</button>
				<button className="btn ghost sm" type="button" onClick={loadLaserdataExample}>Use LaserData example</button>
			</div>
			<div className="glass" style={{ padding: 22, maxWidth: 820 }}>
				{!readOnly && (
					<div className="altpath" style={{ marginTop: 0, marginBottom: 18 }}>
						<div style={{ flex: 1 }}>
							<b style={{ fontSize: 13.5 }}>Start from the product’s public surface</b>
							<div className="help" style={{ marginTop: 2 }}>
								Paste a GitHub repo, optional docs URL, package name, or files, then click
								Fill from sources. Filling never starts until you click — so you can complete every field first.
							</div>
							<div className="jh-extract-grid">
								<input className="xin" type="text" placeholder="https://github.com/vendor/product"
									value={xUrl}
									onChange={(e) => setXUrl(e.target.value)} />
								<input className="xin" type="text" placeholder="Docs URL (optional)"
									value={xDocs} onChange={(e) => setXDocs(e.target.value)} />
								<input className="xin" type="text" placeholder="Package name (optional)"
									value={xPkg} onChange={(e) => setXPkg(e.target.value)} />
								<div style={{ display: 'flex', gap: 8 }}>
									<label className="btn ghost sm" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
										{xFiles.length ? `${xFiles.length} file(s)` : 'Attach files'}
										<input type="file" multiple hidden
											accept=".json,.toml,.md,.txt,.yaml,.yml,.example,.sample,.py,.ts,.js,.env"
											onChange={(e) => {
												const files = e.target.files ? [...e.target.files] : [];
												setXFiles(files);
											}} />
									</label>
									<button className="btn sm" type="button" style={{ flex: 1 }}
										disabled={xBusy || !hasSource || !isConnected}
										onClick={() => { void prefill(); }}>
										{xBusy ? 'Filling…' : 'Fill from sources'}
									</button>
								</div>
							</div>
						</div>
					</div>
				)}
				{xInfo && (
					<div className="detailbox" style={{ fontSize: 12.5, marginBottom: 16 }}>
						<b>Filled from {xInfo.repo || 'provided sources'}</b>. Check the fields below, then save.
						{(suggestions.competitors || suggestions.neutral) && (
							<div style={{ marginTop: 8 }}>
								{suggestions.competitors && (
									<div>Suggested competitors (not verified — click to add):{' '}
										{suggestions.competitors.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (
											<button key={s} type="button"
												className={`techchip${hasSuggestion('competitors', s) ? ' target' : ''}`}
												style={{ cursor: 'pointer' }}
												onClick={() => addSuggestion('competitors', s)}>
												{hasSuggestion('competitors', s) ? 'Added · ' : ''}{s}
											</button>
										))}
									</div>
								)}
								{suggestions.neutral && (
									<div style={{ marginTop: 4 }}>Suggested complementary tools:{' '}
										{suggestions.neutral.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (
											<button key={s} type="button"
												className={`techchip${hasSuggestion('neutral', s) ? ' target' : ''}`}
												style={{ cursor: 'pointer' }}
												onClick={() => addSuggestion('neutral', s)}>
												{hasSuggestion('neutral', s) ? 'Added · ' : ''}{s}
											</button>
										))}
									</div>
								)}
							</div>
						)}
						{(xInfo.warnings || []).length > 0 && (
							<div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
								{(xInfo.warnings || []).map((w, i) => <div key={i}>{w}</div>)}
							</div>
						)}
					</div>
				)}
				<div className="field" style={{ maxWidth: 360 }}>
					<label htmlFor="t-name">What is this product called?</label>
					<input id="t-name" type="text" value={String(form.name || '')} placeholder="e.g. Butterbase" readOnly={readOnly}
						onChange={(e) => set('name', e.target.value)} />
				</div>
				<div className="field" style={{ marginBottom: 10 }}>
					<label>How do teams use this product?</label>
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
						{TYPES.map(([k, l]) => {
							const on = selectedTypes().includes(k);
							return (
								<button
									key={k}
									type="button"
									aria-pressed={on}
									className={`typepill${on ? ' on' : ''}`}
									onClick={() => toggleType(k)}
								>
									{l}
								</button>
							);
						})}
					</div>
					<div className="help">Pick every way that is true. This chooses which checks we run, and suggests the backbone labels.</div>
				</div>
				<div className="detailbox" style={{ fontSize: 13, marginBottom: 12 }}>
					{readOnly
						? <>The RocketRide preset uses the pipeline rubric: committed .pipe files, agent/LLM nodes, and whether those pipelines are actually called. Data or gateway products (LaserData, Butterbase, Supabase) need a custom target.</>
						: <>Scoring for <b>{String(form.name || 'this product')}</b> uses the same eight signals.
							You set what to look for. Company and Organizers can also change how many points
							each signal is worth for this target.</>}
				</div>
				{!readOnly && (
					<div className="field" style={{ marginBottom: 12 }}>
						<label>What architecture do judges see?</label>
						<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
							{(Object.keys(ARCHITECTURE_TEMPLATES) as Array<keyof typeof ARCHITECTURE_TEMPLATES>).map((id) => (
								<button
									key={id}
									type="button"
									aria-pressed={archId === id}
									className={`typepill${archId === id ? ' on' : ''}`}
									onClick={() => setArchitectureTemplate(id)}
								>
									{ARCHITECTURE_TEMPLATES[id].label}
								</button>
							))}
						</div>
						<div className="help">{ARCHITECTURE_TEMPLATES[archId].hint}</div>
						<div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
							{ARCHITECTURE_TEMPLATES[archId].panes.map((p) => p.label).join(' · ')}
						</div>
					</div>
				)}
				<div className="tabs">
					<button type="button" className={`tabbtn ${tab === 'code' ? 'cur' : ''}`} onClick={() => setTab('code')}>In their code</button>
					<button type="button" className={`tabbtn ${tab === 'hosted' ? 'cur' : ''}`} onClick={() => setTab('hosted')}>If they hosted on you</button>
					<button type="button" className={`tabbtn ${tab === 'score' ? 'cur' : ''}`} onClick={() => setTab('score')}>How we score</button>
				</div>
				{tab === 'code' && (
					<div>
						{CODE_FIELDS.map(Field)}
						<div className="inline">{OTHER_FIELDS.map(Field)}</div>
					</div>
				)}
				{tab === 'hosted' && (
					<div>
						<p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
							Fill this when usage may show up as a live deployment, not only as imports.
						</p>
						{PLATFORM_FIELDS.map(Field)}
					</div>
				)}
				{tab === 'score' && (
					<div>
						{readOnly ? (
							<div className="detailbox" style={{ fontSize: 13 }}>
								The RocketRide preset uses a fixed pipeline rubric (committed .pipe files,
								agent/LLM nodes, and whether those pipelines are invoked). Save a custom target
								to judge an SDK, data platform, API, or host — and, on Company or Organizers,
								to set the point scale for that product.
							</div>
						) : (
							<>
								<p className="muted" style={{ fontSize: 13, margin: '2px 0 12px' }}>
									{canTuneScore
										? 'This target starts on the team default scale. Change points and tag cut-offs to match how you want this event judged.'
										: 'This is the default scale for every custom target. Company and Organizers can raise or lower it per product — for example, reward a live deploy more than an import.'}
								</p>
								{canTuneScore && (
									<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px' }}>
										<span className="section-kicker" style={{ margin: 0 }}>Judging strictness</span>
										{Object.entries(STRICTNESS).map(([key, p]) => {
											const active = SCORE_THRESHOLDS.every(([k, , dflt]) =>
												Number(thresholds[k] ?? dflt) === p.thresholds[k]);
											return (
												<button key={key} type="button" className={`btn sm ${active ? '' : 'ghost'}`}
													onClick={() => set('thresholds', { ...p.thresholds })}>
													{p.label}
												</button>
											);
										})}
										<button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }}
											title="Restore team default points and cut-offs"
											onClick={() => {
												if (!sel) return;
												const { weights: _w, thresholds: _t, ...rest } = sel.config;
												patch({ ...sel, is_preset: false, config: rest });
											}}>
											Reset to defaults
										</button>
									</div>
								)}
								{SCORE_SIGNALS.map(([k, label, dflt, desc]) => {
									const val = weights[k] ?? dflt;
									const changed = Number(val) !== dflt;
									return (
										<div className="rrow" key={k}>
											<div className="rl">
												<b>{label}</b>
												<div className="rd">{desc}</div>
											</div>
											{canTuneScore && changed && (
												<button className="rrev" type="button" title={`Back to default (${dflt})`}
													onClick={() => set('weights', { ...weights, [k]: dflt })}>↺</button>
											)}
											{canTuneScore ? (
												<>
													<input className="rnum" type="number" min={0} step={0.5} value={val}
														onChange={(e) => set('weights', { ...weights, [k]: e.target.value })} />
													<span className="rpts">pts</span>
												</>
											) : (
												<span className="rpts">{dflt} pts</span>
											)}
										</div>
									);
								})}
								{canTuneScore && (
									<>
										<div className="section-kicker" style={{ margin: '14px 0 2px' }}>Tag cut-offs
											<span className="muted" style={{ fontWeight: 600 }}> (score needed)</span></div>
										<div className="rthres">
											{SCORE_THRESHOLDS.map(([k, label, dflt]) => {
												const val = thresholds[k] ?? dflt;
												const changed = Number(val) !== dflt;
												return (
													<span className="titem" key={k}>
														<TagPill tag={label} />
														<span className="rpts" style={{ minWidth: 'auto' }}>≥</span>
														<input className="rnum" type="number" min={0} step={0.5} value={val}
															onChange={(e) => set('thresholds', { ...thresholds, [k]: e.target.value })} />
														{changed && (
															<button className="rrev" type="button" title={`Back to default (${dflt})`}
																onClick={() => set('thresholds', { ...thresholds, [k]: dflt })}>↺</button>
														)}
													</span>
												);
											})}
										</div>
										{(() => {
											const typical = wv('dependency', 1) + wv('invocation', 1.5) + wv('api_usage', 1.5) + wv('hosted', 0.5);
											const sig = tv('significant', 4); const mod = tv('moderate', 2); const less = tv('less', 1);
											const tag = typical >= sig ? 'Significant' : typical >= mod ? 'Moderate' : typical >= less ? 'Less' : 'None';
											return (
												<div className="livecall" style={{ marginTop: 8 }}>
													<div style={{ fontSize: 13 }}>
														A typical genuine project (package + call-sites + API + env) scores{' '}
														<b className="scorecell">{typical.toFixed(1)}</b>
														{' → '}<TagPill tag={tag} />
														{tag === 'None' || tag === 'Less'
															? ' — that bar is likely too high for real projects to clear.' : ''}
													</div>
												</div>
											);
										})()}
									</>
								)}
								{!canTuneScore && (
									<p className="help" style={{ marginTop: 12 }}>
										<button className="linkish" type="button" onClick={() => setLockOpen(true)}>
											Unlock custom scoring on Company or Organizers
										</button>
									</p>
								)}
							</>
						)}
					</div>
				)}
				<div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
					{msg && <span className={/live for new runs/.test(msg) ? undefined : 'flagcell'}
						style={{ fontSize: 13, ...(/live for new runs/.test(msg) ? { color: 'var(--jh-green-strong)', fontWeight: 700 } : {}) }}>{msg}</span>}
					<span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
						{!readOnly && sel && targets.some((t) => t.id === sel.id && !t.is_preset) && (
							<button className="btn ghost sm" type="button" onClick={() => { deleteTarget(sel.id); setSelId(ROCKETRIDE_PRESET.id); setDraft(null); }}>Delete</button>
						)}
						{!readOnly && <button className="btn sm" type="button" onClick={save}>
							{targets.some((t) => t.id === sel?.id && !t.is_preset) ? 'Save target' : 'Create target'}
						</button>}
					</span>
				</div>
				{!readOnly && (
					<div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--jh-bd-subtle)' }}>
						<div className="section-kicker">Test on a sample repo</div>
						<div className="help" style={{ marginTop: 0, marginBottom: 8 }}>
							Paste a repo you know used this product. If the checks fire, the definition works.
							Reads the repository through the GitHub API with your token — nothing is cloned.
						</div>
						<div style={{ display: 'flex', gap: 8 }}>
							<input className="xin" style={{ flex: 1 }} type="text"
								placeholder="https://github.com/known-consumer/project"
								value={tUrl} onChange={(e) => setTUrl(e.target.value)} />
							<button className="btn ghost sm" type="button"
								disabled={tBusy || !tUrl.includes('github.com') || !isConnected}
								onClick={() => { void runTest(); }}>{tBusy ? 'Testing…' : 'Test'}</button>
						</div>
						{tRes && (
							<div className="detailbox" style={{ marginTop: 10, fontSize: 13 }}>
								{tRes.error ? <span className="flagcell">{tRes.error}</span> : (
									tRes.classify_failed || tRes.repo_accessible === false ? (
										<>
											<span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
												<TagPill tag={tRes.tag} failed />
												<span className="techchip target" style={{ margin: 0 }}>Ran on RocketRide</span>
											</span>
											<div className="flagcell" style={{ marginTop: 8, whiteSpace: 'normal' }}>
												{String(tRes.reason || tRes.notes || 'Verification did not finish — no verdict.')}
											</div>
										</>
									) : (
									<>
										<span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
											<TagPill tag={tRes.tag} />
											<b className="scorecell">{Number(tRes.score ?? 0).toFixed(1)}</b>
											<span className="muted">backbone {tRes.backbone}</span>
											<span className="techchip target" style={{ margin: 0 }}>Ran on RocketRide</span>
										</span>
										<div style={{ marginTop: 8 }}>
											{(tRes.breakdown || []).length === 0
												? <span className="flagcell">No signals fired — this definition does not
													detect that repo. Check package names and how code calls the product.</span>
												: (tRes.breakdown || []).map((b, i) => (
													<span key={i} className={`bdchip ${b.points < 0 ? 'neg' : 'pos'}`}>
														{b.points > 0 ? '+' : ''}{b.points} {b.signal}</span>
												))}
										</div>
									</>
									)
								)}
							</div>
						)}
					</div>
				)}
				<p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
					{readOnly
						? 'The RocketRide preset is read-only. It mirrors the engine’s pipeline-scoring path.'
						: 'Saved in this workspace. Picking this target on a run checks package names, call-sites, API usage, artifacts, and deploy domains against it. Company and Organizers scoring changes apply to this target only.'}
				</p>
			</div>
			<TierLockModal open={lockOpen} onClose={() => setLockOpen(false)} title="Custom scoring is a Company and Organizers feature">
				<p>Developer uses the team default scale so a first target is just “what is this product.”
					<b> Company</b> and <b>Organizers</b> can change point values and Significant / Moderate / Less
					cut-offs per target — for example, a deploy-first sponsor vs an SDK-first library.</p>
			</TierLockModal>
			<OrgBusyModal open={orgBusyOpen} onClose={() => setOrgBusyOpen(false)} />
		</Page>
	);
}
