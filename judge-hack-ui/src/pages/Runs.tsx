import React, { useEffect, useState } from 'react';
import { Page, StoreBanner } from '../components/bits';
import { runDuration } from '../format';
import { useNav } from '../NavContext';
import { useRuns } from '../RunsContext';

export default function Runs() {
	const { runs } = useRuns();
	const { go } = useNav();
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!runs.some((r) => r.status === 'running')) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [runs]);

	return (
		<Page title="Runs" headRight={<button className="btn sm" type="button" onClick={() => go('newrun')}>+ New run</button>}>
			<StoreBanner />
			<div className="glass" style={{ padding: '4px 0' }}>
				{runs.length === 0 ? (
					<p className="muted" style={{ padding: '18px 16px' }}>No runs yet.</p>
				) : (
					<div className="scrolltable">
						<table className="list runs-page">
							<thead><tr><th>Run</th><th>Event date</th><th>Repos</th><th>Duration</th><th>Significant</th><th>Flagged</th><th>Status</th></tr></thead>
							<tbody>
								{runs.map((r) => (
									<tr key={r.id}>
										<td><button className="linkish" type="button" onClick={() => go('rundetail', r.id)}><b>{r.name}</b></button></td>
										<td>{r.event_date || '-'}</td>
										<td>{r.done_count}{r.total ? ` / ${r.total}` : ''}</td>
										<td className="muted">{runDuration(r, now) ? `${runDuration(r, now)}${r.status === 'running' ? '…' : ''}` : '-'}</td>
										<td>{r.significant_count}</td>
										<td className={r.flagged_count ? 'flagcell' : undefined}>{r.flagged_count}</td>
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
