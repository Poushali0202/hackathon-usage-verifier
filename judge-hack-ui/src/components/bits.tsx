import React from 'react';
import { createPortal } from 'react-dom';
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
				Runs live in staging-managed SQL{store.imported ? ` · imported ${store.imported} workspace row(s)` : ''},
				scoped to your signed-in user. Other judges in this org do not see your runs.
				Daytona compute is included with the subscription — Developer runs use up to 2
				sandboxes, Company/Organizers up to 3, torn down when the run ends. The workspace
				shares a hard cap of 5 live sandboxes (Daytona&apos;s 10 vCPU starter tier) so
				overlapping judges wait instead of overflowing.
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
					Each project's verdict lands the moment it's verified — Developer uses up to
					2 Daytona sandboxes at once, Company and Organizers up to 3, within a shared
					org pool of 5, so a large sheet fills in minutes, not hours.
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

export function OrgBusyModal({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const { theme } = useJudgeTheme();
	if (!open || typeof document === 'undefined') return null;
	return createPortal(
		<div className="jh-cap-bg" data-theme={theme} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
			<div className="jh" data-theme={theme} style={{ width: 'auto', maxWidth: 'none', minHeight: 0, padding: 0, margin: 0, background: 'transparent' }}>
				<div className="modal glass" role="dialog" aria-modal="true" aria-labelledby="jh-org-busy-title">
					<h3 id="jh-org-busy-title">Included compute is busy</h3>
					<p>
						Other judges in this workspace are using the included Daytona sandboxes
						right now. Your sheet and settings are unchanged — retry in a moment.
						This is not a plan lock; the rest of Judge Hack stays available.
					</p>
					<div className="row" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
						<button className="btn sm" type="button" onClick={onClose}>Got it</button>
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}

function formatAllowanceKb(kb: number): string {
	return kb >= 1000 ? `${+(kb / 1000).toFixed(1)} MB` : `${kb} KB`;
}

export function AllowanceModal({
	open,
	a,
	onClose,
	onContinue,
}: {
	open: boolean;
	a?: Allowance | null;
	onClose: () => void;
	onContinue?: () => void;
}) {
	const { go } = useNav();
	const { theme } = useJudgeTheme();
	if (!open || !a || typeof document === 'undefined') return null;
	const tierName = a.next_tier ? a.next_tier[0].toUpperCase() + a.next_tier.slice(1) : 'a higher plan';
	const blocked = !!a.blocked;
	return createPortal(
		<div className="jh-cap-bg" data-theme={theme} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
			<div className="jh" data-theme={theme} style={{ width: 'auto', maxWidth: 'none', minHeight: 0, padding: 0, margin: 0, background: 'transparent' }}>
				<div className="modal glass" role="dialog" aria-modal="true" aria-labelledby="jh-cap-title">
					<h3 id="jh-cap-title">{blocked ? 'Prepaid allowance is empty' : 'This sheet exceeds your plan cap'}</h3>
					{blocked ? (
						<p>
							You&apos;ve used the included allowance on this plan. The next verification is
							refused until you upgrade — usage cannot run past what you&apos;ve paid.
						</p>
					) : (
						<p>
							Estimated ~{formatAllowanceKb(a.estimated_kb)} of code vs{' '}
							{formatAllowanceKb(a.remaining_kb ?? a.budget_kb)} left on this plan.
							Only the first {a.est_verified_rows} repos will verify; the rest are skipped.
							Upgrade to {tierName} for a larger included allowance.
						</p>
					)}
					<div className="row" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
						<button className="btn ghost sm" type="button" onClick={() => { onClose(); go('pricing', undefined, a.next_tier); }}>
							See plans
						</button>
						<button className="btn gold sm" type="button" onClick={() => { onClose(); openCheckout(); }}>
							Upgrade to {tierName} →
						</button>
						{blocked || !onContinue ? (
							<button className="btn sm" type="button" onClick={onClose}>Got it</button>
						) : (
							<button className="btn sm" type="button" onClick={() => { onClose(); onContinue(); }}>
								Verify first {a.est_verified_rows} anyway
							</button>
						)}
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
