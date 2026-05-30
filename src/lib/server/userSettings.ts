import { collectionAccessor } from './db.ts';

/**
 * Per-user app settings, keyed by Better Auth's `userId` (`_id`). Mirrors
 * `reviewAccounts.ts`: a user has no doc until something is set, so
 * `getUserSettings` returns the defaults — LLM "story" headlines ON by default.
 * `setUserSettings` is the seam the (future) settings page writes through;
 * nothing calls it yet.
 */
export type UserSettings = {
	llmHeadlines: boolean;
};

const DEFAULTS: UserSettings = { llmHeadlines: true };

type UserSettingsDoc = UserSettings & { _id: string; updatedAt: Date };

const collection = collectionAccessor<UserSettingsDoc>('userSettings');

export async function getUserSettings(userId: string): Promise<UserSettings> {
	const c = await collection();
	const doc = await c.findOne({ _id: userId });
	if (!doc) return { ...DEFAULTS };
	return { llmHeadlines: doc.llmHeadlines };
}

export async function setUserSettings(userId: string, patch: Partial<UserSettings>): Promise<void> {
	const c = await collection();
	await c.updateOne(
		{ _id: userId },
		{ $set: { ...patch, updatedAt: new Date() } },
		{ upsert: true }
	);
}
