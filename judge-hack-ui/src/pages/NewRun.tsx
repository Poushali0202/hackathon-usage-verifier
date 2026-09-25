import React, { useEffect, useRef, useState } from 'react';
import { usePrefs } from 'shell';
import { GithubTokenNotice, LiveHint, Page, AllowanceModal, OrgBusyModal, TierLockModal } from '../components/bits';
import ResultsGrid from '../components/ResultsGrid';
import { isCompanyPlan } from '../billing';
import { BILLING_LIVE } from '../entitlement';
import { estimateAllowance, targetRubricHelp } from '../format';
import { useNav } from '../NavContext';
import { resolveTargetId, useRuns } from '../RunsContext';
import { isOrgBusyReason } from '../verify/leases';
import { submissionsFromFile } from '../verify/sheet';
import type { Submission } from '../types';

const STEPS = ['Event', 'Target', 'Submissions'];

function Stepper({ step }: { step: number }) {
	return (
		<div className="steps">
			{STEPS.map((s, i) => (
				<span key={s} style={{ display: 'contents' }}>
					{i > 0 && <span className="bar" />}
					<span className={`step ${i === step ? 'cur' : ''}`}>
						<span className="dotn">{i + 1}</span> {s}
					</span>
				</span>
			))}
		</div>
	);
}

