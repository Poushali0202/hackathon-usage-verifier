import React, { useEffect } from 'react';
import { openCheckout } from '../billing';
import { BILLING_LIVE } from '../entitlement';
import { Page } from '../components/bits';
import { useNav } from '../NavContext';
import { useRuns } from '../RunsContext';
import type { PlanTier } from '../types';

const TIERS: [string, string, string, string, string[], boolean][] = [
	['Developer', '$20', '4 MB included · about 8 repos',
		'For individual builders checking their own projects', [
			'1 custom target',
			'Core scoring: verdict, backbone & evidence',
			'Batch sheets up to 10 repos',
			'Excel export',
		], false],
	['Company', '$100', '20 MB included · about 40 repos',
		'For sponsors verifying usage of their own product', [
			'Everything in Developer',
			'Several targets',
			'Git freshness & commit-history integrity checks',
			'Custom scoring weights & tag cut-offs per target',
			'Batch sheets up to 250 repos',
		], true],
	['Organizers', '$200', '40 MB included · about 80 repos',
		'For event teams judging across many sponsors', [
			'Everything in Company',
			'Unlimited targets & multi-target events',
			'Live streaming verification',
			'API access',
			'Unlimited batches, priority processing',
		], false],
];

const METER_POINTS: [string, string][] = [
	['One simple rate', '$5 per MB of code verified, on every plan. An average repo is 500 KB, so about $2.50 per repo.'],
	['Prepaid & metered live', 'Pay first, then use. Every verification draws your balance down by the code it actually scans.'],
	['Hard stop at zero', 'The next run is refused the instant the balance is empty. Usage can never exceed what you paid.'],
	['Metered top-ups', 'Going past your allowance uses metered billing at a premium per-KB rate — plans are far cheaper per MB, so upgrading beats topping up.'],
];

export default function Pricing() {
	const { highlight } = useNav();
	const { settings } = useRuns();
	const pin = (highlight || '').toLowerCase();
	const current = settings.plan;

	useEffect(() => {
		if (!pin) return;
		document.getElementById(`plan-${pin}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}, [pin]);

	return (
		<Page title="Plans">
			<p className="muted" style={{ textAlign: 'center', margin: '-8px 0 30px' }}>
				{BILLING_LIVE ? (
					<>
						Every plan includes a prepaid verification allowance that meters down in real
						time and stops at zero — you can never spend more than you&apos;ve paid.
						Checkout is the RocketRide billing modal (Stripe). Current entitlement:{' '}
						<b>{current[0].toUpperCase() + current.slice(1)}</b>
						{settings.billingStatus ? ` (${settings.billingStatus})` : ''}.
					</>
				) : (
					<>
						These are the planned tiers. Checkout and plan caps are paused while we test
						— Josh: staging billing is not wired yet. Testers get every feature. Flip
						<code> BILLING_LIVE </code> when Store prices and the webhook exist.
					</>
				)}
			</p>
			<div className="plans">
				{TIERS.map(([name, price, included, who, feats, mid]) => (
					<div key={name} id={`plan-${name.toLowerCase()}`}
						className={`glass plan${mid ? ' hot' : ''}${pin === name.toLowerCase() ? ' active' : ''}`}
						style={{ padding: 22 }}>
						{pin === name.toLowerCase() && (
							<div className="planbadge">Unlocks the feature you clicked</div>
						)}
						<h3 style={{ margin: 0 }}>{name}</h3>
						<div style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 2px' }}>
							{price}<span className="muted" style={{ fontSize: 13, fontWeight: 600 }}> prepaid</span>
						</div>
						<div style={{ fontSize: 13, fontWeight: 700, margin: '0 0 4px' }}>{included}</div>
						<p className="muted" style={{ fontSize: 12.5, margin: '0 0 12px' }}>{who}</p>
						<ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.9 }}>
							{feats.map((f) => <li key={f}>{f}</li>)}
						</ul>
						<button className={`btn sm ${mid ? 'gold' : 'ghost'}`} type="button"
							style={{ marginTop: 16 }}
							disabled={!BILLING_LIVE}
							onClick={() => openCheckout(name.toLowerCase() as PlanTier)}>
							{BILLING_LIVE
								? (current === name.toLowerCase() ? 'Manage billing →' : `Subscribe ${name} →`)
								: 'Checkout paused'}
						</button>
					</div>
				))}
			</div>
			<div className="glass" style={{ padding: 22, marginTop: 18 }}>
				<div className="section-kicker" style={{ marginBottom: 12 }}>How metering works</div>
				<div className="metergrid">
					{METER_POINTS.map(([t, d]) => (
						<div key={t}>
							<b style={{ fontSize: 13.5 }}>{t}</b>
							<p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0', lineHeight: 1.6 }}>{d}</p>
						</div>
					))}
				</div>
				<p className="muted" style={{ fontSize: 12, margin: '14px 0 0' }}>
					Each run is refused once the included allowance is empty, and a sheet that would
					overshoot is truncated to what still fits. Stripe auto-recharge is not wired yet —
					plans go live when a version is approved on the Store tab. Do not invent price IDs.
					Compute is included: verification runs on the RocketRide engine over the GitHub API
					with your own token; Developer verifies 2 repositories at once, Company/Organizers 3,
					shared across the workspace up to 5.
				</p>
			</div>
		</Page>
	);
}
