import { DAYTONA_ORG_SLOTS } from './pool';

/** Shown in the sheet and the on-screen modal when the org pool is full. */
export const ORG_BUSY_REASON = 'Included compute is busy. Retry in a moment.';

export function isOrgBusyReason(reason?: string): boolean {
	return /included compute is busy/i.test(reason || '');
}

export class OrgBusyError extends Error {
	constructor(message = ORG_BUSY_REASON) {
		super(message);
		this.name = 'OrgBusyError';
	}
}

export function isOrgBusyError(err: unknown): boolean {
	if (err instanceof OrgBusyError) return true;
	return isOrgBusyReason(err instanceof Error ? err.message : String(err));
}

/** How many of `wanted` slots can still be taken from a shared org pool. */
export function claimableSlots(
	wanted: number,
	live: number,
	orgSlots = DAYTONA_ORG_SLOTS,
): number {
	if (wanted <= 0) return 0;
	return Math.max(0, Math.min(Math.floor(wanted), orgSlots - Math.max(0, live)));
}

export type OrgLease = {
	claim: (wanted: number, ttlSeconds: number) => Promise<number>;
	release: () => Promise<void>;
};

/** Wrap a slot backend so each Verify / prefill / test holds its own leases. */
export function createOrgLease(backend: {
	acquire: (wanted: number, ttlSeconds: number) => Promise<number[]>;
	releaseSlots: (slots: number[]) => Promise<void>;
}): OrgLease {
	const held: number[] = [];
	return {
		async claim(wanted, ttlSeconds) {
			const slots = await backend.acquire(Math.max(0, Math.floor(wanted)), ttlSeconds);
			held.push(...slots);
			return slots.length;
		},
		async release() {
			const slots = held.splice(0);
			if (slots.length) await backend.releaseSlots(slots);
		},
	};
}

/**
 * In-process org pool with a mutex so two concurrent claim() calls cannot
 * both observe the same remaining count. Production uses SQL slot rows.
 */
export function createMemoryOrgPool(orgSlots = DAYTONA_ORG_SLOTS): () => OrgLease {
	let live = 0;
	let chain = Promise.resolve();
	const locked = async <T,>(fn: () => T | Promise<T>): Promise<T> => {
		const prior = chain;
		let unlock = () => { /* set below */ };
		chain = new Promise<void>((resolve) => { unlock = resolve; });
		await prior;
		try {
			return await fn();
		} finally {
			unlock();
		}
	};
	return () => {
		let held = 0;
		return {
			claim: (wanted) => locked(() => {
				const n = claimableSlots(wanted, live, orgSlots);
				live += n;
				held += n;
				return n;
			}),
			release: () => locked(() => {
				live = Math.max(0, live - held);
				held = 0;
			}),
		};
	};
}
