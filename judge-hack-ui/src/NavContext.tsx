import React, { createContext, useContext } from 'react';
import type { View } from './types';

type NavApi = {
	view: View;
	go: (view: View, runId?: string, highlight?: string) => void;
	runId?: string;
	highlight?: string;
};

const Ctx = createContext<NavApi | null>(null);

export const NavProvider: React.FC<{ value: NavApi; children: React.ReactNode }> = ({ value, children }) => (
	<Ctx.Provider value={value}>{children}</Ctx.Provider>
);

export function useNav(): NavApi {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error('useNav must be used inside NavProvider');
	return ctx;
}
