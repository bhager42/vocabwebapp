<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Chart from '#lib/components/Chart.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import StatusBar from '#lib/components/StatusBar.svelte';
	import TableWrap from '#lib/components/TableWrap.svelte';
	import {
		duration,
		percent,
		plural,
		QUESTION_TYPE_LABELS,
		seconds,
		STAGE_LABELS
	} from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const child = $derived(data.child);
	const id = $derived(String(child.id));

	const periods = [
		{ value: '7d', label: 'Last 7 days' },
		{ value: '30d', label: 'Last 30 days' },
		{ value: 'all', label: 'All time' }
	] as const;
	const periodLabel = $derived(
		periods.find((option) => option.value === data.period)!.label.toLowerCase()
	);
	const hasAnswers = $derived(data.accuracy.firstAttempts + data.accuracy.retries > 0);

	const accuracyPoints = $derived(
		data.days.map((day) => ({
			label: day.label,
			longLabel: day.longLabel,
			value: day.accuracy,
			detail:
				day.accuracy === null
					? 'No practice'
					: `${percent(day.accuracy)} (${day.firstCorrect} of ${day.firstAttempts})`
		}))
	);

	// The top of the minutes axis: the first round number that fits the busiest day.
	const minutesMax = $derived(
		[4, 10, 20, 30, 60, 120, 240, 480].find(
			(top) => top >= Math.max(...data.days.map((day) => day.activeMs / 60_000), 0)
		) ?? 960
	);
	const minutesPoints = $derived(
		data.days.map((day) => ({
			label: day.label,
			longLabel: day.longLabel,
			value: day.activeMs / 60_000,
			detail: day.activeMs === 0 ? 'No practice' : duration(day.activeMs)
		}))
	);
</script>

