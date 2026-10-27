import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthUser, useShellConnection } from 'shell';
import {
	APP_ID,
	onManageBillingRequest,
	openAccount,
	summarizeSubscription,
} from './billing';
import type { SubscriptionDetail } from './billing';
import { BILLING_LIVE } from './entitlement';
import { useJudgeTheme } from './theme';

type DetailsClient = {
	billing: {
		getDetails: (orgId: string) => Promise<Array<SubscriptionDetail & { appId?: string }>>;
	};
};

/**
 * The Manage billing dialog. Shows the current subscription state and routes
 * the user to Account > Billing, where cancel, change plan, and payment
 * methods live. The app deliberately makes no lifecycle calls of its own:
 * the platform panel already implements them with org-admin gating (and the
 * cancel endpoint is currently broken platform-side, saas #850, so owning a
 * duplicate flow here would surface that 500 as our bug).
 */
export default function ManageBillingHost() {
	const { theme } = useJudgeTheme();
	const user = useAuthUser();
	const { client } = useShellConnection();
	const [open, setOpen] = useState(false);
	const [detail, setDetail] = useState<SubscriptionDetail | null | undefined>(undefined);
	const [loadError, setLoadError] = useState<string | null>(null);

	const orgId = user?.organization?.id || '';
	const detailsClient = client as DetailsClient | null;

	useEffect(() => onManageBillingRequest(() => {
		if (!BILLING_LIVE) return;
		setDetail(undefined);
		setLoadError(null);
		setOpen(true);
	}), []);

	useEffect(() => {
		if (!open) return;
		if (!detailsClient || !orgId) {
			setLoadError('Not connected.');
			setDetail(null);
			return;
		}
		let cancelled = false;
		detailsClient.billing.getDetails(orgId)
			.then((rows) => {
				if (cancelled) return;
				setDetail((rows || []).find((r) => r.appId === APP_ID) ?? null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setLoadError(err instanceof Error ? err.message : String(err));
				setDetail(null);
			});
		return () => { cancelled = true; };
	}, [open, detailsClient, orgId]);

	if (!open) return null;

	const close = () => setOpen(false);
	const loading = detail === undefined && !loadError;
	const summary = summarizeSubscription(detail ?? null);

	const dialog = (
		<div
			className="jh-checkout-bg"
			data-theme={theme}
			role="dialog"
			aria-modal="true"
			aria-labelledby="jh-manage-title"
			onClick={(e) => { if (e.target === e.currentTarget) close(); }}
		>
			<div className="jh jh-checkout" data-theme={theme} onClick={(e) => e.stopPropagation()}>
				<div className="section-kicker">Billing</div>
				<h2 id="jh-manage-title">Manage billing</h2>
				{loading ? (
					<p className="muted">Loading your subscription…</p>
				) : loadError ? (
					<p className="muted">
						Could not load subscription details ({loadError}). You can still manage
						billing from your RocketRide Account.
					</p>
				) : (
					<>
						<p style={{ margin: '0 0 4px', fontWeight: 700 }}>{summary.plan}</p>
						{summary.status && <p className="muted" style={{ margin: 0 }}>{summary.status}</p>}
					</>
				)}
				<div className="jh-checkout-banner">
					Cancelling, changing plan, and payment methods live in your RocketRide
					Account, in the Billing tab.
				</div>
				<div className="jh-checkout-actions">
					<button className="btn ghost sm" type="button" onClick={close}>Close</button>
					<button className="btn sm" type="button" onClick={() => { close(); openAccount(); }}>
						Open Account →
					</button>
				</div>
				<p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
					You can also reach it anytime from your avatar menu.
				</p>
			</div>
		</div>
	);

	return createPortal(dialog, document.body);
}
