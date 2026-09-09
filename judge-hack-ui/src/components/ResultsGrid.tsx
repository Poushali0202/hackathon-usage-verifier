import React, { useState } from 'react';
import { TagPill } from './bits';
import Tower from './Tower';
import { isCompanyPlan } from '../billing';
import { genericScoreMath, isFlagged, scoringSummary, usesPipelineRubric } from '../format';
import { useNav } from '../NavContext';
import { useRuns } from '../RunsContext';
import type { VerifyResult } from '../types';
import { fallbackProse } from '../verify/explain';
import { exportResultsExcel } from '../verify/sheet';

const tampered = (r: VerifyResult) => (r.history_tampered?.length || 0) > 0;
const ext = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const teamNames = (names?: string) =>
	String(names || '').split(/[,;&/]|\band\b/i).map((s) => s.trim()).filter((s) => s.length > 1);

function windowLabel(w: VerifyResult['event_window']): string {
	if (!w) return '';
	if (Array.isArray(w)) return `${w[0]} → ${w[1]}`;
	return `${w.start || ''} → ${w.end || ''}`;
}

function reusedNames(r: VerifyResult): string[] {
	return (r.reused_pipelines || []).map((p) => (typeof p === 'string' ? p : (p?.name || ''))).filter(Boolean);
}

/** Always-visible judge summary — stored M3 rows had notes below a clipped scroller and often empty. */
function dossierSummary(r: VerifyResult): string {
	const existing = String(r.notes || r.justification || '').trim();
	if (existing && existing !== String(r.reason || '')) return existing;
	if (r.classify_failed || r.repo_accessible === false) {
		return String(r.reason || r.notes || 'This repository could not be verified.');
	}
	if (r.tag == null && r.score == null) return existing;
	return scoringSummary(r);
}

function BuiltOn({ r, company }: { r: VerifyResult; company: boolean }) {
	const { go } = useNav();
	if (r.classify_failed || r.repo_accessible === false) return <span className="muted">-</span>;
	if (!r.event_window) return <span className="muted">-</span>;
	if (!company) {
		return (
			<button className="linkish" type="button" style={{ fontSize: 12 }}
				onClick={(e) => { e.stopPropagation(); go('pricing', undefined, 'company'); }}>
				Upgrade
			</button>
		);
	}
	const bits: string[] = [];
	if (r.earliest_commit) bits.push(String(r.earliest_commit).slice(0, 10));
	if (r.project_predates) bits.push('pre-event');
	if (tampered(r)) bits.push('tampered');
	if (reusedNames(r).length) bits.push(`${reusedNames(r).length} reused`);
	if (!bits.length) return <span className="muted">in window</span>;
	return <span className={isFlagged(r) ? 'flagcell' : undefined}>{bits.join(' · ')}</span>;
}

