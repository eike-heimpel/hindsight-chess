<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Game links are runtime-built hrefs carrying a ?me query string; resolve()
	 * handles route patterns but hurts readability here (same call shape as the
	 * catalogue's /train/aufgabe/[id] links). */
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

	type Game = PageData['games'][number];
	type Account = PageData['reviewAccounts'][number];
	type Source = Account['source'];

	const accountKey = (a: Account) => `${a.source}:${a.username}`;
	const platformLabel = (s: Source) => (s === 'lichess' ? 'Lichess' : 'Chess.com');

	const SOURCES: { value: Source; label: string }[] = [
		{ value: 'chesscom', label: 'Chess.com' },
		{ value: 'lichess', label: 'Lichess' }
	];

	// Platform for the link form: a visible toggle (chess.com ↔ lichess) carried
	// into the POST by a hidden input. `use:enhance` keeps the component mounted
	// across a failed submit, so the chosen platform survives the round-trip.
	let linkSource = $state<Source>('chesscom');
	let importing = $state(false);

	const me = $derived(data.account?.username ?? '');

	function opponentOf(g: Game) {
		return g.white.username.toLowerCase() === me ? g.black : g.white;
	}

	function youAreWhite(g: Game) {
		return g.white.username.toLowerCase() === me;
	}

	function outcome(g: Game): { label: string; style: string } {
		if (g.result === '1/2-1/2')
			return {
				label: 'Draw',
				style: 'background: color-mix(in srgb, var(--draw) 22%, transparent); color: var(--text-2);'
			};
		const whiteWon = g.result === '1-0';
		const won = youAreWhite(g) ? whiteWon : !whiteWon;
		return won
			? {
					label: 'Won',
					style: 'background: color-mix(in srgb, var(--good) 16%, transparent); color: var(--good);'
				}
			: {
					label: 'Lost',
					style: 'background: color-mix(in srgb, var(--bad) 16%, transparent); color: var(--bad);'
				};
	}
</script>

<svelte:head><title>Your games</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8">
	<header class="mb-6 flex items-baseline justify-between gap-4">
		<h1 class="text-2xl font-bold text-text">Your games</h1>
		<nav class="flex items-center gap-4 text-sm">
			<a href="/review/stats" class="font-medium text-text-2 hover:text-text">Stats</a>
			<a href="/" class="text-text-muted hover:text-text-2">← Home</a>
		</nav>
	</header>

	<section class="mb-6">
		{#if data.reviewAccounts.length > 0}
			<div class="mb-4 flex flex-wrap items-center gap-2">
				{#each data.reviewAccounts as acct (accountKey(acct))}
					{@const active = data.account && accountKey(acct) === accountKey(data.account)}
					<span
						class="flex items-center rounded-full border py-1 pr-1 pl-1 text-sm transition-colors {active
							? 'border-border-strong bg-surface-3 text-text ring-1 ring-brand/40'
							: 'border-border bg-surface-1 text-text-2'}"
					>
						<form method="POST" action="?/selectAccount" class="contents">
							<input type="hidden" name="source" value={acct.source} />
							<input type="hidden" name="username" value={acct.username} />
							<button
								type="submit"
								title={active ? 'Active profile' : `Switch to ${acct.username}`}
								class="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium"
							>
								<span
									class="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase {acct.source ===
									'lichess'
										? 'bg-text/10 text-text-2'
										: 'bg-good/15 text-good'}">{platformLabel(acct.source)}</span
								>
								{acct.username}
							</button>
						</form>
						<span class="mx-1 h-4 w-px bg-border" aria-hidden="true"></span>
						<form method="POST" action="?/sync" class="contents">
							<input type="hidden" name="source" value={acct.source} />
							<input type="hidden" name="username" value={acct.username} />
							<button
								type="submit"
								title="Pull new games since the last sync"
								class="rounded-full px-2 py-0.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text-2"
								>↻ Sync</button
							>
						</form>
						<form method="POST" action="?/syncAll" class="contents">
							<input type="hidden" name="source" value={acct.source} />
							<input type="hidden" name="username" value={acct.username} />
							<button
								type="submit"
								title="Re-pull the full game history (back-fills older games)"
								class="rounded-full px-2 py-0.5 text-xs text-text-muted hover:bg-surface-2 hover:text-text-2"
								>⤓ All</button
							>
						</form>
						<form method="POST" action="?/removeAccount" class="contents">
							<input type="hidden" name="source" value={acct.source} />
							<input type="hidden" name="username" value={acct.username} />
							<button
								type="submit"
								title="Unlink profile"
								class="rounded-full px-1.5 py-0.5 text-xs text-text-muted hover:bg-surface-2 hover:text-bad"
								>✕</button
							>
						</form>
					</span>
				{/each}
			</div>
		{/if}

		<form
			method="POST"
			action="?/addAccount"
			use:enhance={() => {
				importing = true;
				return async ({ update }) => {
					await update();
					importing = false;
				};
			}}
			class="rounded-2xl border border-border bg-surface-1 p-3"
		>
			<div class="mb-2 text-xs font-medium text-text-muted">
				{data.reviewAccounts.length > 0 ? 'Link another profile' : 'Link a profile to get started'}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<!-- Platform toggle: clearly switchable; value rides the hidden input. -->
				<div class="flex rounded-lg border border-border bg-surface-2 p-0.5">
					{#each SOURCES as s (s.value)}
						<button
							type="button"
							onclick={() => (linkSource = s.value)}
							aria-pressed={linkSource === s.value}
							class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {linkSource ===
							s.value
								? 'bg-surface-3 text-text shadow-sm'
								: 'text-text-muted hover:text-text-2'}"
						>
							{s.label}
						</button>
					{/each}
				</div>
				<input type="hidden" name="source" value={linkSource} />
				<input
					name="username"
					placeholder="{platformLabel(linkSource)} username"
					value={form?.username ?? ''}
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					class="min-w-40 flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-text focus:border-border-strong focus:outline-none"
				/>
				<button
					type="submit"
					disabled={importing}
					class="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
				>
					{importing ? 'Importing…' : 'Link & import'}
				</button>
			</div>
		</form>
	</section>

	{#if form?.message}
		<p
			class="mb-4 rounded-lg px-3 py-2 text-sm text-bad"
			style="background: color-mix(in srgb, var(--bad) 12%, transparent);"
		>
			{form.message}
		</p>
	{/if}

	{#if data.synced !== null}
		<p
			class="mb-4 rounded-lg px-3 py-2 text-sm text-good"
			style="background: color-mix(in srgb, var(--good) 12%, transparent);"
		>
			{data.synced === 0 ? 'Already up to date.' : `Synced ${data.synced} new game(s).`}
		</p>
	{/if}

	{#if data.account && data.games.length === 0}
		<p class="text-text-muted">
			No games found for “{data.account.username}” on {platformLabel(data.account.source)} yet. Play
			a game there, then hit ↻ Sync — or try ⤓ All to back-fill older history.
		</p>
	{:else if data.account && data.games.length > 0}
		<p class="mb-3 text-sm text-text-muted">
			{data.games.length} recent games for “{data.account.username}” on {platformLabel(
				data.account.source
			)}
		</p>
		<ul class="space-y-2">
			{#each data.games as g (g.source + g.gameId)}
				{@const opp = opponentOf(g)}
				{@const oc = outcome(g)}
				<li>
					<a
						href="/review/{g.source}/{g.gameId}?me={encodeURIComponent(me)}"
						class="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-2"
					>
						<span
							class="w-12 shrink-0 rounded-md px-2 py-1 text-center text-xs font-semibold"
							style={oc.style}
						>
							{oc.label}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium text-text">
								vs {opp.username}{opp.rating ? ` (${opp.rating})` : ''}
								<span class="font-normal text-text-muted"
									>· {youAreWhite(g) ? 'White' : 'Black'}</span
								>
							</span>
							<span class="block truncate text-sm text-text-muted">
								{g.opening ?? 'Unknown opening'}
							</span>
						</span>
						<span class="shrink-0 text-right text-xs text-text-muted">
							<span class="block capitalize">{g.timeClass} · {g.plies} ply</span>
							<span class="block">{dateFmt.format(new Date(g.playedAt))}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-text-muted">
			Link a chess.com or lichess profile above to import and review games.
		</p>
	{/if}
</main>
