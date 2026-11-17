<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/Button.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const grades = $derived([...new Set(data.stories.map((story) => story.grade))]);
	const KINDS = {
		literal: 'In the story',
		inference: 'Worked out',
		vocabulary: 'Word meaning',
		main_idea: 'Main idea',
		sequence: 'Order of events'
	};
</script>

<svelte:head>
	<title>Stories · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<header class="stack">
		<h1>Stories</h1>
		<p class="muted">
			The built-in reading stories, with five questions each. Open a story to read it with its
			questions and answers. A story that is switched off is never given to a child.
		</p>
	</header>

	{#if data.stories.length === 0}
		<p class="notice notice-info">There are no stories yet.</p>
	{/if}

	{#each grades as grade (grade)}
		{@const stories = data.stories.filter((story) => story.grade === grade)}
		<section class="stack" aria-labelledby="grade-{grade}">
			<h2 id="grade-{grade}">Grade {grade}</h2>
			<p class="muted">
				{stories.length} stories, {stories.filter((story) => story.active).length} switched on.
			</p>
			<ul class="stories">
				{#each stories as story (story.id)}
					<li class="story">
						<div class="row">
							<details>
								<summary>
									<span class="title">{story.title}</span>
									<span class="muted">{story.words} words</span>
								</summary>
								<div class="stack preview">
									{#each story.paragraphs as paragraph, index (index)}
										<p>{paragraph}</p>
									{/each}
									<ol class="stack">
										{#each story.questions as question, index (index)}
											<li>
												<p>
													<strong>{question.prompt}</strong>
													<span class="muted">({KINDS[question.kind]})</span>
												</p>
												<p>Answer: {question.correct}</p>
												<p class="muted">Wrong choices: {question.wrong.join(' · ')}</p>
											</li>
										{/each}
									</ol>
								</div>
							</details>
							<form method="POST" action="?/toggle" class="switch" use:enhance>
								<input type="hidden" name="id" value={story.id} />
								<input type="hidden" name="active" value={String(!story.active)} />
								<span>{story.active ? 'On' : 'Off'}</span>
								<Button variant="secondary">
									Switch {story.active ? 'off' : 'on'}
									<span class="visually-hidden">{story.title}</span>
								</Button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>

<style>
	.stories {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.story {
		padding: var(--space-3) var(--space-4);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	details {
		flex: 1 1 20rem;
		min-inline-size: 0;
	}

	/* Left as a list item so the browser keeps its open/close triangle. */
	summary {
		min-block-size: var(--target-min);
		padding-block: var(--space-2);
		cursor: pointer;
	}

	.title {
		margin-inline-end: var(--space-2);
		font-weight: var(--weight-bold);
	}

	.preview {
		padding-block: var(--space-3);
	}

	.preview p {
		margin: 0;
	}

	.preview ol {
		padding-inline-start: var(--space-5);
	}

	.switch {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.switch > span {
		min-inline-size: 2rem;
		font-weight: var(--weight-bold);
	}
</style>
