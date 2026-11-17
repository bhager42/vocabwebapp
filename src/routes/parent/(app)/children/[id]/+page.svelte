<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/Button.svelte';
	import CheckField from '#lib/components/CheckField.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import Field from '#lib/components/Field.svelte';
	import SelectField from '#lib/components/SelectField.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const child = $derived(data.child);
	const errors = $derived<Record<string, string>>((form && 'errors' in form && form.errors) || {});
	const hasErrors = $derived(Object.keys(errors).length > 0);

	let confirmArchive = $state(false);

	const openQuiz = $derived(data.quizzes.find((quiz) => quiz.state === 'open'));
	const latest = $derived(data.quizzes.find((quiz) => quiz.state === 'finished'));
	const earlier = $derived(
		data.quizzes.filter((quiz) => quiz.state !== 'open' && quiz.id !== latest?.id)
	);
</script>

<svelte:head>
	<title>Settings for {child.name} · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	<h1>Settings for {child.name}</h1>

	{#if child.archived}
		<div class="notice notice-info stack">
			<p>
				{child.name} is archived and cannot practice. Their history is kept.
			</p>
			<form method="POST" action="?/restore" use:enhance>
				<Button variant="secondary">Restore {child.name}</Button>
			</form>
		</div>
	{/if}

	<!-- Keep what was typed when the server sends the form back with errors. -->
	<form
		method="POST"
		action="?/save"
		class="stack-lg"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
	>
		{#if form && 'saved' in form}
			<p class="notice notice-ok" role="status">Saved.</p>
		{:else if hasErrors}
			<p class="notice" role="alert">Nothing was saved. Please fix the problem below.</p>
		{/if}

		<fieldset class="stack">
			<legend>About</legend>
			<Field
				label="First name"
				name="name"
				autocomplete="off"
				required
				maxlength={30}
				value={child.name}
				error={errors.name}
			/>
			<SelectField
				label="Grade"
				name="grade"
				value={String(child.grade)}
				error={errors.grade}
				options={data.grades.map((grade) => ({ value: String(grade), label: `Grade ${grade}` }))}
				hint="Words from earlier grades keep coming back for review."
			/>
			<SelectField
				label="Reading grade"
				name="readingGrade"
				value={String(child.readingGrade)}
				error={errors.readingGrade}
				options={data.readingGrades.map((grade) => ({
					value: String(grade),
					label: `Grade ${grade}`
				}))}
				hint="The grade of the stories. It can differ from the word grade."
			/>
		</fieldset>

		<fieldset class="stack">
			<legend>Practice</legend>
			<Field
				label="Questions per session"
				name="questionsPerSession"
				type="number"
				inputmode="numeric"
				min={5}
				max={20}
				required
				value={child.settings.questionsPerSession}
				error={errors.questionsPerSession}
				hint="5 to 20. Ten takes about five to ten minutes."
			/>
			<Field
				label="New words per session"
				name="newWordsPerSession"
				type="number"
				inputmode="numeric"
				min={1}
				max={10}
				required
				value={child.settings.newWordsPerSession}
				error={errors.newWordsPerSession}
				hint="1 to 10. The rest of each session is review."
			/>
			<Field
				label="Daily limit in minutes"
				name="dailyCapMinutes"
				type="number"
				inputmode="numeric"
				min={0}
				max={120}
				required
				value={child.settings.dailyCapMinutes}
				error={errors.dailyCapMinutes}
				hint="After this much practice in a day the app says “come back tomorrow”. 0 means no limit."
			/>
			<CheckField
				label="Spelling questions"
				name="spellingEnabled"
				checked={child.settings.spellingEnabled}
				hint="Words that are nearly mastered are asked by typing the word."
			/>
			<CheckField
				label="Move up a grade automatically"
				name="autoUnlockNextGrade"
				checked={child.settings.autoUnlockNextGrade}
				hint="When 80% of this grade's words are well known. Otherwise you are asked first."
			/>
			<CheckField
				label="Move up a reading grade automatically"
				name="autoUnlockReadingGrade"
				checked={child.settings.autoUnlockReadingGrade}
				hint="After 5 stories at 80% or better, with 70% on questions that need working out. Otherwise you are asked first."
			/>
		</fieldset>

		<div class="actions">
			<Button>Save changes</Button>
		</div>
	</form>

	<section class="stack" aria-labelledby="quiz-heading">
		<h2 id="quiz-heading">Placement quiz</h2>
		<p class="muted">
			A short quiz that finds the grade {child.name} should practice at. It asks about five words a grade,
			moving up or down until it finds the right level, usually in 10 to 20 questions. It does not change
			their progress or their dashboard, and nothing changes until you choose to move them.
		</p>

		{#if form && 'gradeApplied' in form}
			<p class="notice notice-ok" role="status">
				{child.name} is now at grade {form.gradeApplied}.
			</p>
		{:else if form && 'quizCancelled' in form}
			<p class="notice notice-ok" role="status">The quiz was cancelled.</p>
		{:else if form && 'quizError' in form}
			<p class="notice" role="alert">{form.quizError}</p>
		{/if}

		{#if openQuiz}
			<p class="notice notice-info" role="status">
				{form && 'quizStarted' in form ? 'Done. ' : ''}A quiz is waiting for {child.name}. They will
				see it on the start page next time they open the app.
			</p>
			<form method="POST" action="?/cancelQuiz" use:enhance>
				<Button variant="secondary">Cancel the quiz</Button>
			</form>
		{:else if !child.archived}
			<form method="POST" action="?/startQuiz" use:enhance>
				<Button variant="secondary">Give {child.name} a placement quiz</Button>
			</form>
		{/if}

		{#if latest}
			<div class="stack">
				<h3>Latest result</h3>
				<p>
					Taken {latest.when}. It suggests <strong>grade {latest.resultGrade}</strong>.
					{#if latest.resultGrade === child.grade}{child.name} is already at that grade.{/if}
				</p>
				<ul>
					{#each latest.rounds as round (round.grade)}
						<li>Grade {round.grade}: {round.correct} of {round.asked} right</li>
					{/each}
				</ul>
				{#if latest.resultGrade !== child.grade}
					<form method="POST" action="?/applyQuiz" use:enhance>
						<input type="hidden" name="quiz" value={latest.id} />
						<Button>Move {child.name} to grade {latest.resultGrade}</Button>
					</form>
				{/if}
			</div>
		{/if}

		{#if earlier.length > 0}
			<details>
				<summary>Earlier quizzes</summary>
				<ul>
					{#each earlier as quiz (quiz.id)}
						<li>
							{quiz.when}:
							{#if quiz.state === 'finished'}suggested grade {quiz.resultGrade}{:else if quiz.state === 'cancelled'}cancelled{:else}not
								finished{/if}
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</section>

	{#if !child.archived}
		<section class="stack" aria-labelledby="archive-heading">
			<h2 id="archive-heading">Archive</h2>
			<p class="muted">
				Archiving stops {child.name} from practicing and hides them from the list. Nothing is deleted,
				and you can restore them at any time.
			</p>
			<!-- Without JavaScript this button archives straight away; with it, a dialog asks first. -->
			<form
				method="POST"
				action="?/archive"
				use:enhance={({ cancel }) => {
					if (!confirmArchive) {
						cancel();
						confirmArchive = true;
					}
				}}
			>
				<Button variant="secondary">Archive {child.name}</Button>
				<Dialog bind:open={confirmArchive} title="Archive {child.name}?">
					<p>
						{child.name} will not be able to practice until you restore them. Their progress is kept.
					</p>
					{#snippet actions()}
						<Button type="button" variant="secondary" onclick={() => (confirmArchive = false)}>
							Cancel
						</Button>
						<Button>Yes, archive</Button>
					{/snippet}
				</Dialog>
			</form>
		</section>
	{/if}
</div>
