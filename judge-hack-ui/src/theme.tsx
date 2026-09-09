import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePrefs } from 'shell';

export type JudgeTheme = 'light' | 'dark';

type ThemeApi = {
	theme: JudgeTheme;
	setTheme: (theme: JudgeTheme) => void;
};

const Ctx = createContext<ThemeApi | null>(null);

let stored: JudgeTheme = 'light';
const listeners = new Set<(theme: JudgeTheme) => void>();

function readStored(getPref: (k: string) => unknown): JudgeTheme {
	const fromPref = getPref('hj.theme');
	if (fromPref === 'dark' || fromPref === 'light') return fromPref;
	return 'light';
}

function applyDomTheme(theme: JudgeTheme) {
	const root = document.documentElement;
	// Phase-2 used html[data-theme]; do not set that here — RocketRide's
	// shell tokens live as inline --rr-* properties, and a bare data-theme
	// flip only lightened text against the beige canvas.
	if (root.dataset.theme === 'light' || root.dataset.theme === 'dark') {
		delete root.dataset.theme;
	}
	if (theme === 'dark') root.dataset.hjTheme = 'dark';
	else delete root.dataset.hjTheme;
	root.style.setProperty('--hj-theme', theme);
}

function publish(theme: JudgeTheme) {
	stored = theme;
	applyDomTheme(theme);
	listeners.forEach((fn) => fn(theme));
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { getPref, setPref } = usePrefs();
	const [theme, setThemeState] = useState<JudgeTheme>(() => {
		const initial = readStored(getPref);
		stored = initial;
		applyDomTheme(initial);
		return initial;
	});

	useEffect(() => { publish(theme); }, [theme]);
	useEffect(() => () => {
		delete document.documentElement.dataset.hjTheme;
		document.documentElement.style.removeProperty('--hj-theme');
	}, []);

	const setTheme = useCallback((next: JudgeTheme) => {
		publish(next);
		setThemeState(next);
		setPref('hj.theme', next);
	}, [setPref]);

	return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
};

export function useJudgeTheme(): ThemeApi {
	const ctx = useContext(Ctx);
	const [theme, setLocal] = useState<JudgeTheme>(() => stored);
	useEffect(() => {
		const onChange = (next: JudgeTheme) => setLocal(next);
		listeners.add(onChange);
		setLocal(stored);
		return () => { listeners.delete(onChange); };
	}, []);
	// SidebarNav is portaled into host chrome (outside ThemeProvider). Read
	// the module store there; setTheme still comes from the provider when present.
	if (ctx) return ctx;
	return { theme, setTheme: () => { /* host chrome is read-only */ } };
}
