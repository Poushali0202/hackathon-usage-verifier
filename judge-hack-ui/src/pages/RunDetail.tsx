import React, { useEffect } from 'react';
import { Page } from '../components/bits';
import ResultsGrid from '../components/ResultsGrid';
import { runDuration } from '../format';
import { useNav } from '../NavContext';
import { useRuns } from '../RunsContext';

export default function RunDetail() {
	const { runId, go } = useNav();
	const { getRun, stop, hydrateResults, store } = useRuns();
	const run = runId ? getRun(runId) : undefined;

	useEffect(() => {
		if (!runId || !store.ready) return;
		if (run && run.total > 0 && !(run.results || []).length) hydrateResults(runId);
	}, [runId, store.ready, run?.total, run?.results?.length, hydrateResults]);

	if (!run) {
		return (
			<Page title="Run not found">
				<p className="dqline">That run is not in this workspace.</p>
				<p className="muted"><button className="linkish" type="button" onClick={() => go('newrun')}>Start a new run →</button></p>
			</Page>
		);
	}

	return (
		<Page title={run.name} wide
			headRight={
				<span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
					{run.status === 'running' && (
						<button className="btn ghost sm" type="button" onClick={stop}>■ Stop run</button>
					)}
					<span className={`pill ${run.status === 'done' ? 'done' : run.status === 'stopped' ? 'draft' : 'running'}`}>{run.status}</span>
				</span>
			}>
			<p className="muted" style={{ margin: '-8px 0 14px', fontSize: 13 }}>
				Target <b>{run.target_name || 'RocketRide'}</b> · event date {run.event_date || '-'} ·
				pre-event work penalty −{run.history_penalty ?? 2} pts
				{run.created_at && ` · ran ${new Date(run.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
				{runDuration(run) && ` (took ${runDuration(run)})`}
				{run.status === 'running' && ' · live'}
				{run.status === 'stopped' && ' · this run was stopped; results below are what completed'}
			</p>
			<ResultsGrid results={run.results || []} total={run.total} summary={run.summary}
				exportName={`${run.name.replace(/\s+/g, '_')}.xlsx`} />
		</Page>
	);
}
