<script lang="ts">
	import type { SubmitFunction } from '$app/forms';
	import { enhance } from '$app/forms';
	import { onNavigate } from '$app/navigation';
	import Button from '#lib/components/Button.svelte';
	import ChoiceCard from '#lib/components/ChoiceCard.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import FeedbackPanel from '#lib/components/FeedbackPanel.svelte';
	import Field from '#lib/components/Field.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import SpeakButton from '#lib/components/SpeakButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const view = $derived(data.view);

	const LETTERS = ['A', 'B', 'C', 'D'];
	const PRAISE = ["That's right!", 'You got it!', 'Nice work!', 'Correct!'];
	const BLANK = '_____';

	// A different, but repeatable, word of praise for each question.
	const praise = $derived(PRAISE[view.position % PRAISE.length]);

	let confirmQuit = $state(false);

	// ---- Thinking time ----
	// Measured here, from the moment the question is on screen, and sent with the answer.
	// Without JavaScript the server measures it instead.
	let shownAt = 0;
	const questionId = $derived(view.kind === 'question' ? view.question.id : null);
	$effect(() => {
		if (questionId !== null) shownAt = performance.now();
	});

	const sendAnswer: SubmitFunction = ({ formData }) => {
		formData.set('responseMs', String(Math.round(performance.now() - shownAt)));
	};

	// ---- Focus ----
	// Each new screen replaces the last without a page load, so put the keyboard and
	// screen reader where the action is: on the question, or on the Next button.
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

	// ---- Keyboard shortcuts: A to D (or 1 to 4) pick a choice ----
	function onkeydown(event: KeyboardEvent) {
		if (view.kind !== 'question' || confirmQuit) return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.target instanceof HTMLInputElement) return;

		const key = event.key.toUpperCase();
		const index = LETTERS.includes(key) ? LETTERS.indexOf(key) : Number(key) - 1;
		document.querySelector<HTMLButtonElement>(`button[name="choice"][value="${index}"]`)?.click();
	}

	// ---- A gentle slide between screens, where the browser supports it ----
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:window {onkeydown} />

<svelte:head>
	<title>Practice · Vocab</title>
</svelte:head>

{#snippet blanked(sentence: string)}
	{#each sentence.split(BLANK) as part, index (index)}
		{#if index > 0}<span class="blank"><span class="visually-hidden">blank</span></span>{/if}{part}
	{/each}
{/snippet}

<div class="play stack-lg">
	<ProgressBar
		value={view.position}
		max={view.total}
		label="Question {view.position} of {view.total}"
	/>

	{#if view.kind === 'question'}
		{@const question = view.question}
		<form method="POST" action="?/answer" class="stack-lg" use:enhance={sendAnswer}>
			<input type="hidden" name="questionId" value={question.id} />

			<div class="prompt">
				{#if question.type === 'word_to_def'}
					<p class="ask">What does this word mean?</p>
					<div class="word-row">
						<h1 class="word" tabindex="-1" data-focus-here>{question.word}</h1>
						<SpeakButton text={question.word} />
					</div>
				{:else if question.type === 'def_to_word'}
					<p class="ask">Which word means this?</p>
					<h1 class="clue" tabindex="-1" data-focus-here>{question.definition}</h1>
				{:else if question.type === 'cloze'}
					<p class="ask">Which word fits in the blank?</p>
					<h1 class="clue" tabindex="-1" data-focus-here>{@render blanked(question.sentence)}</h1>
				{:else}
					<p class="ask">Type the word that means this.</p>
					<h1 class="clue" tabindex="-1" data-focus-here>{question.definition}</h1>
					<p class="sentence">{@render blanked(question.sentence)}</p>
					<p class="muted">
						It starts with “{question.firstLetter}” and has {question.length} letters.
					</p>
				{/if}
			</div>

			{#if question.type === 'spell'}
				<Field
					label="Your answer"
					name="text"
					autocomplete="off"
					autocapitalize="none"
					autocorrect="off"
					spellcheck="false"
					required
					maxlength={40}
					error={form?.message}
				/>
				<div><Button size="lg">Check</Button></div>
			{:else}
				{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
				<div class="choice-list">
					<div class="grid">
						{#each question.choices as choice, index (index)}
							<div class="choice-row">
								<ChoiceCard name="choice" value={index} label={LETTERS[index]}>{choice}</ChoiceCard>
								<!-- Choices that are words can be heard. Hearing them gives nothing away. -->
								{#if question.type !== 'word_to_def'}<SpeakButton text={choice} />{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</form>
	{:else if view.kind === 'feedback'}
		{@const feedback = view.feedback}
		<h1 class="visually-hidden">{feedback.correct ? 'Correct' : 'Not quite'}</h1>

		<FeedbackPanel
			tone={feedback.correct ? 'correct' : 'retry'}
			title={feedback.correct ? praise : 'Not quite. Here is what it means.'}
		>
			<p class="meaning">
				<span><strong>{feedback.word}</strong> means {feedback.definition}.</span>
				<SpeakButton text={feedback.word} />
			</p>
			<p class="muted">{feedback.sentence}</p>
			{#if feedback.type === 'spell' && !feedback.correct}
				<p>
					You typed <strong>{feedback.chosen}</strong>. It is spelled
					<strong>{feedback.word}</strong>.
				</p>
			{/if}
		</FeedbackPanel>

		{#if feedback.choices.length > 0}
			<div class="choice-list">
				<div class="grid">
					{#each feedback.choices as choice, index (index)}
						<ChoiceCard label={LETTERS[index]} state={choice.state}>{choice.text}</ChoiceCard>
					{/each}
				</div>
			</div>
		{/if}

		<form method="POST" action="?/next" use:enhance>
			<Button size="lg" data-focus-here>{view.last ? 'See how you did' : 'Next'}</Button>
		</form>
	{/if}

	<!-- Without JavaScript this stops straight away; with it, a dialog asks first. -->
	<form
		method="POST"
		action="?/quit"
		class="quit"
		use:enhance={({ cancel }) => {
			if (!confirmQuit) {
				cancel();
				confirmQuit = true;
			}
		}}
	>
		<Button variant="quiet">Stop for now</Button>
		<Dialog bind:open={confirmQuit} title="Stop for now?">
			<p>What you have done so far is saved. You can practice again any time.</p>
			{#snippet actions()}
				<Button type="button" variant="secondary" onclick={() => (confirmQuit = false)}>
					Keep going
				</Button>
				<Button>Stop</Button>
			{/snippet}
		</Dialog>
	</form>
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

	/* A definition or sentence is longer than one word, so it is set a little smaller. */
	.clue {
		font-size: var(--text-xl);
		line-height: 1.3;
		text-wrap: pretty;
	}

	.sentence {
		margin: 0;
		font-size: var(--text-lg);
	}

	/* The gap in a fill-in-the-blank sentence: a line to write on. */
	.blank {
		display: inline-block;
		inline-size: 4.5em;
		margin-inline: 0.15em;
		border-block-end: 0.12em solid currentColor;
	}

	.choice-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.meaning {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-lg);
	}

	.quit {
		margin-block-start: var(--space-4);
	}
</style>
