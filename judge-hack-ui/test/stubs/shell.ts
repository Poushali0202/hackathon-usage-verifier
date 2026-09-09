/** Vitest stub — the real `'shell'` package is provided by the host at runtime. */
export type ConnectResult = {
	userId?: string;
	email?: string;
	displayName?: string;
	preferredUsername?: string;
};

export class ConnectionManager {
	static getInstance() {
		return { emit() { /* no-op in unit tests */ } };
	}
}
