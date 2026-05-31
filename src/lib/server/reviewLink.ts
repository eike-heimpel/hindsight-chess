import { sourceFor } from '$lib/review/sources';
import { normalize } from '$lib/review/normalize';
import { accountKey, type ReviewAccount, type ReviewError } from '$lib/review/types';
import { ok, type Result } from '$lib/result';
import { setUserActiveAccount, setUserReviewAccounts, type User } from './auth';
import { upsertGames } from './reviewGames';

/** Recent games pulled when a profile is first linked — matches the manual
 *  add-account import. */
const LINK_IMPORT_LIMIT = 50;

/**
 * The "link & import" domain operation: validate a profile against its platform,
 * store it on the user (if new), make it the active profile, and pull its recent
 * games. Shared by the account page's `addAccount` action and the post-login
 * `connect` endpoint so both behave identically. Validating via `listGames`
 * means a typo'd username fails here instead of becoming a phantom profile.
 */
export async function linkAccount(
	user: User,
	account: ReviewAccount
): Promise<Result<{ added: number }, ReviewError>> {
	const result = await sourceFor(account.source).listGames(account.username, {
		limit: LINK_IMPORT_LIMIT
	});
	if (!result.ok) return result;

	const exists = user.reviewAccounts.some((a) => accountKey(a) === accountKey(account));
	if (!exists) {
		await setUserReviewAccounts(user.userId, [...user.reviewAccounts, account]);
	}
	await setUserActiveAccount(user.userId, account);
	await upsertGames(result.value.map(normalize));
	return ok({ added: result.value.length });
}
