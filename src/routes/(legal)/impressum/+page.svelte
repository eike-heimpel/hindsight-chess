<script lang="ts">
	import { company, LEGAL_UPDATED } from '$lib/legal';
</script>

<svelte:head>
	<title>Imprint — {company.product}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<h1>Imprint / Impressum</h1>
<p class="updated">Information pursuant to § 5 DDG (Digitale-Dienste-Gesetz)</p>

<address class="address">
	<strong>{company.name}</strong><br />
	{company.street}<br />
	{company.city}<br />
	{company.country}
</address>

<h2>Represented by</h2>
<p>Managing Director (Geschäftsführer): {company.managingDirector}</p>

<h2>Contact</h2>
<p>Email: <a href="mailto:{company.email}">{company.email}</a></p>

<h2>Commercial register</h2>
<p>
	Registered at {company.registerCourt}<br />
	Registration number: {company.register}
</p>

<h2>VAT identification number</h2>
<p>
	VAT ID pursuant to § 27a UStG (Umsatzsteuergesetz): {company.vatId}
</p>

<h2>Responsible for content pursuant to § 18 (2) MStV</h2>
<p>
	{company.managingDirector}, address as above.
</p>

<h2>EU dispute resolution</h2>
<p>
	The European Commission provides a platform for online dispute resolution (ODR):
	<a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noreferrer"
		>https://ec.europa.eu/consumers/odr</a
	>. We are neither willing nor obliged to participate in dispute resolution proceedings before a
	consumer arbitration board.
</p>

<h2>Liability for content</h2>
<p>
	As a service provider we are responsible for our own content on these pages in accordance with § 7
	(1) DDG under general law. Pursuant to §§ 8 to 10 DDG, however, we are not obliged to monitor
	transmitted or stored third-party information, or to investigate circumstances that indicate
	illegal activity. Obligations to remove or block the use of information under general law remain
	unaffected. Liability in this respect is only possible from the point in time at which we become
	aware of a specific infringement. Upon becoming aware of such infringements, we will remove the
	content concerned without delay.
</p>

<h2>Liability for links</h2>
<p>
	Our offer contains links to external third-party websites over whose content we have no control.
	We therefore cannot accept any liability for this third-party content. The respective provider or
	operator of the linked pages is always responsible for their content. The linked pages were
	checked for possible legal violations at the time of linking; no illegal content was apparent at
	that time. Permanent monitoring of the content of linked pages is not reasonable without concrete
	evidence of an infringement. Upon becoming aware of legal violations, we will remove such links
	without delay.
</p>

<h2>Copyright</h2>
<p>
	The content and works created by the site operator on these pages are subject to German copyright
	law. Reproduction, processing, distribution and any kind of use outside the limits of copyright
	law require the written consent of the respective author or creator. Insofar as the content on
	this site was not created by the operator, the copyrights of third parties are respected. Should
	you nevertheless become aware of a copyright infringement, please notify us accordingly; upon
	becoming aware of such infringements, we will remove the content concerned without delay.
</p>

<p class="updated">Last updated: {LEGAL_UPDATED}</p>
