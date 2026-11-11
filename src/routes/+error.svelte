<script lang="ts">
	import { page } from '$app/state';

	// SvelteKit refuses a form sent from an address other than ORIGIN with this message.
	// Nearly always that is because the app was opened at another address, so say which.
	const wrongAddress = $derived(
		page.status === 403 && /^Cross-site \w+ form submissions/.test(page.error?.message ?? '')
	);
	const expected = $derived(page.data.origin as string | undefined);
</script>

<svelte:head>
	<title>{wrongAddress ? 'Wrong address' : `Error ${page.status}`} · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	{#if wrongAddress && expected}
		<header class="stack">
			<h1>This app is set up for a different address</h1>
			<p>
				The form was refused because this page was opened at
				<strong class="address">{page.url.origin}</strong>, but the app is set up to be used at
				<strong class="address">{expected}</strong>.
			</p>
		</header>

		<section class="stack" aria-labelledby="fix">
			<h2 id="fix">What to do</h2>
			<ul class="stack">
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a full address on purpose: it leaves this one -->
					<a href={expected}>Open the app at {expected}</a> and try again.
				</li>
				<li>
					If {page.url.origin} is the address you want to use, change <code>ORIGIN</code> in the
					app’s settings to exactly <strong class="address">{page.url.origin}</strong> and save. On
					TrueNAS that is in <strong>Apps → vocab → Edit</strong>. The app restarts, then this page
					works.
				</li>
			</ul>
			<p class="muted">
				The two must match character for character: http and https count as different, and so do a
				name and a number for the same machine.
			</p>
		</section>
	{:else}
		<h1>{page.status}</h1>
		<p>{page.error?.message}</p>
	{/if}
</div>

<style>
	.address {
		overflow-wrap: anywhere;
	}

	ul {
		padding-inline-start: 1.25em;
	}
</style>
