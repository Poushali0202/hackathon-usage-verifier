import React, { useEffect, useState } from 'react';
import { usePrefs } from 'shell';
import { Page, AllowanceModal, GithubTokenNotice, OrgBusyModal } from '../components/bits';
import ResultsGrid from '../components/ResultsGrid';
import { isCompanyPlan } from '../billing';
import { BILLING_LIVE } from '../entitlement';
import { estimateAllowance, targetRubricHelp } from '../format';
import { useNav } from '../NavContext';
import { resolveTargetId, useRuns } from '../RunsContext';
import { urlsFromText } from '../verify/sheet';
import { isOrgBusyReason } from '../verify/leases';

export default function QuickVerify() {
	const { settings, startBatch, runs, targets } = useRuns();
	const { getPref } = usePrefs();
	const { go } = useNav();
	const [urls, setUrls] = useState('');
	const [eventDate, setEventDate] = useState('');
	const [penalty, setPenalty] = useState(settings.history_penalty);
	const [targetId, setTargetId] = useState(() => resolveTargetId(targets, String(getPref('hj.targetId') || '')));
	const [error, setError] = useState('');
	const [activeId, setActiveId] = useState<string | null>(null);
	const [capOpen, setCapOpen] = useState(false);
	const [orgBusyOpen, setOrgBusyOpen] = useState(false);

	useEffect(() => {
		setTargetId((cur) => resolveTargetId(targets, cur || String(getPref('hj.targetId') || '')));
	}, [getPref, targets]);

	const repos = urlsFromText(urls);
	const run = runs.find((r) => r.id === activeId);
	const allowance = BILLING_LIVE ? estimateAllowance(repos.length, settings.plan, settings.meter_kb_used) : null;
	const capKey = allowance
		? `${allowance.blocked ? 'block' : 'trunc'}:${repos.length}:${allowance.est_verified_rows}:${settings.meter_kb_used}`
		: '';
	const valid = repos.length > 0 && !!eventDate && run?.status !== 'running' && !allowance?.blocked;
	const isCompany = isCompanyPlan(settings.plan);

	useEffect(() => {
		if (!capKey || run?.status === 'running') return;
		setCapOpen(true);
	}, [capKey, run?.status]);

	useEffect(() => {
		if (run?.status === 'error' && isOrgBusyReason(run.error)) setOrgBusyOpen(true);
	}, [run?.status, run?.error]);

	function actuallyVerify() {
		setError('');
		const repoName = repos[0].split('/').slice(-1)[0] || 'repo';
		const runName = repos.length === 1 ? `Quick verify — ${repoName}` : `Quick verify — ${repos.length} repos`;
		try {
			const id = startBatch({
				name: runName,
				eventDate,
				historyPenalty: Number(penalty),
				repos: repos.map((github) => ({ project: '', github })),
				targetId,
			});
			setActiveId(id);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	function verify() {
		if (allowance) {
			setCapOpen(true);
			return;
		}
		actuallyVerify();
	}

	return (
		<Page title="Quick verify" narrow>
			<p className="muted" style={{ margin: '-8px 0 18px', fontSize: 13 }}>
				Spot-check a repository (or a few) and get the full evidence dossier for each.
				Judging a whole event? Use <button className="linkish" type="button" onClick={() => go('newrun')}>New run</button> with your
				submissions sheet.
			</p>
			<GithubTokenNotice action="Verifications" />
			<div className="glass" style={{ padding: 24 }}>
				<div className="field">
					<label>GitHub repository URL(s) <span className="muted">(one per line)</span></label>
					<textarea rows={3} placeholder={'https://github.com/team/project\nhttps://github.com/...'}
						value={urls} onChange={(e) => setUrls(e.target.value)} />
					{repos.length > 1 && <div className="help">{repos.length} repositories detected.</div>}
				</div>
				<div className="inline">
					<div className="field">
						<label>Target</label>
						<select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
							{targets.map((t) => (
								<option key={t.id} value={t.id}>{t.name}{t.is_preset ? ' (preset)' : ''}</option>
							))}
						</select>
						<div className="help" style={{ marginTop: 6 }}>{targetRubricHelp(targets.find((t) => t.id === targetId))}</div>
					</div>
					<div className="field">
						<label>Event date (required)</label>
						<input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
					</div>
					<div className="field">
						<label>Pre-event penalty (pts){!isCompany ? ' · Company plan' : ''}</label>
						<input type="number" min={0} step={0.5} value={penalty} disabled={!isCompany}
							onChange={(e) => setPenalty(Number(e.target.value))} />
					</div>
				</div>
				<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
					<button className="btn" type="button" disabled={!valid} onClick={verify}>
						{run?.status === 'running' ? 'Verifying…'
							: allowance?.blocked ? 'Allowance empty'
							: repos.length > 1 ? `Verify ${repos.length} repositories` : 'Verify repository'}
					</button>
					{run?.status === 'running' && (
						<span className="stageline" style={{ flex: 1 }}>{run.stage}</span>
					)}
				</div>
			</div>
			{error && <div className="dqline" style={{ marginTop: 16 }}>Verification failed: {error}</div>}
			{run?.status === 'error' && <div className="dqline" style={{ marginTop: 16 }}>Verification failed: {run.error}</div>}
			{!!run?.results?.length && (
				<div style={{ marginTop: 18 }}>
					<ResultsGrid results={run.results} total={run.total} summary={run.summary}
						exportName="quick-verify.xlsx" />
					<p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
						Saved to <button className="linkish" type="button" onClick={() => go('runs')}>Runs</button> like any verification, so the dossier stays on record.
					</p>
				</div>
			)}
			<AllowanceModal
				open={capOpen && run?.status !== 'running'}
				a={allowance}
				onClose={() => setCapOpen(false)}
				onContinue={eventDate ? actuallyVerify : undefined}
			/>
			<OrgBusyModal open={orgBusyOpen} onClose={() => setOrgBusyOpen(false)} />
		</Page>
	);
}
