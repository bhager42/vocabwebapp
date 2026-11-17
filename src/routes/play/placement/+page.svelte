<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import ChoiceCard from '#lib/components/ChoiceCard.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import SpeakButton from '#lib/components/SpeakButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const view = $derived(data.view);

	const LETTERS = ['A', 'B', 'C', 'D'];
	const ROUND_SIZE = 5;

	// Each question replaces the last without a page load, so move focus to the new word.
	let firstScreen = true;
	const screen = $derived(view.kind === 'question' ? view.id : 'done');
	$effect(() => {
		void screen;
		if (firstScreen) {
			firstScreen = false;
			return;
		}
		document.querySelector<HTMLElement>('[data-focus-here]')?.focus();
	});

	// A to D (or 1 to 4) pick a choice, as in practice.
	function onkeydown(event: KeyboardEvent) {
		if (view.kind !== 'question') return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const key = event.key.toUpperCase();
		const index = LETTERS.includes(key) ? LETTERS.indexOf(key) : Number(key) - 1;
		document.querySelector<HTMLButtonElement>(`button[name="choice"][value="${index}"]`)?.click();
	}
</script>

<svelte:window {onkeydown} />

<svelte:head>
	<title>Quick quiz · Vocab</title>
</svelte:head>

<div class="play stack-lg">
	{#if view.kind === 'question'}
		<ProgressBar
			value={view.position}
			max={ROUND_SIZE}
			label="Part {view.round}, question {view.position} of {ROUND_SIZE}"
		/>

		<form method="POST" action="?/answer" class="stack-lg" use:enhance>
			<input type="hidden" name="questionId" value={view.id} />

			<div class="prompt">
				<p class="ask">What does this word mean?</p>
				<div class="word-row">
					<h1 class="word" tabindex="-1" data-focus-here>{view.word}</h1>
					<SpeakButton text={view.word} />
				</div>
			</div>

			{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
			<div class="choice-list">
				<div class="grid">
					{#each view.choices as choice, index (index)}
						<ChoiceCard name="choice" value={index} label={LETTERS[index]}>{choice}</ChoiceCard>
					{/each}
				</div>
			</div>

			<div>
				<Button variant="secondary" name="dontKnow" value="1">I don't know this one</Button>
			</div>
		</form>

		<p class="muted">
			Some words are meant to be hard. Just pick the one you think is right, or say you don't know.
		</p>
		<p><a class="later" href={resolve('/')}>Stop for now</a></p>
	{:else}
		<h1 tabindex="-1" data-focus-here>All done!</h1>
		<p class="lead">Thanks for doing the quiz. Now a grown-up can pick the best words for you.</p>
		<div><Button size="lg" href={resolve('/')}>Back to the start</Button></div>
	{/if}
</div>

<style>
	.prompt {
		display: grid;
		gap: var(--space-2);
	}

	.ask {
		margin: 0;
		color: var(--color-text-muted);
		font-weight: var(--weight-bold);
	}

	.word-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}

	h1 {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.word {
		font-size: var(--text-2xl);
	}

	.lead {
		font-size: var(--text-lg);
	}

	.later {
		display: inline-flex;
		align-items: center;
		min-block-size: var(--target-min);
	}
</style>
