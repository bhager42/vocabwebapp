<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const summary = $derived(data.summary);
</script>

<svelte:head>
	<title>Story done · Vocab</title>
</svelte:head>

<div class="done stack-lg">
	<h1>Well done, {data.name}!</h1>
	<p class="lead">
		You finished <strong>{summary.title}</strong> and got
		<strong>{summary.right} of {summary.total}</strong>
		questions right.
	</p>

	{#if summary.finishedGrade !== null}
		<p class="notice notice-ok">
			That was the last one. You have read all the grade {summary.finishedGrade} stories! Talk to a grown-up
			about what to read next.
		</p>
	{:else if !summary.canReadAgain}
		<p class="notice notice-ok">That is enough for today. Come back tomorrow!</p>
	{/if}

	<div class="actions">
		<Button size="lg" href={resolve('/')}>All done</Button>
		{#if summary.canReadAgain}
			<form method="POST" action="{resolve('/play/read')}?/start">
				<Button variant="secondary">Read another story</Button>
			</form>
		{/if}
	</div>
</div>

<style>
	.done {
		max-inline-size: 40rem;
	}

	.lead {
		font-size: var(--text-lg);
	}
</style>
