import React, { useEffect, useState } from 'react';
import { useAuthUser } from 'shell';
import astronaut from '../astronaut.svg';
import { openAccount, openCheckout } from '../billing';
import { Page, StoreBanner } from '../components/bits';
import { runDuration } from '../format';
import { useNav } from '../NavContext';
import { useRuns } from '../RunsContext';

export default function Dashboard() {
	const user = useAuthUser();
	const { runs, settings } = useRuns();
	const { go } = useNav();
	const planLabel = settings.plan[0].toUpperCase() + settings.plan.slice(1);
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!runs.some((r) => r.status === 'running')) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [runs]);

	const repos = runs.reduce((n, r) => n + (r.done_count || 0), 0);
	const sig = runs.reduce((n, r) => n + (r.significant_count || 0), 0);
	const flaggedN = runs.reduce((n, r) => n + (r.flagged_count || 0), 0);

	return (
		<Page title="Dashboard" wide headRight={<button className="btn sm" type="button" onClick={() => go('newrun')}>New run</button>}>
			<StoreBanner />
			{user ? (
				<div className="glass" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
					<span className="avatar">{(user.displayName || user.preferredUsername || 'U')[0]}</span>
					<div style={{ flex: 1, minWidth: 180 }}>
						<div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>Signed in with RocketRide</div>
						<b>{user.displayName || user.preferredUsername}</b>
						<div className="muted" style={{ fontSize: 12.5 }}>
							{user.email} · {planLabel} plan{settings.billingStatus ? ` · ${settings.billingStatus.replace(/_/g, ' ')}` : ''}
						</div>
					</div>
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
						<button className="btn sm" type="button" onClick={() => openCheckout()}>Subscribe</button>
						<button className="btn ghost sm" type="button" onClick={() => go('pricing')}>Plans</button>
						<button className="btn ghost sm" type="button" onClick={() => openAccount()}>Account</button>
					</div>
				</div>
			) : (
				<div className="notice" style={{ marginBottom: 16 }}>
					Preview is waiting on the RocketRide connection. Use the left nav for Targets, New run, Quick verify, and Runs — then Retry the banner at the top if it is still showing.
				</div>
			)}
			<div className="stats">
				{([[runs.length, 'runs', false], [repos, 'repos verified', false], [sig, 'Significant', false], [flaggedN, 'flagged', true]] as const)
					.map(([n, l, flag]) => (
						<div key={l} className={`glass stat${flag ? ' flag' : ''}`}>
							<div className="n">{n}</div><div className="l">{l}</div>
						</div>
					))}
			</div>
			<div className="glass" style={{ padding: '4px 0' }}>
				<div style={{ padding: '12px 16px', fontWeight: 700 }}>Recent runs</div>
				{runs.length === 0 ? (
					<div style={{ padding: '10px 16px 26px', textAlign: 'center' }}>
						<img className="astro lg" src={astronaut} alt="" style={{ height: 44 }} />
						<p className="muted" style={{ fontSize: 13.5 }}>
							No runs yet. Start your first verification — upload a submissions sheet or paste repo URLs.
						</p>
							<button className="btn sm" type="button" onClick={() => go('newrun')}>New run</button>
					</div>
				) : (
					<div className="scrolltable">
						<table className="list dash">
							<thead><tr><th>Run</th><th>Event date</th><th>Repos</th><th>Duration</th><th>Status</th></tr></thead>
							<tbody>
								{runs.map((r) => (
									<tr key={r.id}>
										<td><button className="linkish" type="button" onClick={() => go('rundetail', r.id)}><b>{r.name}</b></button></td>
										<td>{r.event_date || '-'}</td>
										<td>{r.done_count}{r.total ? ` / ${r.total}` : ''}</td>
										<td className="muted">{runDuration(r, now) ? `${runDuration(r, now)}${r.status === 'running' ? '…' : ''}` : '-'}</td>
										<td><span className={`pill ${r.status === 'done' ? 'done' : r.status === 'stopped' ? 'draft' : 'running'}`}>{r.status}</span></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</Page>
	);
}
