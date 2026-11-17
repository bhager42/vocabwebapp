<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '#lib/components/Icon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const attempt = $derived(data.attempt);
	const id = $derived(String(data.child.id));

	const KINDS = {
		literal: 'Answer is in the story',
		inference: 'Answer must be worked out',
		vocabulary: 'Word meaning',
		main_idea: 'Main idea',
		sequence: 'Order of events'
	};
	const STATES = { open: 'Reading now', finished: 'Finished', unfinished: 'Not finished' };
</script>

<svelte:head>
	<title>{attempt.story.title} · Reading for {data.child.name} · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	<header class="stack">
		<a class="back" href={resolve('/parent/(app)/children/[id]/reading', { id })}>← Reading</a>
		<h1>{attempt.story.title}</h1>
		<p class="muted">
			Grade {attempt.story.grade} story. Started {attempt.when}. {STATES[attempt.state]}.
		</p>
	</header>

	<section class="stack" aria-labelledby="answers-heading">
		<h2 id="answers-heading">{data.child.name}'s answers</h2>
		{#if attempt.answers.every((entry) => entry.chosen === null)}
			<p>No questions answered yet.</p>
		{/if}
		<ol class="answers stack">
			{#each attempt.answers.filter((entry) => entry.chosen !== null) as entry, index (index)}
				<li class="stack">
					<p class="kind muted">{KINDS[entry.kind]}</p>
					<p><strong>{entry.prompt}</strong></p>
					{#if entry.isCorrect}
						<p class="result">
							<Icon name="check" />
							<span>Right: {entry.chosen}</span>
						</p>
					{:else}
						<p class="result">
							<Icon name="close" />
							<span>Answered: {entry.chosen}</span>
						</p>
						<p>The answer: {entry.correct}</p>
					{/if}
					<p class="muted">{entry.explanation}</p>
				</li>
			{/each}
		</ol>
	</section>

	<details>
		<summary>Read the story</summary>
		<div class="stack story">
			{#each attempt.story.paragraphs as paragraph, index (index)}
				<p>{paragraph}</p>
			{/each}
		</div>
	</details>
</div>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		inline-size: fit-content;
		min-block-size: var(--target-min);
	}

	.answers {
		padding-inline-start: var(--space-5);
	}

	.answers p {
		margin: 0;
	}

	.kind {
		font-size: var(--text-sm);
		font-weight: var(--weight-bold);
	}

	.result {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.story {
		padding-block-start: var(--space-3);
	}

	/* Left as a list item so the browser keeps its open/close triangle. */
	summary {
		min-block-size: var(--target-min);
		padding-block: var(--space-2);
		cursor: pointer;
		font-weight: var(--weight-bold);
	}
</style>