<svelte:head>
	<title>Progress for {child.name} · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<h1>Progress for {child.name}</h1>

	{#if form?.movedTo}
		<p class="notice notice-ok" role="status">{child.name} is now on grade {form.movedTo} words.</p>
	{:else if data.moveUpTo && !data.movesUpAutomatically}
		<div class="notice notice-info stack">
			<p>
				<strong>{child.name} knows most of the grade {child.grade} words.</strong>
				Moving up starts grade {data.moveUpTo} words; the earlier ones keep coming back for review.
			</p>
			<form method="POST" action="?/moveUp" use:enhance>
				<Button>Move up to grade {data.moveUpTo}</Button>
			</form>
		</div>
	{:else if data.finishedLastGrade}
		<p class="notice notice-ok">
			<strong
				>{child.name} knows most of the grade {child.grade} words, the last grade there is.</strong
			>
			They keep coming back for review, and you can add your own lists under Word lists.
		</p>
	{/if}

	{#if !data.everPracticed}
		<p class="notice notice-info">
			{child.name} has not practiced yet. Once they do, their results show up here.
		</p>
	{:else}
		<!-- One switch above everything it changes. -->
		<nav aria-label="Period">
			<ul class="periods">
				{#each periods as option (option.value)}
					<li>
						<a
							href="{resolve('/parent/(app)/children/[id]/progress', { id })}?range={option.value}"
							aria-current={option.value === data.period ? 'true' : undefined}
							data-sveltekit-noscroll
						>
							{option.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		<dl class="stats">
			<div>
				<dt>Right first time</dt>
				<dd>
					{percent(data.accuracy.share)}
					<small>{data.accuracy.firstCorrect} of {data.accuracy.firstAttempts} questions</small>
				</dd>
			</div>
			<div>
				<dt>Time practiced</dt>
				<dd>
					{duration(data.activeMs)}
					<small>time spent answering, not time left open</small>
				</dd>
			</div>
			<div>
				<dt>Days practiced</dt>
				<dd>
					{data.practice.daysPracticed}
					<small>
						{plural(data.practice.currentStreak, 'day')} in a row now, longest
						{data.practice.longestStreak}
					</small>
				</dd>
			</div>
			<div>
				<dt>Sessions finished</dt>
				<dd>
					{data.sessions.completed} of {data.sessions.started}
					<small>
						{data.sessions.abandoned} stopped early{data.sessions.inProgress
							? `, ${data.sessions.inProgress} going on now`
							: ''}
					</small>
				</dd>
			</div>
		</dl>

		{#if !hasAnswers}
			<p class="notice notice-info">No questions were answered in the {periodLabel}.</p>
		{/if}

		<section class="panel" aria-labelledby="accuracy-heading">
			<h2 id="accuracy-heading">Right first time, {data.weekly ? 'week by week' : 'day by day'}</h2>
			<Chart
				kind="line"
				title="Right first time"
				labelHeading={data.weekly ? 'Week' : 'Day'}
				points={accuracyPoints}
				max={1}
				tick={percent}
			/>
		</section>

		<section class="panel" aria-labelledby="time-heading">
			<h2 id="time-heading">Time practiced, {data.weekly ? 'week by week' : 'day by day'}</h2>
			<Chart
				kind="bar"
				title="Time practiced"
				labelHeading={data.weekly ? 'Week' : 'Day'}
				points={minutesPoints}
				max={minutesMax}
				tick={(value) => `${value} min`}
			/>
		</section>

		<section class="panel" aria-labelledby="words-heading">
			<h2 id="words-heading">Words</h2>
			<p class="muted">
				Where every word stands today, whatever period is chosen above. A word is mastered once it
				has been answered right at all five stages, which takes at least a month.
			</p>
			{#each data.grades as grade (grade.grade)}
				<div class="stack grade">
					<ProgressBar
						value={Math.round(grade.known * 100)}
						max={100}
						label="Grade {grade.grade}: {percent(grade.known)} of {grade.total} words well known"
					/>
					<StatusBar
						parts={[
							{ stage: 'mastered', label: STAGE_LABELS.mastered, count: grade.mastered },
							{ stage: 'almost', label: STAGE_LABELS.almost, count: grade.almost },
							{ stage: 'learning', label: STAGE_LABELS.learning, count: grade.learning },
							{ stage: 'fresh', label: STAGE_LABELS.fresh, count: grade.fresh }
						]}
					/>
				</div>
			{:else}
				<p>There are no word lists for grade {child.grade}.</p>
			{/each}
		</section>

		<section class="panel" aria-labelledby="trouble-heading">
			<h2 id="trouble-heading">Trouble words</h2>
			{#if data.trouble.length === 0}
				<p>No wrong answers in the {periodLabel}.</p>
			{:else}
				<p class="muted">
					The words missed most in the {periodLabel}, and the wrong answer given most often.
				</p>
				<TableWrap label="Trouble words">
					<table class="data-table">
						<thead>
							<tr>
								<th scope="col">Word</th>
								<th scope="col">Missed</th>
								<th scope="col">Mixed up with</th>
							</tr>
						</thead>
						<tbody>
							{#each data.trouble as entry (entry.wordId)}
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
									<td>{entry.wrong} of {entry.asked}</td>
									<td>
										{entry.confusedWith}
										{#if entry.confusedTimes > 1}({entry.confusedTimes} times){/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</TableWrap>
			{/if}
		</section>

		<section class="panel" aria-labelledby="types-heading">
			<h2 id="types-heading">By kind of question</h2>
			<p class="muted">
				Words start with “pick the meaning” and move on to harder kinds as they are learned.
			</p>
			<TableWrap label="Results by kind of question">
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Kind</th>
							<th scope="col">Right first time</th>
							<th scope="col">Usual time to answer</th>
						</tr>
					</thead>
					<tbody>
						{#each data.types as entry (entry.type)}
							<tr>
								<th scope="row">{QUESTION_TYPE_LABELS[entry.type]}</th>
								<td>
									{#if entry.firstAttempts > 0}
										{percent(entry.share)} ({entry.firstCorrect} of {entry.firstAttempts})
									{:else}
										Not asked
									{/if}
								</td>
								<td>{seconds(entry.medianMs)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</TableWrap>
		</section>

		<section class="panel" aria-labelledby="habits-heading">
			<h2 id="habits-heading">Is it sticking?</h2>
			<dl class="stats">
				<div>
					<dt>After a week or more away</dt>
					<dd>
						{percent(data.retention.share)}
						<small>
							{#if data.retention.asked > 0}
								{data.retention.correct} of {data.retention.asked} words not seen for 7 days or more
							{:else}
								no word has come back after 7 days yet
							{/if}
						</small>
					</dd>
				</div>
				<div>
					<dt>Usual time to answer</dt>
					<dd>
						{seconds(data.medianMs)}
						<small>half of answers are faster than this</small>
					</dd>
				</div>
				<div>
					<dt>Quick wrong answers</dt>
					<dd>
						{percent(data.guessing.share)}
						<small>
							{#if data.guessing.wrong > 0}
								{data.guessing.fastWrong} of {data.guessing.wrong} wrong answers came in under 1.5 seconds,
								which is usually a guess
							{:else}
								no wrong answers to judge
							{/if}
						</small>
					</dd>
				</div>
			</dl>
		</section>

		<section class="panel" aria-labelledby="hours-heading">
			<h2 id="hours-heading">Time of day</h2>
			{#if data.hours.length === 0}
				<p>Nothing answered in the {periodLabel}.</p>
			{:else}
				<p>
					{#if data.bestHour}
						{child.name} does best around <strong>{data.bestHour}</strong>.
					{:else}
						There is not enough practice yet to say which time of day works best.
					{/if}
				</p>
				<TableWrap label="Results by time of day">
					<table class="data-table">
						<thead>
							<tr>
								<th scope="col">Hour starting</th>
								<th scope="col">Right first time</th>
							</tr>
						</thead>
						<tbody>
							{#each data.hours as entry (entry.hour)}
								<tr>
									<th scope="row">{entry.label}</th>
									<td>{percent(entry.share)} ({entry.firstCorrect} of {entry.firstAttempts})</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</TableWrap>
			{/if}
		</section>

		<p>
			<a href={resolve('/parent/(app)/children/[id]/export.csv', { id })} download>
				Download every answer as a spreadsheet file (CSV)
			</a>
		</p>
	{/if}
</div>

<style>
	.periods {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.periods a {
		display: inline-flex;
		align-items: center;
		min-block-size: var(--target-min);
		padding-inline: var(--space-4);
		border-radius: var(--radius-full);
		color: var(--color-text);
		font-size: var(--text-sm);
		font-weight: var(--weight-bold);
		text-decoration: none;
	}

	.periods a:hover {
		background: var(--color-accent-soft);
	}

	.periods a[aria-current='true'] {
		background: var(--color-accent-soft);
		color: var(--color-accent-text);
		text-decoration: underline;
		text-decoration-thickness: 0.12em;
		text-underline-offset: 0.3em;
	}

	.grade + .grade {
		padding-block-start: var(--space-4);
		border-block-start: 1px solid var(--color-border);
	}
</style>
