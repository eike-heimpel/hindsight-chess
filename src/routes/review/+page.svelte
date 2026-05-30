<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Game links are runtime-built hrefs carrying a ?me query string; resolve()
	 * handles route patterns but hurts readability here (same call shape as the
	 * catalogue's /train/aufgabe/[id] links). */
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

	type Game = PageData['games'][number];

	function opponentOf(g: Game) {
		return g.white.username.toLowerCase() === data.account ? g.black : g.white;
	}

	function youAreWhite(g: Game) {
		return g.white.username.toLowerCase() === data.account;
	}

	function outcome(g: Game): { label: string; cls: string } {
		if (g.result === '1/2-1/2') return { label: 'Draw', cls: 'bg-stone-200 text-stone-700' };
		const whiteWon = g.result === '1-0';
		const won = youAreWhite(g) ? whiteWon : !whiteWon;
		return won
			? { label: 'Won', cls: 'bg-emerald-100 text-emerald-800' }
			: { label: 'Lost', cls: 'bg-rose-100 text-rose-800' };
	}
</script>

<svelte:head><title>Game Review</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8">
	<header class="mb-6 flex items-baseline justify-between gap-4">
		<h1 class="text-2xl font-bold text-stone-800">Game Review</h1>
		<nav class="flex items-center gap-4 text-sm">
			<a href="/review/stats" class="font-medium text-stone-600 hover:text-stone-800">Stats</a>
			<a href="/" class="text-stone-500 hover:text-stone-700">← Home</a>
		</nav>
	</header>

	<section class="mb-6">
		{#if data.reviewAccounts.length > 0}
			<div class="mb-3 flex flex-wrap items-center gap-2">
				{#each data.reviewAccounts as acct (acct)}
					{@const active = acct === data.account}
					<span
						class="flex items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-sm {active
							? 'border-stone-800 bg-stone-800 text-white'
							: 'border-stone-300 bg-white text-stone-700'}"
					>
						<a href="/review?user={encodeURIComponent(acct)}" class="font-medium">{acct}</a>
						<form method="POST" action="?/sync" class="contents">
							<input type="hidden" name="username" value={acct} />
							<button
								type="submit"
								title="Pull new games since the last sync"
								class="rounded-full px-2 py-0.5 text-xs {active
									? 'hover:bg-white/20'
									: 'text-stone-500 hover:bg-stone-100'}">↻ Sync</button
							>
						</form>
						<form method="POST" action="?/syncAll" class="contents">
							<input type="hidden" name="username" value={acct} />
							<button
								type="submit"
								title="Re-pull the full game history (back-fills older games)"
								class="rounded-full px-2 py-0.5 text-xs {active
									? 'hover:bg-white/20'
									: 'text-stone-500 hover:bg-stone-100'}">⤓ All</button
							>
						</form>
						<form method="POST" action="?/removeAccount" class="contents">
							<input type="hidden" name="username" value={acct} />
							<button
								type="submit"
								title="Unlink account"
								class="rounded-full px-1.5 py-0.5 text-xs {active
									? 'hover:bg-white/20'
									: 'text-stone-400 hover:bg-stone-100'}">✕</button
							>
						</form>
					</span>
				{/each}
			</div>
		{/if}

		<form method="POST" action="?/addAccount" class="flex flex-wrap items-center gap-2">
			<input
				name="username"
				placeholder="link a chess.com username"
				value={form?.username ?? ''}
				autocomplete="off"
				class="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-stone-800 focus:border-stone-500 focus:outline-none"
			/>
			<button
				type="submit"
				class="rounded-lg bg-stone-800 px-4 py-2 font-medium text-white hover:bg-stone-700"
			>
				Link account
			</button>
		</form>
	</section>

	{#if form?.message}
		<p class="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{form.message}</p>
	{/if}

	{#if data.synced !== null}
		<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
			{data.synced === 0 ? 'Already up to date.' : `Synced ${data.synced} new game(s).`}
		</p>
	{/if}

	{#if data.account && data.games.length === 0}
		<p class="text-stone-500">
			No games stored for “{data.account}”. Hit ↻ Sync on the account chip to pull them.
		</p>
	{:else if data.games.length > 0}
		<p class="mb-3 text-sm text-stone-500">
			{data.games.length} recent games for “{data.account}”
		</p>
		<ul class="space-y-2">
			{#each data.games as g (g.source + g.gameId)}
				{@const opp = opponentOf(g)}
				{@const oc = outcome(g)}
				<li>
					<a
						href="/review/{g.source}/{g.gameId}?me={data.account}"
						class="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 transition-colors hover:border-stone-300 hover:bg-stone-50"
					>
						<span
							class="w-12 shrink-0 rounded-md px-2 py-1 text-center text-xs font-semibold {oc.cls}"
						>
							{oc.label}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium text-stone-800">
								vs {opp.username}{opp.rating ? ` (${opp.rating})` : ''}
								<span class="font-normal text-stone-400"
									>· {youAreWhite(g) ? 'White' : 'Black'}</span
								>
							</span>
							<span class="block truncate text-sm text-stone-500">
								{g.opening ?? 'Unknown opening'}
							</span>
						</span>
						<span class="shrink-0 text-right text-xs text-stone-400">
							<span class="block capitalize">{g.timeClass} · {g.plies} ply</span>
							<span class="block">{dateFmt.format(new Date(g.playedAt))}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-stone-500">Link a chess.com account above to import and review games.</p>
	{/if}
</main>
