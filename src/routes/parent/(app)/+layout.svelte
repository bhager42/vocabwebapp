<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Button from '#lib/components/Button.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const links = [
		{ href: resolve('/parent/(app)'), label: 'Children', exact: true },
		{ href: resolve('/parent/(app)/words'), label: 'Word lists', exact: false },
		{ href: resolve('/parent/(app)/settings'), label: 'Account', exact: false }
	];

	const isCurrent = (href: string, exact: boolean) =>
		exact
			? page.url.pathname === href || page.url.pathname.startsWith(`${href}/children`)
			: page.url.pathname.startsWith(href);
</script>

<nav class="parent-nav" aria-label="Parent area">
	<ul>
		{#each links as link (link.href)}
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
				<a href={link.href} aria-current={isCurrent(link.href, link.exact) ? 'page' : undefined}>
					{link.label}
				</a>
			</li>
		{/each}
	</ul>
	<form method="POST" action={resolve('/parent/logout')}>
		<span class="visually-hidden">Signed in as {data.parent.username}.</span>
		<Button variant="quiet">Sign out</Button>
	</form>
</nav>

{@render children()}

<style>
	.parent-nav {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
		margin-block-end: var(--space-6);
		padding-block-end: var(--space-3);
		border-block-end: 2px solid var(--color-border);
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		display: inline-flex;
		align-items: center;
		min-block-size: var(--target-min);
		padding-inline: var(--space-4);
		border-radius: var(--radius-full);
		color: var(--color-text);
		font-weight: var(--weight-bold);
		text-decoration: none;
	}

	a:hover {
		background: var(--color-accent-soft);
	}

	a[aria-current='page'] {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		/* Not color alone: the current page is also underlined. */
		text-decoration: underline;
		text-decoration-thickness: 0.12em;
		text-underline-offset: 0.3em;
	}
</style>
