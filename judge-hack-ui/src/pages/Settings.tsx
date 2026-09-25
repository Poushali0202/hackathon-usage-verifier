import React, { useState } from 'react';
import { useAuthUser, usePrefs, useShellConnection } from 'shell';
import { openAccount, openCheckout } from '../billing';
import { BILLING_LIVE } from '../entitlement';
import { Page } from '../components/bits';
import { formatDataKb, planBudgetKb, remainingKb } from '../verify/meter';
import { planWorkerCap } from '../verify/pool';
import {
	clearGithubToken,
	formatGithubTokenAudit,
	GITHUB_TOKEN_AUDIT_PREF,
	looksLikeGithubToken,
	parseGithubTokenAudit,
	probeGithubToken,
	saveGithubToken,
	writeGithubTokenAudit,
	type EnvClient,
} from '../verify/githubToken';
import { useNav } from '../NavContext';
import { useRuns } from '../RunsContext';

function GithubAccessCard() {
	const { client, isConnected } = useShellConnection();
	const { githubTokenReady, githubTokenError, refreshGithubToken } = useRuns();
	const { getPref, setPref } = usePrefs();
	const [token, setToken] = useState('');
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
	const envClient = client as unknown as EnvClient | null;
	const audit = parseGithubTokenAudit(getPref(GITHUB_TOKEN_AUDIT_PREF));
	const noteAudit = (action: 'set' | 'clear') => setPref(GITHUB_TOKEN_AUDIT_PREF, writeGithubTokenAudit(action));

	const save = async () => {
		if (!envClient || !isConnected) { setMsg({ kind: 'err', text: 'RocketRide is not connected yet.' }); return; }
		const value = token.trim();
		if (!looksLikeGithubToken(value)) {
			setMsg({ kind: 'err', text: 'That does not look like a GitHub personal access token (ghp_…, github_pat_…).' });
			return;
		}
		setBusy(true); setMsg(null);
		try {
			const probe = await probeGithubToken(value);
			if (!probe.ok) { setMsg({ kind: 'err', text: probe.reason || 'GitHub rejected the token.' }); return; }
			await saveGithubToken(envClient, value);
			noteAudit('set');
			await refreshGithubToken();
			setToken('');
			setMsg({
				kind: 'ok',
				text: `Saved for ${probe.login ? `@${probe.login}` : 'your GitHub account'}${probe.remaining != null ? ` · ${probe.remaining} API calls left this hour` : ''}.`,
			});
		} catch (err) {
			setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (!envClient || !isConnected) return;
		setBusy(true); setMsg(null);
		try {
			await clearGithubToken(envClient);
			noteAudit('clear');
			await refreshGithubToken();
			setMsg({ kind: 'ok', text: 'Token removed. Runs will fail closed until a new one is added.' });
		} catch (err) {
			setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="glass" style={{ padding: 20 }}>
			<div className="section-kicker" style={{ marginBottom: 10 }}>GitHub access</div>
			<p style={{ margin: '0 0 8px' }}>
				Status:{' '}
				{githubTokenReady == null
					? <span className="muted">checking…</span>
					: githubTokenError
						? <b style={{ color: 'var(--err, #c0392b)' }}>could not read environment — runs are blocked</b>
						: githubTokenReady
							? <b>your token is saved</b>
							: <b style={{ color: 'var(--err, #c0392b)' }}>no token — runs are blocked</b>}
			</p>
			{audit && (
				<p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>{formatGithubTokenAudit(audit)}</p>
			)}
			<p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
				Required to read submission repositories. Saved to your account only — this box stays
				empty after save. A fine-grained token with read-only Contents and Metadata is enough.
			</p>
			<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
				<input
					type="password"
					autoComplete="off"
					spellCheck={false}
					placeholder="ghp_… or github_pat_…"
					value={token}
					style={{ flex: 1, minWidth: 260 }}
					onChange={(e) => setToken(e.target.value)}
					onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
				/>
				<button className="btn sm" type="button" disabled={busy || !token.trim()} onClick={() => void save()}>
					{busy ? 'Checking…' : (githubTokenReady ? 'Replace token' : 'Save token')}
				</button>
				{githubTokenReady && (
					<button className="btn ghost sm" type="button" disabled={busy} onClick={() => void remove()}>Remove</button>
				)}
			</div>
			{msg && (
				<p className={msg.kind === 'err' ? 'dqline' : 'muted'} style={{ margin: '10px 0 0', fontSize: 12.5 }}>{msg.text}</p>
			)}
		</div>
	);
}

export default function Settings() {
	const user = useAuthUser();
	const { go } = useNav();
	const { settings, saveSettings } = useRuns();
	const [s, setS] = useState({ grace_days: settings.grace_days, history_penalty: settings.history_penalty });
	const [saved, setSaved] = useState(false);
	const name = user?.displayName || user?.preferredUsername || 'Signed in';
	const planLabel = settings.plan[0].toUpperCase() + settings.plan.slice(1);
	const left = remainingKb(settings.plan, settings.meter_kb_used);
	const budget = planBudgetKb(settings.plan);
	const workers = planWorkerCap(settings.plan);
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
							<div className="muted" style={{ fontSize: 12.5 }}>{user?.email || 'Signed in'}</div>
						</div>
					</div>
				</div>

				<GithubAccessCard />

				{BILLING_LIVE && (
					<div className="glass" style={{ padding: 20 }}>
						<div className="section-kicker" style={{ marginBottom: 10 }}>Plan</div>
						<p style={{ margin: '0 0 8px' }}>
							<b>{planLabel}</b>
							{settings.billingStatus ? (
								<span className="muted"> · {settings.billingStatus.replace(/_/g, ' ')}</span>
							) : null}
						</p>
						<p className="muted" style={{ fontSize: 12, margin: 0 }}>
							Included {formatDataKb(budget)} · {formatDataKb(left)} remaining.
							Up to {workers} repositor{workers === 1 ? 'y' : 'ies'} at a time.
						</p>
						<div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
							<button className="btn sm" type="button" onClick={() => openCheckout()}>Subscribe / checkout</button>
							<button className="btn ghost sm" type="button" onClick={() => go('pricing')}>See plans →</button>
							<button className="btn ghost sm" type="button" onClick={() => openAccount()}>Account</button>
						</div>
					</div>
				)}

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
						Used as the starting values on New run and Quick verify.
					</p>
					<button className="btn sm" type="button" onClick={save}>{saved ? 'Saved' : 'Save defaults'}</button>
				</div>
			</div>
		</Page>
	);
}
