<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Field from '#lib/components/Field.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Vocab</title>
</svelte:head>

<div class="door stack-lg">
	{#if data.child}
		{@const child = data.child}
		<header>
			<h1>Hi, {child.name}!</h1>
			{#if child.streak > 1}
				<p class="lead">You have practiced {child.streak} days in a row. Keep it up!</p>
			{:else if child.status !== 'capped'}
				<p class="lead">Ready to learn some words?</p>
			{/if}
		</header>

		{#if child.nothingToPractice}
			<p class="notice notice-info">
				There are no words to practice yet. Ask a grown-up to check your word lists.
			</p>
		{/if}

		{#if child.status === 'capped'}
			<p class="notice notice-ok">Great work today! You are all done. Come back tomorrow.</p>
		{:else}
			<form method="POST" action="{resolve('/play')}?/start">
				<Button size="lg">{child.status === 'resume' ? 'Keep going' : 'Start practicing'}</Button>
			</form>
		{/if}

		<form method="POST" action="?/switch" class="switch">
			<span>Not {child.name}?</span>
			<Button variant="quiet">Switch</Button>
		</form>
	{:else}
		<h1>What's your name?</h1>

		<form method="POST" action="?/enter" class="stack" use:enhance>
			<Field
				label="Your first name"
				name="name"
				autocomplete="off"
				autocapitalize="words"
				spellcheck="false"
				required
				maxlength={30}
				value={form?.name ?? ''}
				error={form?.message}
			/>
			<div><Button size="lg">Let's go</Button></div>
		</form>

		{#if data.needsSetup}
			<p class="notice notice-info">
				Grown-ups: Vocab is not set up yet. <a href={resolve('/setup')}>Set it up</a> first.
			</p>
		{/if}
	{/if}

	<p class="parents"><a href={resolve('/parent/(app)')}>For parents</a></p>
</div>

<style>
	.door {
		max-inline-size: 32rem;
	}

	.lead {
		font-size: var(--text-lg);
	}

	.switch {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-muted);
	}

	.parents {
		margin-block-start: var(--space-6);
		font-size: var(--text-sm);
	}

	.parents a {
		display: inline-flex;
		align-items: center;
		min-block-size: var(--target-min);
	}
</style>
