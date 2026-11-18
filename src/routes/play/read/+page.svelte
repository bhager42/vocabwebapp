<script lang="ts">
	import type { SubmitFunction } from '$app/forms';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import ChoiceCard from '#lib/components/ChoiceCard.svelte';
	import FeedbackPanel from '#lib/components/FeedbackPanel.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import SpeakButton from '#lib/components/SpeakButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const view = $derived(data.view);

	const LETTERS = ['A', 'B', 'C', 'D'];
	const PRAISE = ["That's right!", 'You got it!', 'Nice reading!', 'Correct!'];
	const praise = $derived(PRAISE[view.position % PRAISE.length]);

	// ---- Thinking time, measured here and sent with the answer (as in practice) ----
	let shownAt = 0;
	const questionId = $derived(view.kind === 'question' ? view.question.id : null);
	$effect(() => {
		if (questionId !== null) shownAt = performance.now();
	});
	const sendAnswer: SubmitFunction = ({ formData }) => {
		formData.set('responseMs', String(Math.round(performance.now() - shownAt)));
	};

	// ---- Focus: after each step, put the keyboard on the question or on Next ----
	let firstScreen = true;
	const screen = $derived(`${view.kind}-${view.position}`);
	$effect(() => {
		void screen;
		if (firstScreen) {
			firstScreen = false;
			return;
		}
		document.querySelector<HTMLElement>('[data-focus-here]')?.focus();
	});
</script>

<svelte:head>
	<title>{view.story.title} · Vocab</title>
</svelte:head>

<div class="reading">
	<article class="story" aria-labelledby="story-title">
		<h1 id="story-title">{view.story.title}</h1>
		{#each view.story.paragraphs as paragraph, index (index)}
			<div class="paragraph">
				<p>{paragraph}</p>
				<SpeakButton text={paragraph} label="Read paragraph {index + 1} to me" />
			</div>
		{/each}
	</article>

	<section class="questions stack-lg" aria-label="Questions">
		<ProgressBar
			value={view.position}
			max={view.total}
			label="Question {view.position} of {view.total}"
		/>

		{#if view.kind === 'question'}
			<form method="POST" action="?/answer" class="stack" use:enhance={sendAnswer}>
				<input type="hidden" name="questionId" value={view.question.id} />
				<h2 class="prompt" tabindex="-1" data-focus-here>{view.question.prompt}</h2>
				{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
				<div class="choices">
					{#each view.question.choices as choice, index (index)}
						<ChoiceCard name="choice" value={index} label={LETTERS[index]}>{choice}</ChoiceCard>
					{/each}
				</div>
			</form>
			<p class="muted">You can look back at the story as often as you like.</p>
		{:else}
			{@const feedback = view.feedback}
			<h2 class="prompt">{view.prompt}</h2>
			<FeedbackPanel
				tone={feedback.correct ? 'correct' : 'retry'}
				title={feedback.correct ? praise : 'Not quite. Here is why.'}
			>
				{#if !feedback.correct}
					<p>The answer is <strong>{feedback.answer}</strong>.</p>
				{/if}
				<p>{feedback.explanation}</p>
			</FeedbackPanel>
			<div class="choices">
				{#each feedback.choices as choice, index (index)}
					<ChoiceCard label={LETTERS[index]} state={choice.state}>{choice.text}</ChoiceCard>
				{/each}
			</div>
			<form method="POST" action="?/next" use:enhance>
				<Button size="lg" data-focus-here>{view.last ? 'See how you did' : 'Next question'}</Button>
			</form>
		{/if}

		<p><a class="later" href={resolve('/')}>Stop for now</a></p>
	</section>
</div>

<style>
	/* The story across the whole width, the questions underneath. The story is always
	   there to scroll back to. */
	.reading {
		display: grid;
		gap: var(--space-6);
	}

	.story {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-5);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.story h1 {
		margin: 0;
		font-size: var(--text-xl);
	}

	.paragraph {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.paragraph p {
		flex: 1;
		margin: 0;
		font-size: var(--text-lg);
		line-height: 1.6;
	}

	.prompt {
		margin: 0;
		font-size: var(--text-lg);
		line-height: 1.35;
	}

	.choices {
		display: grid;
		gap: var(--space-3);
	}

	.later {
		display: inline-flex;
		align-items: center;
		min-block-size: var(--target-min);
	}
</style>
