<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
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
</script>

<svelte:head>
	<title>{child.name} · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	<header>
		<p><a href={resolve('/parent/(app)')}>← All children</a></p>
		<h1>{child.name}</h1>
	</header>

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
		</fieldset>

		<div class="actions">
			<Button>Save changes</Button>
		</div>
	</form>

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
