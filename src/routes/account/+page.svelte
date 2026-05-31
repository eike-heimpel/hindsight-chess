<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static internal nav links; resolve() adds noise without value here (same
	 * posture as the other route files). */
	import ConnectProfile from '$lib/review/ConnectProfile.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

	const platformLabel = (s: string) => (s === 'lichess' ? 'Lichess' : 'Chess.com');

	function syncedLabel(d: Date | null): string {
		if (!d) return 'never synced';
		const mins = Math.round((d.getTime() - Date.now()) / 60_000);
		if (mins > -60) return `synced ${rtf.format(Math.min(mins, 0), 'minute')}`;
		const hours = Math.round(mins / 60);
		if (hours > -24) return `synced ${rtf.format(hours, 'hour')}`;
		return `synced ${dateFmt.format(d)}`;
	}
</script>

<svelte:head><title>Your accounts · Hindsight</title></svelte:head>

<main class="mx-auto max-w-2xl px-5 py-8">
	<header class="mb-6 flex items-baseline justify-between gap-4">
		<h1 class="text-2xl font-bold text-text">Your accounts</h1>
		<nav class="flex items-center gap-4 text-sm">
			<a href="/review" class="font-medium text-text-2 hover:text-text">Your games</a>
			<a href="/home" class="text-text-muted hover:text-text-2">← Home</a>
		</nav>
	</header>

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

	{#if data.accounts.length > 0}
		<section class="mb-8">
			<h2 class="mb-3 text-sm font-medium tracking-wide text-text-muted">Connected profiles</h2>
			<div class="space-y-3">
				{#each data.accounts as a (a.account.source + ':' + a.account.username)}
					<div
						class="rounded-xl border bg-surface-1 p-4 {a.active
							? 'border-border-strong ring-1 ring-brand/40'
							: 'border-border'}"
					>
						<div class="flex items-center gap-3">
							<span
								class="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase {a
									.account.source === 'lichess'
									? 'bg-text/10 text-text-2'
									: 'bg-good/15 text-good'}">{platformLabel(a.account.source)}</span
							>
							<span class="min-w-0 flex-1 truncate font-medium text-text">{a.account.username}</span
							>
							{#if a.active}
								<span class="shrink-0 text-xs font-medium text-brand">Active</span>
							{:else}
								<form method="POST" action="?/selectAccount" class="shrink-0">
									<input type="hidden" name="source" value={a.account.source} />
									<input type="hidden" name="username" value={a.account.username} />
									<button
										type="submit"
										class="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text-2"
										>Make active</button
									>
								</form>
							{/if}
						</div>

						<div class="mt-3 flex items-center justify-between gap-3">
							<span class="text-xs text-text-muted tabular-nums">
								{a.gamesCount} game{a.gamesCount === 1 ? '' : 's'} · {syncedLabel(a.lastSyncedAt)}
							</span>
							<div class="flex items-center gap-1">
								<form method="POST" action="?/sync">
									<input type="hidden" name="source" value={a.account.source} />
									<input type="hidden" name="username" value={a.account.username} />
									<button
										type="submit"
										title="Pull new games since the last sync"
										class="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text-2"
										>↻ Sync</button
									>
								</form>
								<form method="POST" action="?/syncAll">
									<input type="hidden" name="source" value={a.account.source} />
									<input type="hidden" name="username" value={a.account.username} />
									<button
										type="submit"
										title="Re-pull the full game history (back-fills older games)"
										class="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text-2"
										>⤓ Backfill</button
									>
								</form>
								<form method="POST" action="?/removeAccount">
									<input type="hidden" name="source" value={a.account.source} />
									<input type="hidden" name="username" value={a.account.username} />
									<button
										type="submit"
										title="Unlink profile"
										class="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-bad"
										>✕ Remove</button
									>
								</form>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section>
		<h2 class="mb-3 text-sm font-medium tracking-wide text-text-muted">
			{data.accounts.length > 0 ? 'Add another profile' : 'Connect a profile'}
		</h2>
		<ConnectProfile mode="link" action="?/addAccount" />
	</section>
</main>
