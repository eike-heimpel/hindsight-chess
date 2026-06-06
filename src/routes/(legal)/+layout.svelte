<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve --
	 * Static internal nav back to the landing; resolve() adds noise without value. */
	let { children } = $props();
</script>

<main class="mx-auto w-full max-w-3xl px-6 pt-8 pb-20">
	<a
		href="/"
		class="font-display text-base font-medium tracking-tight text-text-2 transition-colors hover:text-text"
	>
		Hindsight<span class="text-brand">.</span>
	</a>

	<article class="legal mt-8">
		{@render children()}
	</article>
</main>

<style>
	/* Plain, readable long-form prose styled with the app's semantic tokens, so
	   it tracks the dark/light theme. Children are rendered through a snippet, so
	   the element rules need :global to reach them. */
	.legal :global(h1) {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		line-height: var(--text-2xl--line-height);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text);
	}

	.legal :global(h2) {
		font-size: var(--text-lg);
		line-height: var(--text-lg--line-height);
		font-weight: 600;
		color: var(--text);
		margin-top: 2rem;
	}

	.legal :global(h3) {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text);
		margin-top: 1.25rem;
	}

	.legal :global(p),
	.legal :global(li) {
		font-size: var(--text-base);
		line-height: 1.6;
		color: var(--text-2);
	}

	.legal :global(p) {
		margin-top: 0.75rem;
	}

	.legal :global(ul) {
		margin-top: 0.5rem;
		padding-left: 1.25rem;
		list-style: disc;
	}

	.legal :global(li) {
		margin-top: 0.25rem;
	}

	.legal :global(strong) {
		color: var(--text);
		font-weight: 600;
	}

	.legal :global(a) {
		color: var(--brand);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.legal :global(a:hover) {
		color: var(--brand-hover);
	}

	.legal :global(.updated) {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin-top: 0.5rem;
	}

	.legal :global(.address) {
		font-style: normal;
		margin-top: 0.75rem;
		color: var(--text-2);
		line-height: 1.6;
	}
</style>
