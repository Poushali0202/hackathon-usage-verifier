import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
	CheckoutModal,
	useAuthUser,
	useShellApiConfig,
	useShellConnection,
} from 'shell';
import type { CheckoutPlan } from 'shell';
import {
	APP_ID,
	BILLING_PLANS,
	onCheckoutRequest,
	openAccount,
} from './billing';
import { useNav } from './NavContext';
import { useJudgeTheme } from './theme';
import type { PlanTier } from './types';

type BillingClient = {
	billing: {
		getProductPrices: (appId: string) => Promise<CheckoutPlan[]>;
		createCheckoutSession: (
			orgId: string,
			appId: string,
			priceId: string,
			promotionCode?: string,
		) => Promise<{ clientSecret: string | null; subscriptionId: string; status?: string }>;
	};
	call?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
};

export default function CheckoutHost() {
	const { theme } = useJudgeTheme();
	const { view, go } = useNav();
	const user = useAuthUser();
	const apiConfig = useShellApiConfig();
	const { client } = useShellConnection();
	const [open, setOpen] = useState(false);
	const [picked, setPicked] = useState<PlanTier | undefined>(undefined);
	const [livePlans, setLivePlans] = useState<CheckoutPlan[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	const stripeKey = apiConfig.RR_STRIPE_PUBLISHABLE_KEY || '';
	const orgId = user?.organization?.id || '';
	const billingClient = client as BillingClient | null;

	useEffect(() => onCheckoutRequest((plan) => {
		setPicked(plan);
		setLoadError(null);
		setLivePlans([]);
		setOpen(true);
	}), []);

	useEffect(() => {
		if (!open || !billingClient) return;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			if (!cancelled) setLoadError((prev) => prev || 'Store prices did not load in time.');
		}, 4000);
		billingClient.billing.getProductPrices(APP_ID)
			.then((plans) => {
				if (cancelled) return;
				const active = (plans || []).filter((p) => p.isActive !== false && p.stripePriceId);
				setLivePlans(active);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setLoadError(err instanceof Error ? err.message : String(err));
				setLivePlans([]);
			})
			.finally(() => window.clearTimeout(timer));
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [open, billingClient]);

	const close = () => setOpen(false);

	const fetchPlans = useCallback(async () => livePlans || [], [livePlans]);

	const createCheckout = useCallback(async (priceId: string, promotionCode?: string) => {
		if (!billingClient || !orgId) throw new Error('Not connected');
		return billingClient.billing.createCheckoutSession(orgId, APP_ID, priceId, promotionCode);
	}, [billingClient, orgId]);

	const confirmPending = useCallback(async (subscriptionId: string, priceId: string) => {
		if (!billingClient?.call) return;
		await billingClient.call('rrext_account_billing', {
			subcommand: 'confirm_pending',
			appId: APP_ID,
			subscriptionId,
			priceId,
		});
	}, [billingClient]);

	if (!open) return null;

	if (stripeKey && orgId && billingClient && livePlans && livePlans.length > 0) {
		return (
			<CheckoutModal
				appName="Judge Hack"
				appDescription="Fast, evidence-based verification of product usage in hackathon repositories."
				stripePublishableKey={stripeKey}
				onFetchPlans={fetchPlans}
				onCreateCheckout={createCheckout}
				onConfirmPending={confirmPending}
				onSuccess={close}
				onClose={close}
			/>
		);
	}

	const dialog = (
		<div
			className="jh-checkout-bg"
			data-theme={theme}
			role="dialog"
			aria-modal="true"
			aria-labelledby="jh-checkout-title"
			onClick={(e) => { if (e.target === e.currentTarget) close(); }}
		>
			<div className="jh jh-checkout" data-theme={theme} onClick={(e) => e.stopPropagation()}>
				<div className="section-kicker">Checkout</div>
				<h2 id="jh-checkout-title">Subscribe to Judge Hack</h2>
				<div className="jh-checkout-banner">
					{loadError
						? `Could not load Store prices (${loadError}).`
						: 'Stripe cannot charge yet. These prices are from the app manifest. They go live after a version is approved on the Store tab.'}
				</div>
				<div className="jh-checkout-plans">
					{BILLING_PLANS.map((p) => {
						const id = p.nickname.toLowerCase() as PlanTier;
						const selected = picked ? picked === id : id === 'company';
						return (
							<button
								key={p.nickname}
								type="button"
								className={`jh-checkout-plan${selected ? ' selected' : ''}`}
								onClick={() => setPicked(id)}
							>
								{selected && <span className="jh-checkout-sel">Selected</span>}
								<b>{p.nickname}</b>
								<div className="jh-checkout-price">
									${(p.amountCents / 100).toFixed(0)}
									<span> prepaid</span>
								</div>
							</button>
						);
					})}
				</div>
				<div className="jh-checkout-actions">
					<button className="btn ghost sm" type="button" onClick={close}>Close</button>
					{view !== 'pricing' && (
						<button className="btn ghost sm" type="button" onClick={() => { close(); go('pricing'); }}>
							See full plans
						</button>
					)}
					<button className="btn sm" type="button" onClick={() => { close(); openAccount(); }}>
						Open Account →
					</button>
				</div>
			</div>
		</div>
	);

	return createPortal(dialog, document.body);
}
