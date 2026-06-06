<script lang="ts">
	import { company, LEGAL_UPDATED } from '$lib/legal';
</script>

<svelte:head>
	<title>Privacy Policy — {company.product}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<h1>Privacy Policy</h1>
<p class="updated">How {company.product} handles your data, under the GDPR.</p>

<h2>Who is responsible</h2>
<p>
	The controller responsible for the processing of your personal data on this service is:
</p>
<address class="address">
	<strong>{company.name}</strong><br />
	{company.street}, {company.city}, {company.country}<br />
	Email: <a href="mailto:{company.email}">{company.email}</a>
</address>

<h2>What we process, and why</h2>
<p>We keep data collection to what the service actually needs.</p>

<h3>Your account and sign-in</h3>
<p>
	We sign you in with a magic link sent to your email address — there is no password. We store your
	email address and basic account record to operate your account and send the sign-in link. Legal
	basis: performance of our service (Art. 6 (1)(b) GDPR).
</p>

<h3>Your linked chess accounts and games</h3>
<p>
	When you connect a chess.com or Lichess username, we fetch and store your games from those
	platforms so we can analyse them and show your review. This includes the username, the moves, and
	game metadata (result, time control, dates). Legal basis: performance of our service (Art. 6
	(1)(b) GDPR).
</p>

<h3>Move explanations (the coach)</h3>
<p>
	When you ask the coach to explain a move, the relevant chess position and the engine's analysis
	are sent to our language-model provider to generate a plain-English explanation. We do not send
	your email address or account identity with these requests. Legal basis: performance of our
	service (Art. 6 (1)(b) GDPR).
</p>

<h3>Hosting and server logs</h3>
<p>
	Our hosting provider processes technical request data (such as your IP address, browser type and
	access times) to deliver the service and keep it secure. Legal basis: our legitimate interest in
	operating a secure, functioning service (Art. 6 (1)(f) GDPR).
</p>

<h2>Who we share data with (processors)</h2>
<p>
	We do not sell your data. We use the following providers strictly to run the service, each bound
	by a data-processing agreement:
</p>
<ul>
	<li><strong>Vercel</strong> — hosting and server logs.</li>
	<li><strong>MongoDB Atlas</strong> — database for your account, linked games and analysis.</li>
	<li><strong>Postmark</strong> — delivery of the sign-in email.</li>
	<li>
		<strong>OpenRouter</strong> (routing to <strong>Google</strong>'s Gemini models) — generating
		move explanations.
	</li>
	<li>
		<strong>chess.com</strong> and <strong>Lichess</strong> — the sources we fetch your games from,
		at your request.
	</li>
</ul>

<h2>International transfers</h2>
<p>
	Some of these providers process data outside the EU/EEA, including in the United States. Where
	that happens, the transfer is covered by appropriate safeguards such as the EU Standard
	Contractual Clauses or an applicable adequacy decision.
</p>

<h2>How long we keep it</h2>
<p>
	We keep your account, linked games and analysis for as long as your account exists. You can ask us
	to delete your account and associated data at any time, after which we remove it (subject to any
	legal retention obligations). Server logs are retained only for a short period for security and
	troubleshooting.
</p>

<h2>Cookies</h2>
<p>
	We use only essential cookies needed to keep you signed in. We do not use advertising cookies or
	third-party tracking, and we run no analytics that profiles you — so there is no cookie consent
	banner because none is required.
</p>

<h2>Your rights</h2>
<p>Under the GDPR you have the right to:</p>
<ul>
	<li>access the personal data we hold about you;</li>
	<li>have inaccurate data corrected;</li>
	<li>have your data erased;</li>
	<li>restrict or object to processing;</li>
	<li>receive your data in a portable format;</li>
	<li>
		lodge a complaint with a supervisory authority (in our case, the data protection authority of
		Baden-Württemberg, Germany).
	</li>
</ul>
<p>
	To exercise any of these rights, email us at <a href="mailto:{company.email}">{company.email}</a>.
</p>

<h2>Changes to this policy</h2>
<p>
	We may update this policy to reflect changes to the service or the law. The current version always
	lives at this page.
</p>

<p class="updated">Last updated: {LEGAL_UPDATED}</p>
