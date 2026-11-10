<script lang="ts">
	import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
	import '#lib/styles/tokens.css';
	import '#lib/styles/base.css';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
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
