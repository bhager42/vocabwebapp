<script lang="ts">
	import { resolve } from '$app/paths';
	import TableWrap from '#lib/components/TableWrap.svelte';
	import { duration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const child = $derived(data.child);
	const id = $derived(String(child.id));

	const STATUS = { finished: 'Finished', stopped: 'Stopped early', 'in-progress': 'Going on now' };
	const pageHref = (page: number) =>
		`${resolve('/parent/(app)/children/[id]/sessions', { id })}?page=${page}`;
</script>

<svelte:head>
	<title>Sessions for {child.name} · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<h1>Sessions for {child.name}</h1>

	{#if data.sessions.length === 0}
		<p class="notice notice-info">{child.name} has not practiced yet.</p>
	{:else}
		<TableWrap label="Sessions">
			<table class="data-table">
				<thead>
					<tr>
						<th scope="col">Started</th>
						<th scope="col">Right</th>
						<th scope="col">Time</th>
						<th scope="col">Ended</th>
					</tr>
				</thead>
				<tbody>
					{#each data.sessions as session (session.id)}
						<tr>
							<th scope="row">
								<a
									href={resolve('/parent/(app)/children/[id]/sessions/[session]', {
										id,
										session: String(session.id)
									})}
								>
									{session.started}
								</a>
							</th>
							<td>{session.correct} of {session.answered}</td>
							<td>{duration(session.activeMs)}</td>
							<td>{STATUS[session.status]}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</TableWrap>

		{#if data.pages > 1}
			<nav class="actions" aria-label="Pages">
				<!-- eslint-disable svelte/no-navigation-without-resolve -- resolved in pageHref -->
				{#if data.page > 1}<a href={pageHref(data.page - 1)}>← Newer</a>{/if}
				<span class="muted">Page {data.page} of {data.pages}</span>
				{#if data.page < data.pages}<a href={pageHref(data.page + 1)}>Older →</a>{/if}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</nav>
		{/if}
	{/if}
</div>
