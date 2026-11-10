<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import TableWrap from '#lib/components/TableWrap.svelte';
	import { duration, QUESTION_TYPE_LABELS, seconds } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const child = $derived(data.child);
	const session = $derived(data.session);
	const id = $derived(String(child.id));

	const STATUS = {
		finished: 'Finished',
		stopped: 'Stopped early',
		'in-progress': 'Going on now'
	};
	let confirmDelete = $state(false);
</script>

<svelte:head>
	<title>Session on {session.started} · {child.name} · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<header>
		<p>
			<a href={resolve('/parent/(app)/children/[id]/sessions', { id })}>← All sessions</a>
		</p>
		<h1>Session on {session.started}</h1>
		<p class="muted">
			{STATUS[session.status]} · {session.correct} of {session.answered} right ·
			{duration(session.activeMs)} of practice
		</p>
	</header>

	{#if session.questions.length === 0}
		<p class="notice notice-info">No questions were asked in this session.</p>
	{:else}
		<TableWrap label="Questions in this session">
			<table class="data-table">
				<thead>
					<tr>
						<th scope="col">Word</th>
						<th scope="col">Kind of question</th>
						<th scope="col">Result</th>
						<th scope="col">Answer given</th>
						<th scope="col">Time</th>
					</tr>
				</thead>
				<tbody>
					{#each session.questions as question, index (index)}
						<tr>
							<th scope="row">
								<a
									href={resolve('/parent/(app)/children/[id]/words/[word]', {
										id,
										word: String(question.wordId)
									})}
								>
									{question.word}
								</a>
								{#if question.isRetry}<span class="muted"> (asked again)</span>{/if}
							</th>
							<td>{QUESTION_TYPE_LABELS[question.type]}</td>
							<td>
								{#if question.isCorrect === null}
									Not answered
								{:else if question.isCorrect}
									✓ Right
								{:else}
									✗ Wrong
								{/if}
							</td>
							<td>
								{#if question.isCorrect === false}
									{question.chosen}
									<span class="muted">(right answer: {question.correctChoice})</span>
								{:else}
									{question.chosen ?? '–'}
								{/if}
							</td>
							<td>{seconds(question.responseMs)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</TableWrap>
	{/if}

	<section class="stack" aria-labelledby="delete-heading">
		<h2 id="delete-heading">Delete this session</h2>
		<p class="muted">
			Use this for a session that should not count, such as one somebody else played. Its questions
			and answers are removed from every figure. The stages its words reached are not changed.
		</p>
		<!-- Without JavaScript this button deletes straight away; with it, a dialog asks first. -->
		<form
			method="POST"
			action="?/delete"
			use:enhance={({ cancel }) => {
				if (!confirmDelete) {
					cancel();
					confirmDelete = true;
				}
			}}
		>
			<Button variant="secondary">Delete session</Button>
			<Dialog bind:open={confirmDelete} title="Delete this session?">
				<p>Its questions and answers will be removed for good. This cannot be undone.</p>
				{#snippet actions()}
					<Button type="button" variant="secondary" onclick={() => (confirmDelete = false)}>
						Cancel
					</Button>
					<Button>Yes, delete</Button>
				{/snippet}
			</Dialog>
		</form>
	</section>
</div>
