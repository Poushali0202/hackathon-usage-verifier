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
	if (store.kind === 'sql' || (!store.ready && !store.error)) return null;
	return (
		<div className="notice" style={{ marginBottom: 14 }}>
			Runs are saved in this workspace only until storage reconnects.
		</div>
	);
}

/** Shown wherever a run can start while the judge has no GitHub token stored. */
export function GithubTokenNotice({ action = 'Runs' }: { action?: string }) {
	const { githubTokenReady, githubTokenError } = useRuns();
	const { go } = useNav();
	if (githubTokenReady !== false) return null;
	return (
		<div className="notice" style={{ marginBottom: 14 }}>
			{githubTokenError
				? <><b>GitHub token could not be read.</b> {githubTokenError} Retry in{' '}</>
				: <><b>GitHub token required.</b> {action} need your personal access token. Add it in{' '}</>}
			<button className="linkish" type="button" onClick={() => go('settings')}>Settings</button>.
		</div>
	);
}

export function LiveHint() {
	return (
		<div className="livecall">
			<span className="livedot" />
			<div style={{ flex: 1 }}>
				<b style={{ fontSize: 13.5 }}>Results appear as each repository finishes</b>
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
						Other judges in this workspace are using the included evaluator pool
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
