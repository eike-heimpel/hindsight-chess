<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Game links are runtime-built hrefs carrying a ?me query string; resolve()
	 * handles route patterns but hurts readability here (same call shape as the
	 * catalogue's /train/aufgabe/[id] links). */
	import type { PageData } from './$types';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data }: { data: PageData } = $props();

	const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

	type Game = PageData['games'][number];

	const platformLabel = (s: string) => (s === 'lichess' ? 'Lichess' : 'Chess.com');

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
	<PageHeader title="Your games" back={{ href: '/home', label: 'Home' }}>
		{#snippet actions()}
			<a href="/review/stats" class="-my-1.5 py-1.5 font-medium text-text-2 hover:text-text"
				>Stats</a
			>
		{/snippet}
	</PageHeader>

	{#if data.account}
		<div class="mb-6 flex items-center gap-2 text-sm">
			<span
				class="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase {data.account
					.source === 'lichess'
					? 'bg-text/10 text-text-2'
					: 'bg-good/15 text-good'}">{platformLabel(data.account.source)}</span
			>
			<span class="font-medium text-text-2">{data.account.username}</span>
			<a href="/account" class="-my-1.5 ml-auto py-1.5 text-text-muted hover:text-text-2"
				>Manage accounts →</a
			>
		</div>
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
			No games found for “{data.account.username}” on {platformLabel(data.account.source)} yet. Play a
			game there, then <a href="/account" class="text-brand hover:underline">sync from Accounts</a> to
			pull them in.
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
			<a href="/account" class="text-brand hover:underline">Connect a profile</a> to import and review
			games.
		</p>
	{/if}
</main>