export default function NewRun() {
	const { settings, startBatch, stop, getRun, targets } = useRuns();
	const { getPref } = usePrefs();
	const { go } = useNav();
	const isCompany = isCompanyPlan(settings.plan);
	const [step, setStep] = useState(0);
	const [name, setName] = useState('');
	const [eventDate, setEventDate] = useState('');
	const [penalty, setPenalty] = useState(settings.history_penalty);
	const [targetId, setTargetId] = useState(() => resolveTargetId(targets, String(getPref('hj.targetId') || '')));
	const [file, setFile] = useState<File | null>(null);
	const [rows, setRows] = useState<Submission[]>([]);
	const [drag, setDrag] = useState(false);
	const [parseErr, setParseErr] = useState('');
	const [runId, setRunId] = useState<string | null>(null);
	const [lockOpen, setLockOpen] = useState(false);
	const [capOpen, setCapOpen] = useState(false);
	const [orgBusyOpen, setOrgBusyOpen] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setTargetId((cur) => resolveTargetId(targets, cur || String(getPref('hj.targetId') || '')));
	}, [getPref, targets]);

	const run = runId ? getRun(runId) : undefined;
	const allowance = BILLING_LIVE ? estimateAllowance(rows.length, settings.plan, settings.meter_kb_used) : null;
	const capKey = allowance
		? `${allowance.blocked ? 'block' : 'trunc'}:${rows.length}:${allowance.est_verified_rows}:${settings.meter_kb_used}`
		: '';
	const canRun = !!(eventDate && rows.length > 0 && run?.status !== 'running' && !allowance?.blocked);

	useEffect(() => {
		if (step !== 2 || runId || !capKey) return;
		setCapOpen(true);
	}, [step, runId, capKey]);

	useEffect(() => {
		if (run?.status === 'error' && isOrgBusyReason(run.error)) setOrgBusyOpen(true);
	}, [run?.status, run?.error]);

	function actuallyStart() {
		try {
			const id = startBatch({
				name: name || `Run ${new Date().toLocaleDateString()}`,
				eventDate,
				historyPenalty: Number(penalty),
				repos: rows,
				targetId,
			});
			setRunId(id);
		} catch (e) {
			setParseErr(e instanceof Error ? e.message : String(e));
		}
	}

	function start() {
		if (allowance) {
			setCapOpen(true);
			return;
		}
		actuallyStart();
	}

	async function onFile(f: File | null) {
		setFile(f);
		setParseErr('');
		setRows([]);
		if (!f) return;
		try {
			setRows(await submissionsFromFile(f));
		} catch (e) {
			setParseErr(e instanceof Error ? e.message : String(e));
		}
	}

	if (run) {
		const pct = run.total ? Math.round((run.results.length / run.total) * 100) : 0;
		return (
			<Page title={run.name} wide
				headRight={<span className={`pill ${run.status === 'done' ? 'done' : run.status === 'running' ? 'running' : 'draft'}`}>{run.status}</span>}>
				{run.status === 'running' && (
					<div style={{ display: 'flex', alignItems: 'center', gap: 14, maxWidth: 680, marginBottom: 16 }}>
						<div style={{ flex: 1 }}>
							<div className="runbar"><i style={{ width: `${pct}%` }} /></div>
							<div className="stageline">verifying… {run.stage || ''}</div>
						</div>
						<button className="btn ghost sm" type="button" onClick={stop}>Stop run</button>
					</div>
				)}
				{run.status === 'stopped' && (
					<p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
						Run stopped — {run.results.length}{run.total ? ` of ${run.total}` : ''} verified before the
						stop; results below are kept.
					</p>
				)}
				{run.status === 'error' && <div className="dqline">Run failed: {run.error}</div>}
				<ResultsGrid results={run.results} total={run.total} summary={run.summary}
					exportName={`${run.name.replace(/\s+/g, '_')}.xlsx`} />
				{run.status !== 'running' && (
					<div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
						<button className="btn ghost sm" type="button" onClick={() => go('rundetail', run.id)}>Open run page</button>
						<button className="btn sm" type="button" onClick={() => { setRunId(null); setStep(0); setFile(null); setRows([]); }}>New run</button>
					</div>
				)}
			</Page>
		);
	}

	return (
		<Page title="New run" narrow>
			<Stepper step={step} />
			<GithubTokenNotice />
			<div className="glass" style={{ padding: 24 }}>
				{step === 0 && (
					<>
						<div className="field">
							<label>Event name</label>
							<input type="text" placeholder="e.g. Frontier SF Hackathon" value={name}
								onChange={(e) => setName(e.target.value)} />
						</div>
						<div className="inline">
							<div className="field">
								<label>Event date (required)</label>
								<input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
								<div className="help">Commit-history checks measure against this date ± {settings.grace_days} grace days.</div>
							</div>
							<div className="field">
								<label>Pre-event work penalty (pts){!isCompany ? ' · Company plan' : ''}</label>
								<input type="number" min={0} step={0.5} value={penalty} disabled={!isCompany}
									onChange={(e) => setPenalty(Number(e.target.value))} />
								<div className="help">{isCompany
									? "Deducted when a project's history predates the event window. 0 = flag only."
									: 'The Company plan controls how hard pre-event work is penalized.'}</div>
							</div>
						</div>
						<div className="lockcard">
							<h3>Company — Git freshness &amp; integrity checks</h3>
							<p>Flag projects built before your event, detect commit-date rewrites, and set the
								penalty judges apply. {isCompany ? <b>Enabled on your plan.</b> : <b>Locked on Developer.</b>}</p>
							<button className="btn gold sm" type="button" onClick={() => setLockOpen(true)}>
								{isCompany ? 'About Company →' : 'Unlock with Company →'}
							</button>
						</div>
					</>
				)}
				{step === 1 && (
					<div className="field">
						<label>Target</label>
						<select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
							{targets.map((t) => (
								<option key={t.id} value={t.id}>{t.name}{t.is_preset ? ' (preset)' : ''}</option>
							))}
						</select>
						<div className="help">{targetRubricHelp(targets.find((t) => t.id === targetId))}</div>
					</div>
				)}
				{step === 2 && (
					<>
						<div className="field">
							<label>Submissions sheet (CSV / XLSX)</label>
							<div className={`dropzone ${drag ? 'drag' : ''}`}
								onClick={() => fileInput.current?.click()}
								onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
								onDragLeave={() => setDrag(false)}
								onDrop={(e) => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files[0] || null); }}>
								<b>Drop your submissions sheet here</b> or click to browse.<br />
								<span style={{ fontSize: 12.5 }}>Odd column layouts are fine — the sheet brain maps them.</span>
								{file && <div><span className="filechip">{file.name}{rows.length ? ` · ${rows.length} repos` : ''}</span></div>}
							</div>
							<input ref={fileInput} type="file" accept=".csv,.xlsx,.xls,text/csv" hidden
								onChange={(e) => void onFile(e.target.files?.[0] || null)} />
							{parseErr && <div className="dqline">{parseErr}</div>}
							<div className="altpath">
								<span><b>No sheet?</b> Verify a repo or a few directly, no event setup needed.</span>
								<button className="btn ghost sm" type="button" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
									onClick={() => go('verify')}>Open Quick verify →</button>
							</div>
						</div>
						<LiveHint />
					</>
				)}
				<div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
					{step > 0 && <button className="btn ghost sm" type="button" onClick={() => setStep(step - 1)}>← Back</button>}
					{step < 2 && <button className="btn sm" type="button" disabled={step === 0 && !eventDate}
						onClick={() => setStep(step + 1)}>Continue →</button>}
					{step === 2 && <button className="btn sm" type="button" disabled={!canRun} onClick={start}>
						{allowance?.blocked ? 'Allowance empty' : 'Run verification'}
					</button>}
				</div>
				{step === 0 && !eventDate && <p className="help" style={{ textAlign: 'right' }}>Pick the event date to continue.</p>}
			</div>
			<AllowanceModal
				open={capOpen && step === 2 && !runId}
				a={allowance}
				onClose={() => setCapOpen(false)}
				onContinue={actuallyStart}
			/>
			<OrgBusyModal open={orgBusyOpen} onClose={() => setOrgBusyOpen(false)} />
			<TierLockModal open={lockOpen} onClose={() => setLockOpen(false)} title="Git freshness & integrity is a Company feature">
				<p>Pro verifies every project was built at your event: earliest-commit checks against the
					event window, commit-date tamper detection, and a judge-set penalty. It&apos;s enabled in this
					preview so you can evaluate it.</p>
			</TierLockModal>
		</Page>
	);
}
