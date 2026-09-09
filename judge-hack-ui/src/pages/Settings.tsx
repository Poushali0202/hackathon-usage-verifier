import React, { useState } from 'react';
import { useAuthUser } from 'shell';
import { openAccount, openCheckout } from '../billing';
import { Page } from '../components/bits';
import { useNav } from '../NavContext';
import { useRuns } from '../RunsContext';

export default function Settings() {
	const user = useAuthUser();
	const { go } = useNav();
	const { settings, saveSettings, store } = useRuns();
	const [s, setS] = useState({ grace_days: settings.grace_days, history_penalty: settings.history_penalty });
	const [saved, setSaved] = useState(false);
	const name = user?.displayName || user?.preferredUsername || 'Signed in';
	const planLabel = settings.plan[0].toUpperCase() + settings.plan.slice(1);
	const save = () => {
		saveSettings(s);
		setSaved(true);
		setTimeout(() => setSaved(false), 1500);
	};

	return (
		<Page title="Settings" narrow>
			<div style={{ display: 'grid', gap: 16 }}>
				<div className="glass" style={{ padding: 20 }}>
					<div className="section-kicker" style={{ marginBottom: 10 }}>Account</div>
					<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
						<span className="avatar">{(name || 'P')[0]}</span>
						<div>
							<b>{name}</b>
							<div className="muted" style={{ fontSize: 12.5 }}>
								RocketRide identity · {user?.email || 'signed in'}
								{user?.userId ? ` · ${user.userId.slice(0, 8)}` : ''}
							</div>
						</div>
					</div>
				</div>

				<div className="glass" style={{ padding: 20 }}>
					<div className="section-kicker" style={{ marginBottom: 10 }}>API credentials</div>
					<p className="notice" style={{ margin: 0 }}>
						Daytona, Anthropic, and GitHub credentials are resolved server-side from RocketRide
						environment secrets (<code>ROCKETRIDE_DAYTONA_KEY</code>, <code>ROCKETRIDE_ANTHROPIC_KEY</code>,
						<code>ROCKETRIDE_GITHUB_TOKEN</code>). They are never shown in this app.
					</p>
				</div>

				<div className="glass" style={{ padding: 20 }}>
					<div className="section-kicker" style={{ marginBottom: 10 }}>Plan</div>
					<p style={{ margin: '0 0 8px' }}>
						<b>{planLabel}</b>
						{settings.billingStatus ? (
							<span className="muted"> · {settings.billingStatus.replace(/_/g, ' ')}</span>
						) : (
							<span className="muted"> · awaiting Store prices</span>
						)}
					</p>
					<p className="muted" style={{ fontSize: 12, margin: 0 }}>
						Entitlements come from your RocketRide subscription. Checkout opens the shell billing
						modal. Until this app&apos;s prices are approved on the Store tab, Company features stay
						available in this workspace.
					</p>
					<div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
						<button className="btn sm" type="button" onClick={() => openCheckout()}>Subscribe / checkout</button>
						<button className="btn ghost sm" type="button" onClick={() => go('pricing')}>See plans →</button>
						<button className="btn ghost sm" type="button" onClick={() => openAccount()}>Account overlay</button>
					</div>
				</div>

				<div className="glass" style={{ padding: 20 }}>
					<div className="section-kicker" style={{ marginBottom: 10 }}>Run history</div>
					<p style={{ margin: '0 0 8px' }}>
						<b>{store.kind === 'sql' ? 'Staging SQL' : 'Workspace cache'}</b>
						{store.ready ? '' : ' · connecting'}
					</p>
					<p className="muted" style={{ fontSize: 12, margin: 0 }}>
						{store.kind === 'sql'
							? 'Runs and custom targets are in the staging-managed database (rocketride_sql).'
							: store.broker
								? 'The SQL broker did not inject a cloud identity. History stays in this workspace. Do not attach personal Postgres. Flag this to Dmitrii.'
								: 'History stays in this workspace until staging SQL is reachable from the signed-in app.'}
					</p>
				</div>

				<div className="glass" style={{ padding: 20 }}>
					<div className="section-kicker" style={{ marginBottom: 10 }}>Run defaults</div>
					<div className="inline">
						<div className="field">
							<label>Grace days (event ±)</label>
							<input type="number" min={0} max={7} value={s.grace_days}
								onChange={(e) => setS({ ...s, grace_days: Number(e.target.value) })} />
						</div>
						<div className="field">
							<label>Pre-event work penalty (pts)</label>
							<input type="number" min={0} step={0.5} value={s.history_penalty}
								onChange={(e) => setS({ ...s, history_penalty: Number(e.target.value) })} />
						</div>
					</div>
					<p className="muted" style={{ fontSize: 12 }}>
						These are app settings (<code>hackjudge.judge-hack.graceDays</code> /
						<code>historyPenalty</code>) and also appear in the shell Settings overlay.
					</p>
					<button className="btn sm" type="button" onClick={save}>{saved ? 'Saved' : 'Save defaults'}</button>
				</div>
			</div>
		</Page>
	);
}
