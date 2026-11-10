<script lang="ts">
	import { resolve } from '$app/paths';
	import TableWrap from '#lib/components/TableWrap.svelte';
	import { QUESTION_TYPE_LABELS, seconds, STAGE_LABELS } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const child = $derived(data.child);
	const word = $derived(data.word);
	const id = $derived(String(child.id));
</script>

<svelte:head>
	<title>{word.word} · {child.name} · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<header>
		<p><a href={resolve('/parent/(app)/children/[id]/words', { id })}>← All words</a></p>
		<h1>{word.word}</h1>
		<p>
			<span class="muted">{word.partOfSpeech}, grade {word.grade}.</span>
			{word.definition}
		</p>
		<p class="muted">“{word.sentence}”</p>
	</header>

	{#if !data.progress}
		<p class="notice notice-info">{child.name} has not been asked this word yet.</p>
	{:else}
		<dl class="stats">
			<div>
				<dt>Stage</dt>
				<dd>
					{STAGE_LABELS[data.progress.stage]}
					{#if data.progress.stage !== 'mastered'}
						<small>stage {data.progress.box} of 5</small>
					{/if}
				</dd>
			</div>
			<div>
				<dt>Right</dt>
				<dd>{data.progress.timesCorrect} of {data.progress.timesSeen}</dd>
			</div>
			<div>
				<dt>Comes back</dt>
				<dd>{data.progress.due}</dd>
			</div>
		</dl>
	{/if}

	{#if data.answers.length > 0}
		<section class="stack" aria-labelledby="answers-heading">
			<h2 id="answers-heading">Every answer</h2>
			<TableWrap label="Every answer for this word">
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">When</th>
							<th scope="col">Kind of question</th>
							<th scope="col">Result</th>
							<th scope="col">Answer given</th>
							<th scope="col">Time</th>
						</tr>
					</thead>
					<tbody>
						{#each data.answers as entry, index (index)}
							<tr>
								<th scope="row">
									<a
										href={resolve('/parent/(app)/children/[id]/sessions/[session]', {
											id,
											session: String(entry.sessionId)
										})}
									>
										{entry.when}
									</a>
								</th>
								<td>{QUESTION_TYPE_LABELS[entry.type]}</td>
								<td>{entry.isCorrect ? '✓ Right' : '✗ Wrong'}</td>
								<td>
									{entry.chosen}
									{#if !entry.isCorrect}
										<span class="muted">(right answer: {entry.correctChoice})</span>
									{/if}
								</td>
								<td>{seconds(entry.responseMs)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</TableWrap>
		</section>
	{/if}
</div>
