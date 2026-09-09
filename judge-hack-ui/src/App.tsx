// =============================================================================
// MIT License
// =============================================================================

/**
 * Judge Hack — V1 shell app. Product surfaces (dashboard, verify, runs, dossier)
 * invoke the Daytona pipeline directly; the LLM never writes the verdict.
 */

import React, { useState } from 'react';
import type { ShellAppProps } from 'shell';
import {
	AppLayout,
	SidebarCollapsedGate,
	useAuthUser,
	usePrefs,
	useSidebarCollapsed,
} from 'shell';
import './app.css';
import astronaut from './astronaut.svg';
import { openCheckout } from './billing';
import CheckoutHost from './CheckoutHost';
import { NavProvider } from './NavContext';
import Dashboard from './pages/Dashboard';
import NewRun from './pages/NewRun';
import Pricing from './pages/Pricing';
import QuickVerify from './pages/QuickVerify';
import RunDetail from './pages/RunDetail';
import Runs from './pages/Runs';
import Settings from './pages/Settings';
import Targets from './pages/Targets';
import { ThemeProvider, useJudgeTheme } from './theme';
import { RunsProvider } from './RunsContext';
import type { View } from './types';

const NAV: { id: View; label: string; short: string }[] = [
	{ id: 'dashboard', label: 'Dashboard', short: 'Home' },
	{ id: 'targets', label: 'Targets', short: 'Targets' },
	{ id: 'newrun', label: 'New run', short: 'New' },
	{ id: 'verify', label: 'Quick verify', short: 'Quick' },
	{ id: 'runs', label: 'Runs', short: 'Runs' },
	{ id: 'pricing', label: 'Plans', short: 'Plans' },
	{ id: 'settings', label: 'Settings', short: 'Set' },
];

const SidebarNav: React.FC<{ view: View; onView: (view: View, _run?: string, highlight?: string) => void }> = ({ view, onView }) => {
	const { theme } = useJudgeTheme();
	const collapsed = useSidebarCollapsed();
	const current = view === 'rundetail' ? 'runs' : view;
	return (
		<div className={`jh-nav${collapsed ? ' is-collapsed' : ''}`} data-theme={theme}>
			{NAV.map((item) => (
				<button
					key={item.id}
					type="button"
					title={item.label}
					className={current === item.id ? 'cur' : undefined}
					onClick={() => onView(item.id)}
				>
					{collapsed ? item.short : item.label}
				</button>
			))}
			<span className="grow" />
			<SidebarCollapsedGate>
				<div className="upgrade">
					<b>Upgrade your plan</b> <img className="astro" src={astronaut} alt="" /><br />
					Git freshness checks and custom scoring.<br />
					<button className="btn sm" type="button" style={{ marginTop: 9 }}
						onClick={() => openCheckout()}>Subscribe →</button>
					<button className="btn ghost sm" type="button" style={{ marginTop: 8 }}
						onClick={() => onView('pricing', undefined, 'company')}>See plans →</button>
				</div>
			</SidebarCollapsedGate>
		</div>
	);
};

const Content: React.FC<{ view: View }> = ({ view }) => {
	if (view === 'dashboard') return <Dashboard />;
	if (view === 'targets') return <Targets />;
	if (view === 'newrun') return <NewRun />;
	if (view === 'verify') return <QuickVerify />;
	if (view === 'runs') return <Runs />;
	if (view === 'rundetail') return <RunDetail />;
	if (view === 'pricing') return <Pricing />;
	return <Settings />;
};

/**
 * The shell Sidebar returns null when identity is missing (preview offline,
 * Inherit Auth off, or the connection banner is up). Keep the product nav in
 * the client area in that case so Dashboard / Targets / New run stay reachable.
 */
const AppFrame: React.FC<{ view: View; onView: (view: View, run?: string, highlight?: string) => void; children: React.ReactNode }> = ({
	view, onView, children,
}) => {
	const user = useAuthUser();
	return (
		<div className="jh-frame">
			{!user && (
				<aside className="jh-nav-rail" aria-label="Judge Hack">
					<SidebarNav view={view} onView={onView} />
				</aside>
			)}
			<div className="jh-frame-main">
				{children}
			</div>
		</div>
	);
};

const App: React.FC<ShellAppProps> = () => {
	const { getPref, setPref } = usePrefs();
	const [view, setView] = useState<View>(() => (getPref('hj.view') as View) || 'dashboard');
	const [runId, setRunId] = useState<string | undefined>(() => (getPref('hj.runId') as string) || undefined);
	const [highlight, setHighlight] = useState<string | undefined>(undefined);

	const go = (next: View, nextRunId?: string, nextHighlight?: string) => {
		setView(next);
		setPref('hj.view', next);
		if (nextRunId) {
			setRunId(nextRunId);
			setPref('hj.runId', nextRunId);
		}
		setHighlight(nextHighlight);
	};

	// Do not emit shell:loginRequest. The shell already gates authenticated
	// apps; doing it again inside the Design preview iframe replaces the whole
	// session with "Sign in required" and can spin forever.
	return (
		<RunsProvider>
			<ThemeProvider>
				<NavProvider value={{ view, go, runId, highlight }}>
					<AppLayout sidebar={<SidebarNav view={view} onView={go} />} showStatus>
						<AppFrame view={view} onView={go}>
							<Content view={view} />
							<CheckoutHost />
						</AppFrame>
					</AppLayout>
				</NavProvider>
			</ThemeProvider>
		</RunsProvider>
	);
};

export default App;
