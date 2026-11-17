<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Weekly summary · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	<header class="stack">
		<a class="back" href={resolve('/parent/(app)/settings')}>← Account</a>
		<h1>Weekly summary</h1>
		<p class="muted">{data.week}. This is what the weekly email says.</p>
	</header>

	{#if data.children.length === 0}
		<p>There are no children set up yet.</p>
	{/if}

	{#each data.children as child (child.name)}
		<section class="stack" aria-label={child.name}>
			<h2>{child.name}</h2>
			{#if child.lines.length > 0}
				<dl class="facts">
					{#each child.lines as [label, value] (label)}
						<dt>{label}</dt>
						<dd>{value}</dd>
					{/each}
				</dl>
			{/if}
			{#each child.notes as note (note)}
				<p>{note}</p>
			{/each}
		</section>
	{/each}
</div>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		inline-size: fit-content;
		min-block-size: var(--target-min);
	}

	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-4);
		margin: 0;
	}

	dt {
		font-weight: var(--weight-bold);
	}

	dd {
		margin: 0;
	}
</style>
