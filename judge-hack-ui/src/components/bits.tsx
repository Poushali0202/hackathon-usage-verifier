import React from 'react';
import { openCheckout } from '../billing';
import { useJudgeTheme } from '../theme';
import { useNav } from '../NavContext';
import { useRuns } from '../RunsContext';
import type { Allowance } from '../types';

export function TagPill({ tag, failed, title }: { tag?: string; failed?: boolean; title?: string }) {
	if (failed) return <span className="tag err" title={title}>FAILED</span>;
	const t = (tag || 'None').toLowerCase();
	const cls = t.startsWith('sig') ? 'sig' : t.startsWith('mod') ? 'mod' : t.startsWith('less') ? 'less' : 'none';
	return <span className={`tag ${cls}`} title={title}>{tag || 'None'}</span>;
}

export function ThemeToggle() {
	const { theme, setTheme } = useJudgeTheme();
	const dark = theme === 'dark';
	return (
		<button className="themebtn" type="button"
			title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
			onClick={() => setTheme(dark ? 'light' : 'dark')}>
			<span className="thumb">{dark ? '☀' : '🌙'}</span>
			{dark ? 'Light' : 'Dark'}
		</button>
	);
}

export function Page({
	title, wide, narrow, headRight, children,
}: {
	title: string;
	wide?: boolean;
	narrow?: boolean;
	headRight?: React.ReactNode;
	children: React.ReactNode;
}) {
	const { theme } = useJudgeTheme();
	const shell = wide ? 'jh jh-wide' : narrow ? 'jh jh-narrow' : 'jh';
	return (
		<div className="jh-bleed" data-theme={theme}>
			<div className={shell} data-theme={theme}>
				<div className="pagehead">
					<h1>{title}</h1>
					<span className="right">
						{headRight}
						<ThemeToggle />
					</span>
				</div>
				{children}
			</div>
		</div>
	);
}

export function StoreBanner() {
	const { store } = useRuns();
	if (!store.ready && !store.error) {
		return <p className="muted" style={{ fontSize: 12.5, margin: '0 0 14px' }}>Connecting to staging SQL…</p>;
	}
	if (store.kind === 'sql') {
		return (
			<p className="muted" style={{ fontSize: 12.5, margin: '0 0 14px' }}>
				Runs live in staging-managed SQL{store.imported ? ` · imported ${store.imported} workspace row(s)` : ''}.
				They are visible across Design and the app switcher for this org.
			</p>
		);
	}
	return (
		<div className="notice" style={{ marginBottom: 14 }}>
			{store.broker
				? 'Staging SQL did not get a signed-in cloud identity (broker). Runs stay in this workspace until that is enabled. Personal Postgres is not used.'
				: `Staging SQL is not available yet (${store.error || 'not connected'}). Runs stay in this workspace.`}
		</div>
	);
}

export function LiveHint() {
	return (
		<div className="livecall">
			<span className="livedot" />
			<div style={{ flex: 1 }}>
				<b style={{ fontSize: 13.5 }}>Verdicts stream in <span className="livetxt">LIVE</span></b>
				<div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
					Each project's verdict lands the moment it's verified — several Daytona
					sandboxes run at once so a large sheet fills in minutes, not hours.
				</div>
				<div className="liveticks"><i /><i /><i /><i /><i /><i /></div>
			</div>
		</div>
	);
}

export function TierLockModal({
	open, onClose, title, children, tier = 'company',
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	children: React.ReactNode;
	tier?: string;
}) {
	const { go } = useNav();
	if (!open) return null;
	return (
		<div className="modal-bg open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
			<div className="modal glass">
				<h3>{title}</h3>
				<div style={{ fontSize: 13.5 }}>{children}</div>
				<div className="row" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
					<button className="btn ghost sm" type="button" onClick={() => { onClose(); go('pricing', undefined, tier); }}>
						See plans
					</button>
					<button className="btn sm" type="button" onClick={() => { onClose(); openCheckout(); }}>
						Subscribe →
					</button>
				</div>
			</div>
		</div>
	);
}

export function AllowanceWarning({ a }: { a?: Allowance | null }) {
	const { go } = useNav();
	if (!a) return null;
	const mb = (kb: number) => (kb >= 1000 ? `${+(kb / 1000).toFixed(1)} MB` : `${kb} KB`);
	const tierName = a.next_tier ? a.next_tier[0].toUpperCase() + a.next_tier.slice(1) : null;
	return (
		<div className="dqline" style={{ margin: '10px 0' }}>
			<b>This sheet likely exceeds your plan&apos;s run allowance.</b>{' '}
			Estimated ~{mb(a.estimated_kb)} of code vs a {mb(a.budget_kb)} allowance — roughly the
			first {a.est_verified_rows} repos will verify and the rest will be skipped.{' '}
			{tierName && (
				<button className="linkish" type="button" onClick={() => openCheckout()}>
					Upgrade to {tierName} →
				</button>
			)}{' '}
			<button className="linkish" type="button" onClick={() => go('pricing', undefined, a.next_tier)}>
				See plans
			</button>
		</div>
	);
}
