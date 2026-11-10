<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const id = $derived(String(data.child.id));
	const tabs = $derived([
		{ href: resolve('/parent/(app)/children/[id]/progress', { id }), label: 'Progress' },
		{ href: resolve('/parent/(app)/children/[id]/sessions', { id }), label: 'Sessions' },
		{ href: resolve('/parent/(app)/children/[id]/words', { id }), label: 'Words' },
		{ href: resolve('/parent/(app)/children/[id]', { id }), label: 'Settings' }
	]);

	// Settings lives at the bare address, which every other tab's address starts with.
	const isCurrent = (href: string, index: number) =>
		index === tabs.length - 1 ? page.url.pathname === href : page.url.pathname.startsWith(href);
</script>

<div class="child-nav">
	<a class="back" href={resolve('/parent/(app)')}>← All children</a>
	<nav aria-label={data.child.name}>
		<ul>
			{#each tabs as tab, index (tab.href)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
					<a href={tab.href} aria-current={isCurrent(tab.href, index) ? 'page' : undefined}>
						{tab.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
</div>

{@render children()}

<style>
	.child-nav {
		display: grid;
		gap: var(--space-2);
		margin-block-end: var(--space-5);
	}

	.back {
		display: inline-flex;
		align-items: center;
		inline-size: fit-content;
		min-block-size: var(--target-min);
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li a {
		display: inline-flex;
		align-items: center;
		min-block-size: var(--target-min);
		padding-inline: var(--space-4);
		border: 2px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		color: var(--color-text);
		font-weight: var(--weight-bold);
		text-decoration: none;
	}

	li a:hover {
		background: var(--color-accent-soft);
	}

	li a[aria-current='page'] {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		/* Not color alone: the current tab is also underlined. */
		text-decoration: underline;
		text-decoration-thickness: 0.12em;
		text-underline-offset: 0.3em;
	}
</style>
