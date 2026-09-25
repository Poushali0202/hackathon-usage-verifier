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
	GITHUB_TOKEN_KEY,
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
				Each judge must paste their own GitHub personal access token here. There is no shared
				or org-provided token. This box stays empty after save — we never show the secret again.
				It is stored as <code>{GITHUB_TOKEN_KEY}</code> in <i>your</i> RocketRide environment
				(Account → Environment, user scope only). Runs, prefill, and target tests use that value
				and fail closed if it is missing. A fine-grained token with read-only <b>Contents</b> and
				<b>Metadata</b> on public repositories is enough; add private repos if submissions are private.
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
							<div className="muted" style={{ fontSize: 12.5 }}>
								RocketRide identity · {user?.email || 'signed in'}
								{user?.userId ? ` · ${user.userId.slice(0, 8)}` : ''}
							</div>
						</div>
					</div>
				</div>

				<GithubAccessCard />

				<div className="glass" style={{ padding: 20 }}>
					<div className="section-kicker" style={{ marginBottom: 10 }}>Other credentials</div>
					<p className="notice" style={{ margin: 0 }}>
						The explanation model (Anthropic) is provided by Judge Hack from the RocketRide
						environment (<code>ROCKETRIDE_ANTHROPIC_KEY</code>); it never sees a repository and
						never writes a score. You do not bring a sandbox or compute key — verification runs
						on the RocketRide engine.
					</p>
				</div>

				<div className="glass" style={{ padding: 20 }}>
					<div className="section-kicker" style={{ marginBottom: 10 }}>Plan</div>
					<p style={{ margin: '0 0 8px' }}>
						<b>{BILLING_LIVE ? planLabel : 'Testing — billing paused'}</b>
						{BILLING_LIVE && settings.billingStatus ? (
							<span className="muted"> · {settings.billingStatus.replace(/_/g, ' ')}</span>
						) : (
							<span className="muted"> · checkout and plan caps are off</span>
						)}
					</p>
					<p className="muted" style={{ fontSize: 12, margin: 0 }}>
						{BILLING_LIVE
							? `Included allowance ${formatDataKb(budget)} · used ${formatDataKb(settings.meter_kb_used)} · remaining ${formatDataKb(left)}. `
							: 'Plan meters are not enforced while we test. '}
						Each run verifies up to {workers} repositor{workers === 1 ? 'y' : 'ies'} at
						once on the RocketRide engine. The workspace shares a pool of 5 concurrent evaluators;
						if it is full, a modal asks you to retry — the rest of the app stays usable.
					</p>
					<div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
						{BILLING_LIVE && <button className="btn sm" type="button" onClick={() => openCheckout()}>Subscribe / checkout</button>}
						<button className="btn ghost sm" type="button" onClick={() => go('pricing')}>See plans →</button>
						<button className="btn ghost sm" type="button" onClick={() => openAccount()}>Account overlay</button>
					</div>
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
