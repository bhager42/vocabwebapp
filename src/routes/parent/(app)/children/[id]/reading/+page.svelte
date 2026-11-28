<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import TableWrap from '#lib/components/TableWrap.svelte';
	import { percent } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const child = $derived(data.child);
	const id = $derived(String(child.id));
	const figures = $derived(data.figures);

	const periods = [
		{ value: '7d', label: 'Last 7 days' },
		{ value: '30d', label: 'Last 30 days' },
		{ value: 'all', label: 'All time' }
	] as const;
	const periodLabel = $derived(
		periods.find((option) => option.value === data.period)!.label.toLowerCase()
	);

	const STATES = { open: 'Reading now', finished: 'Finished', unfinished: 'Not finished' };
</script>

<svelte:head>
	<title>Reading for {child.name} · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<header class="stack">
		<h1>Reading for {child.name}</h1>
		<p class="muted">
			Reading grade {data.readingGrade}. Change it on the Settings tab.
		</p>
	</header>

	{#if form?.movedTo}
		<p class="notice notice-ok" role="status">
			{child.name} is now reading grade {form.movedTo} stories.
		</p>
	{:else if form?.retesting}
		<p class="notice notice-ok" role="status">
			{child.name} will read {form.retesting === 1
				? 'that story'
				: `those ${form.retesting} stories`}
			again, one at a time, next time they choose “Read a story”.
		</p>
	{:else if data.gradeEnd}
		{@const end = data.gradeEnd}
		{@const mistakes = end.withMistakes.length}
		<div class="notice notice-info stack">
			<p>
				<strong>{child.name} has read all {end.stories} grade {end.grade} stories.</strong>
				Until you choose what comes next, they are told they have read them all and to talk to you.
			</p>
			{#if mistakes > 0}
				<p>
					{mistakes === 1 ? 'One story' : `${mistakes} stories`} had a wrong answer the last time:
				</p>
				<ul>
					{#each end.withMistakes as story (story.id)}<li>{story.title}</li>{/each}
				</ul>
			{:else}
				<p>Every one had all its answers right the last time.</p>
			{/if}
			<div class="end-actions">
				{#if mistakes > 0}
					<form method="POST" action="?/retest" use:enhance>
						<Button>
							Read {mistakes === 1 ? 'that story' : `those ${mistakes} stories`} again
						</Button>
					</form>
				{/if}
				{#if data.nextGrade !== null}
					<form method="POST" action="?/moveUp" use:enhance>
						<Button variant={mistakes > 0 ? 'secondary' : 'primary'}>
							Move up to reading grade {data.nextGrade}
						</Button>
					</form>
				{/if}
			</div>
			<p class="muted">
				{data.nextGrade === null ? `Grade ${end.grade} is the last grade with stories. ` : ''}You
				can also choose any reading grade on the Settings tab.
			</p>
		</div>
	{:else if data.retestsLeft > 0}
		<p class="notice notice-info">
			{child.name} is reading again the stories that had a wrong answer:
			{data.retestsLeft}
			{data.retestsLeft === 1 ? 'story' : 'stories'} still to go.
		</p>
	{:else if data.moveUpTo && !data.movesUpAutomatically}
		<div class="notice notice-info stack">
			<p>
				<strong>{child.name} is doing well with grade {data.readingGrade} stories.</strong>
				Their last {data.readiness.stories} stories averaged {percent(data.readiness.share)}, with
				{percent(data.readiness.inferenceShare)} on questions that need working out.
			</p>
			<form method="POST" action="?/moveUp" use:enhance>
				<Button>Move up to reading grade {data.moveUpTo}</Button>
			</form>
		</div>
	{:else if data.nextGrade !== null && data.readiness.stories > 0}
		<p class="muted">
			Moving up to reading grade {data.nextGrade} is offered after {data.storiesNeeded} stories at grade
			{data.readingGrade} average 80% or better, with 70% on questions that need working out. So far:
			{data.readiness.stories} of {data.storiesNeeded} stories, {percent(data.readiness.share)} right,
			{percent(data.readiness.inferenceShare)} on those questions.
		</p>
	{/if}

	{#if data.attempts.length === 0}
		<p class="notice notice-info">
			{child.name} has not read a story yet. Once they do, their results show up here.
		</p>
	{:else}
		<section class="stack" aria-labelledby="grades-heading">
			<h2 id="grades-heading">Stories by grade</h2>
			<p class="muted">
				How many of each grade's stories {child.name} has finished, whatever period is chosen below. A
				story read twice counts once; its answers count both times.
			</p>
			<div class="grades">
				{#each data.byGrade as grade (grade.grade)}
					<div class="grade">
						<ProgressBar
							value={grade.finished}
							max={grade.stories}
							label="Grade {grade.grade}{grade.grade === data.readingGrade
								? ' (reading now)'
								: ''}: {grade.finished} of {grade.stories} stories finished"
						/>
						{#if grade.right.share !== null}
							<p class="muted">
								{percent(grade.right.share)} right ({grade.right.correct} of {grade.right.asked}
								questions)
							</p>
						{/if}
					</div>
				{/each}
			</div>
		</section>

		<nav aria-label="Period">
			<ul class="periods">
				{#each periods as option (option.value)}
					<li>
						<a
							href="{resolve('/parent/(app)/children/[id]/reading', { id })}?range={option.value}"
							aria-current={option.value === data.period ? 'true' : undefined}
							data-sveltekit-noscroll
						>
							{option.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		{#if figures.started === 0}
			<p class="notice notice-info">No stories were read in the {periodLabel}.</p>
		{:else}
			<dl class="stats">
				<div>
					<dt>Stories finished</dt>
					<dd>
						{figures.finished}
						<small>of {figures.started} started</small>
					</dd>
				</div>
				<div>
					<dt>Time reading</dt>
					<dd>
						{figures.minutes} min
						<small>counted toward the daily limit</small>
					</dd>
				</div>
				<div>
					<dt>Right overall</dt>
					<dd>
						{percent(figures.overall.share)}
						<small>{figures.overall.correct} of {figures.overall.asked} questions</small>
					</dd>
				</div>
			</dl>

			<section class="stack" aria-labelledby="kinds-heading">
				<h2 id="kinds-heading">Stated and worked out</h2>
				<p class="muted">
					Some answers are written in the story; others have to be worked out from it. A big gap
					between the two shows whether {child.name} understands what they read or mainly remembers it.
				</p>
				<TableWrap label="Results by kind of question">
					<table class="data-table">
						<thead>
							<tr>
								<th scope="col">Kind of question</th>
								<th scope="col">Right</th>
								<th scope="col">Share</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th scope="row">Answer is in the story</th>
								<td>{figures.literal.correct} of {figures.literal.asked}</td>
								<td>{percent(figures.literal.share)}</td>
							</tr>
							<tr>
								<th scope="row">Answer must be worked out</th>
								<td>{figures.inference.correct} of {figures.inference.asked}</td>
								<td>{percent(figures.inference.share)}</td>
							</tr>
							<tr>
								<th scope="row">Word meaning, main idea, order of events</th>
								<td>{figures.other.correct} of {figures.other.asked}</td>
								<td>{percent(figures.other.share)}</td>
							</tr>
						</tbody>
					</table>
				</TableWrap>
			</section>
		{/if}

		<section class="stack" aria-labelledby="stories-heading">
			<h2 id="stories-heading">Every story read</h2>
			<TableWrap label="Stories read">
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Story</th>
							<th scope="col">Started</th>
							<th scope="col">Right</th>
							<th scope="col">State</th>
						</tr>
					</thead>
					<tbody>
						{#each data.attempts as attempt (attempt.id)}
							<tr>
								<th scope="row">
									<a
										href={resolve('/parent/(app)/children/[id]/reading/[attempt]', {
											id,
											attempt: String(attempt.id)
										})}
									>
										{attempt.title}
									</a>
									<small class="muted">grade {attempt.grade}</small>
								</th>
								<td>{attempt.when}</td>
								<td>{attempt.right} of {attempt.answered}</td>
								<td>{STATES[attempt.state]}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</TableWrap>
		</section>
	{/if}
</div>

<style>
	.end-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.grades {
		display: grid;
		gap: var(--space-4);
	}

	.grade {
		display: grid;
		gap: var(--space-1);
	}

	.grade p {
		margin: 0;
		font-size: var(--text-sm);
	}
</style>