function Detail({ r, company }: { r: VerifyResult; company: boolean }) {
	const team = teamNames(r.names);
	const win = windowLabel(r.event_window);
	const reused = reusedNames(r);
	const summary = dossierSummary(r);
	const { go } = useNav();
	const failed = !!(r.classify_failed || r.repo_accessible === false);
	const pipelineRubric = usesPipelineRubric(r);
	const derived = failed ? { description: '', rocketride_usage: '' } : fallbackProse(r);
	const what = r.description || derived.description || '—';
	const how = r.rocketride_usage || derived.rocketride_usage || '—';
	return (
		<td colSpan={6} style={{ padding: '10px 16px 18px' }}>
			<div className="detailscroll">
				<div className="jh-detail-head">
					<div style={{ flex: 1, minWidth: 0 }}>
						<h2 style={{ margin: 0, fontSize: 21, letterSpacing: '-.3px' }}>{r.project || r.github}</h2>
						{team.length > 0 && <div className="muted" style={{ fontSize: 13 }}>by {team.join(', ')}</div>}
					</div>
					<span className="jh-detail-meta">
						<TagPill tag={r.tag} failed={r.classify_failed || r.repo_accessible === false} />
						{r.score != null && <span className="scorecell" style={{ fontSize: 15 }}>{Number(r.score).toFixed(1)}</span>}
					</span>
				</div>
				<div className="linksrow">
					{r.deployed && <a className="btn sm" href={ext(r.deployed)} target="_blank" rel="noreferrer">Live demo</a>}
					{r.github && <a className="btn ghost sm" href={r.github} target="_blank" rel="noreferrer">Source code</a>}
					{r.demo && <a className="btn ghost sm" href={ext(r.demo)} target="_blank" rel="noreferrer">Demo video</a>}
					{!r.deployed && !r.demo && r.github && <span className="techchip" style={{ alignSelf: 'center' }}>not deployed</span>}
				</div>

				{!company && !!r.event_window && (
					<div className="lockcard" style={{ margin: '6px 0 10px' }}>
						<h3>Company — Commit-history integrity</h3>
						<p style={{ margin: 0 }}>Built-on dates, pre-event flags and tamper detection for this
							project are available on the Company plan.{' '}
							<button className="linkish" type="button" onClick={() => go('pricing', undefined, 'company')}>Upgrade →</button></p>
					</div>
				)}
				{company && (r.project_predates || tampered(r)) && (
					<div className="dqline">
						<b>Flagged</b>{' '}
						{!!r.project_predates && <>— work goes back to <b>{String(r.earliest_commit || '').slice(0, 10)}</b>, before the event window {win ? `(${win})` : ''}. </>}
						{tampered(r) && <>— commit-date rewriting detected: {(r.history_tampered || []).slice(0, 3).map((t) =>
							`${String(t.sha).slice(0, 7)} authored ${String(t.author).slice(0, 10)} but re-stamped ${String(t.committer).slice(0, 10)}`).join('; ')}. </>}
						Judge-set penalty applied: <b>−{r.history_penalty ?? 2}</b> pts.
					</div>
				)}
				{company && reused.length > 0 && (
					<div className="dqline" style={{ borderColor: 'rgba(245,158,11,.5)', background: '#FFF6E3' }}>
						Pipelines predating the event window: {reused.join(', ')} (−1 reuse)
					</div>
				)}
				{!!summary && (
					<div className="detailbox" style={{ color: isFlagged(r) ? 'var(--jh-red, #F93822)' : undefined }}>
						<b>Summary:</b> {summary}
					</div>
				)}
				{!failed && (
					<div className="muted" style={{ fontSize: 12.5, margin: '4px 0 8px' }}>
						{pipelineRubric
							? 'Judged with the RocketRide pipeline rubric (.pipe files, agent/LLM nodes). The five-layer backbone read uses RocketRide RAG labels.'
							: `Judged with the ${r.target_name || 'target'} SDK & platform rubric. The five-layer backbone read is the same stack; only the labels change for this product.`}
					</div>
				)}
				{r.explain_failed && !failed && (
					<div className="muted" style={{ fontSize: 12.5, margin: '6px 0 10px' }}>
						Model explanation unavailable{r.explain_error ? ` (${r.explain_error})` : ''}.
						The paragraphs below are taken from the evidence table; the verdict is unchanged.
					</div>
				)}
				{!failed && (
					<>
						<div className="detailbox"><b>What it is:</b> {what}</div>
						<div className="detailbox"><b>How {r.target_name || 'the target'} is used:</b> {how}</div>
					</>
				)}
				{!!r.breakdown?.length && (
					<div style={{ margin: '8px 0 10px' }}>
						<div className="section-kicker" style={{ marginBottom: 6 }}>Score breakdown</div>
						{r.breakdown
							.filter((b) => company || !/FLAGGED|predates/i.test(String(b.signal)))
							.map((b, idx) => (
								<span key={idx} className={`bdchip ${b.points < 0 ? 'neg' : 'pos'}`}>
									{b.points > 0 ? '+' : ''}{b.points} {b.signal}
								</span>
							))}
						{!pipelineRubric && (r.architecture || []).filter((p) => p.state !== 'target' && p.state !== 'other').map((p) => (
							<span key={p.id} className="bdchip zero">0 {p.label}</span>
						))}
						{!pipelineRubric && (
							<div className="muted" style={{ fontSize: 12, marginTop: 6, maxWidth: 720 }}>
								{genericScoreMath(r)}
							</div>
						)}
					</div>
				)}
				{r.justification && r.justification !== r.notes && !( !pipelineRubric && r.explain_failed) && (
					<div className="detailbox"><b>Verdict rationale:</b> {r.justification}</div>
				)}
				{(!!r.platform?.domains?.length || !!r.platform?.files?.length || !!r.platform?.markers?.length) && (
					<div className="detailbox">
						<b>Platform evidence:</b>
						{!!r.platform?.domains?.length && `\nDeployed on: ${r.platform.domains.join(', ')}`}
						{!!r.platform?.files?.length && `\nArtifacts: ${r.platform.files.slice(0, 3).join(', ')}`}
						{!!r.platform?.markers?.length && `\nAccount/env markers: ${r.platform.markers.slice(0, 4).join(', ')}`}
					</div>
				)}
				{(pipelineRubric ? r.layers : r.architecture?.length) ? (
					<Tower
						layers={pipelineRubric ? r.layers : undefined}
						architecture={pipelineRubric ? undefined : r.architecture}
						backbone={r.backbone}
						label={r.target_name || 'RocketRide'}
					/>
				) : null}
				{pipelineRubric && !!r.pipelines?.length && (
					<div style={{ margin: '10px 0 4px' }}>
						<div className="section-kicker" style={{ marginBottom: 6 }}>Deterministic evaluation — ground truth</div>
						<div className="detailbox" style={{ padding: 0, overflowX: 'auto', whiteSpace: 'normal' }}>
							<table className="list" style={{ fontSize: 12.5 }}>
								<thead><tr><th>Pipeline</th><th>Nodes</th><th>Complexity</th><th>Called?</th><th>Built on</th><th>Call sites (proof)</th></tr></thead>
								<tbody>
									{r.pipelines.map((p) => (
										<tr key={p.name}>
											<td className="mono">{p.name}</td>
											<td>{p.nodes}</td>
											<td>{p.complexity}</td>
											<td style={{ color: p.called ? 'var(--jh-green-strong, #177A3E)' : 'var(--jh-muted)', fontWeight: 700 }}>
												{p.called ? 'called' : 'not called'}
											</td>
											<td>{company ? (p.first_commit ? String(p.first_commit).slice(0, 10) : '-') : '—'}</td>
											<td className="mono" style={{ fontSize: 11, whiteSpace: 'pre-line' }}>
												{(p.call_sites || []).slice(0, 3).map((s) => `${s.file}:${s.line}`).join('\n') || '-'}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				)}
				{!!r.evidence?.length && <div className="detailbox"><b>Ground truth:</b>{'\n'}{r.evidence.join('\n')}</div>}

				{(team.length > 0 || !!r.other_platforms?.length || r.target_name) && (
					<div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--jh-bd-subtle)' }}>
						{team.length > 0 && (
							<div style={{ marginBottom: 10 }}>
								<div className="section-kicker" style={{ marginBottom: 6 }}>Team</div>
								{team.map((n) => (
									<span key={n} className="teamchip"><span className="tinit">{n[0].toUpperCase()}</span> {n}</span>
								))}
							</div>
						)}
						{(r.tag && r.tag !== 'None') || r.tech?.length || r.other_platforms?.length ? (
							<div>
								<div className="section-kicker" style={{ marginBottom: 6 }}>
									Built with <span className="muted" style={{ fontWeight: 600 }}>(detected from code)</span>
								</div>
								{r.tag && r.tag !== 'None' && <span className="techchip target">{r.target_name || 'RocketRide'}</span>}
								{(r.tech || []).map((tch) => <span key={tch} className="techchip">{tch}</span>)}
								{(r.other_platforms || [])
									.filter((p) => !(r.tech || []).some((tch) => tch.toLowerCase() === p.toLowerCase()))
									.map((p) => <span key={p} className="techchip">{p}</span>)}
							</div>
						) : null}
					</div>
				)}
			</div>
		</td>
	);
}

function RowPair({ r, i, open, setOpen, company }: {
	r: VerifyResult; i: number; open: number | null; setOpen: (n: number | null) => void; company: boolean;
}) {
	return (
		<>
			<tr className={company && isFlagged(r) ? 'flagged' : undefined} style={{ cursor: 'pointer' }}
				onClick={() => setOpen(open === i ? null : i)}>
				<td>
					<b>{r.project || r.github}</b>
					{r.names && <div className="muted" style={{ fontSize: 11.5 }}>{r.names}</div>}
					{(r.classify_failed || r.repo_accessible === false) && (
						<div className="flagcell" style={{ fontSize: 11.5, marginTop: 4, maxWidth: 420, whiteSpace: 'normal' }}>
							{String(r.reason || r.notes || 'Verification did not finish — open the row for details.')}
						</div>
					)}
				</td>
				<td><TagPill tag={r.tag} failed={r.classify_failed || r.repo_accessible === false} title={r.reason || r.notes} /></td>
				<td className="scorecell">{r.score != null ? Number(r.score).toFixed(1) : '-'}</td>
				<td>{r.backbone || '-'}</td>
				<td><BuiltOn r={r} company={company} /></td>
				<td className="muted">{r.seconds ? `${Math.round(r.seconds)}s` : '-'}</td>
			</tr>
			{open === i && <tr><Detail r={r} company={company} /></tr>}
		</>
	);
}

export default function ResultsGrid({ results, total, summary, exportName }: {
	results: VerifyResult[];
	total?: number;
	summary?: { tags?: Record<string, number> };
	exportName?: string;
}) {
	const [open, setOpen] = useState<number | null>(null);
	const { settings } = useRuns();
	const company = isCompanyPlan(settings.plan);
	const done = results.length;
	return (
		<div className="glass" style={{ padding: '6px 0 0' }}>
			<div className="jh-toolbar">
				<b style={{ fontSize: 14 }}>{done}{total ? ` / ${total}` : ''} verified</b>
				{summary?.tags && (
					<span className="muted" style={{ fontSize: 12.5 }}>
						{Object.entries(summary.tags).map(([t, n]) => `${t}: ${n}`).join(' · ')}
					</span>
				)}
				<span className="jh-toolbar-end">
					<button className="btn ghost sm" disabled={!done} type="button"
						onClick={() => { void exportResultsExcel(results, exportName || 'hack-judge-results.xlsx'); }}>
						Excel
					</button>
				</span>
			</div>
			<div className="scrolltable">
				<table className="list runs">
					<thead>
						<tr><th>Project</th><th>Tag</th><th>Score</th><th>Backbone</th><th>Built on</th><th>Time</th></tr>
					</thead>
					<tbody>
						{results.map((r, i) => (
							<RowPair key={`${r.github}-${i}`} r={r} i={i} open={open} setOpen={setOpen} company={company} />
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
