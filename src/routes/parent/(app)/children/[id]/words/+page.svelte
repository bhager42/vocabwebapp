<script lang="ts">
	import { resolve } from '$app/paths';
	import TableWrap from '#lib/components/TableWrap.svelte';
	import { STAGE_LABELS } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const child = $derived(data.child);
	const id = $derived(String(child.id));
</script>

<svelte:head>
	<title>Words for {child.name} · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<header>
		<h1>Words for {child.name}</h1>
		<p class="muted">
			Every word {child.name} has been asked, the least settled first. Choose a word to see each answer
			given for it.
		</p>
	</header>

	{#if data.words.length === 0}
		<p class="notice notice-info">{child.name} has not been asked any words yet.</p>
	{:else}
		<TableWrap label="Words">
			<table class="data-table">
				<thead>
					<tr>
						<th scope="col">Word</th>
						<th scope="col">Grade</th>
						<th scope="col">Stage</th>
						<th scope="col">Right</th>
					</tr>
				</thead>
				<tbody>
					{#each data.words as entry (entry.wordId)}
						<tr>
							<th scope="row">
								<a
									href={resolve('/parent/(app)/children/[id]/words/[word]', {
										id,
										word: String(entry.wordId)
									})}
								>
									{entry.word}
								</a>
							</th>
							<td>{entry.grade}</td>
							<td>
								{STAGE_LABELS[entry.stage]}{entry.stage === 'mastered'
									? ''
									: ` (${entry.box} of 5)`}
							</td>
							<td>{entry.timesCorrect} of {entry.timesSeen}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</TableWrap>
	{/if}
</div>
