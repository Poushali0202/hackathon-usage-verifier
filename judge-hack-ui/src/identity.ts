import type { ConnectResult } from 'shell';
import type { ActorStamp } from './types';

export type { ActorStamp };

export function actorFrom(user: ConnectResult | null | undefined): ActorStamp | undefined {
	const userId = user?.userId;
	if (!userId) return undefined;
	const displayName = user.displayName || user.preferredUsername;
	return {
		userId,
		email: user.email,
		displayName: displayName || undefined,
	};
}
