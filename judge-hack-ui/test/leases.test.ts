import { describe, expect, it } from 'vitest';
import { DAYTONA_ORG_SLOTS } from '../src/verify/pool';
import {
	ORG_BUSY_REASON,
	claimableSlots,
	createMemoryOrgPool,
	isOrgBusyError,
	isOrgBusyReason,
	OrgBusyError,
} from '../src/verify/leases';

describe('claimableSlots', () => {
	it('never exceeds the 5-box org wall', () => {
		expect(DAYTONA_ORG_SLOTS).toBe(5);
		expect(claimableSlots(3, 0)).toBe(3);
		expect(claimableSlots(3, 3)).toBe(2);
		expect(claimableSlots(3, 5)).toBe(0);
		expect(claimableSlots(2, 4)).toBe(1);
	});
});

describe('createMemoryOrgPool', () => {
	it('serializes two concurrent claims so 3+3 cannot become 6', async () => {
		const makeLease = createMemoryOrgPool(5);
		const a = makeLease();
		const b = makeLease();
		const [left, right] = await Promise.all([a.claim(3, 240), b.claim(3, 240)]);
		expect(left + right).toBe(5);
		expect(Math.max(left, right)).toBe(3);
		expect(Math.min(left, right)).toBe(2);
		await Promise.all([a.release(), b.release()]);
		const c = makeLease();
		expect(await c.claim(3, 240)).toBe(3);
		await c.release();
	});

	it('returns zero when the pool is already full', async () => {
		const makeLease = createMemoryOrgPool(5);
		const held = makeLease();
		expect(await held.claim(5, 240)).toBe(5);
		const extra = makeLease();
		expect(await extra.claim(1, 240)).toBe(0);
		await extra.release();
		await held.release();
		expect(await extra.claim(1, 240)).toBe(1);
		await extra.release();
	});
});

describe('org busy copy', () => {
	it('matches the modal and sheet reason', () => {
		expect(isOrgBusyReason(ORG_BUSY_REASON)).toBe(true);
		expect(isOrgBusyError(new OrgBusyError())).toBe(true);
		expect(isOrgBusyError(new Error('Daytona sandbox error'))).toBe(false);
	});
});
