<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const summary = $derived(data.summary);
	const stars = $derived(summary.results.filter(Boolean).length);
	const total = $derived(summary.results.length);
</script>

<svelte:head>
	<title>All done · Vocab</title>
</svelte:head>

<div class="done stack-lg">
	<h1>Great work, {data.name}!</h1>

	<!-- One star per question; the sentence underneath says the same thing in words. -->
	<div class="stars" aria-hidden="true">
		{#each summary.results as earned, index (index)}
			<span class="star" class:earned><Icon name="star" /></span>
		{/each}
	</div>
	<p class="lead">
		You earned <strong>{stars} {stars === 1 ? 'star' : 'stars'}</strong>: you got {stars} out of
		{total} right.
	</p>

	<ul class="facts">
		{#if summary.newWords > 0}
			<li>
				You met <strong>{summary.newWords}</strong> new {summary.newWords === 1 ? 'word' : 'words'}
				today.
			</li>
		{/if}
		{#if summary.streak > 1}
			<li>You have practiced <strong>{summary.streak}</strong> days in a row.</li>
		{:else}
			<li>Come back tomorrow to start a streak.</li>
		{/if}
	</ul>

	{#if !summary.canPracticeAgain}
		<p class="notice notice-ok">That is enough for today. Come back tomorrow!</p>
	{/if}

	<div class="actions">
		<Button size="lg" href={resolve('/')}>All done</Button>
		{#if summary.canPracticeAgain}
			<form method="POST" action="{resolve('/play')}?/start">
				<Button variant="secondary">Practice some more</Button>
			</form>
		{/if}
	</div>
</div>

<style>
	.done {
		max-inline-size: 36rem;
	}

	.stars {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--text-xl);
	}

	.star {
		color: var(--color-border-strong);
	}

	.star.earned {
		color: var(--color-star);
	}

	.star.earned :global(svg) {
		fill: currentColor;
	}

	.lead {
		font-size: var(--text-lg);
	}

	.facts {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding-inline-start: 1.25em;
	}
</style>
