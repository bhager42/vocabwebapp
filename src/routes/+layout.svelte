<script lang="ts">
	import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
	import '#lib/styles/tokens.css';
	import '#lib/styles/base.css';
	import { version } from '$app/env';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const SOURCE_URL = 'https://github.com/bhager42/vocabwebapp';
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header">
	<a class="wordmark" href={resolve('/')}>Vocab</a>
	<ThemeToggle theme={data.theme} />
</header>

<main id="main" tabindex="-1">
	{@render children()}
</main>

<footer class="site-footer">
	<!-- The AGPL asks that everyone using the app over a network can get its source. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external site, not an app route -->
	Vocab {version} · <a href={SOURCE_URL}>Source code</a> · AGPL-3.0-or-later
</footer>
