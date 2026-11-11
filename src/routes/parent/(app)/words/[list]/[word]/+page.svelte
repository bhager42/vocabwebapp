<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Field from '#lib/components/Field.svelte';
	import SelectField from '#lib/components/SelectField.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived<Record<string, string>>((form && 'errors' in form && form.errors) || {});
	const values = $derived((form && 'values' in form && form.values) || data.entry);
</script>

<svelte:head>
	<title>{data.entry.word} · {data.list.name} · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	<header>
		<p>
			<a href={resolve('/parent/(app)/words/[list]', { list: String(data.list.id) })}>
				← {data.list.name}
			</a>
		</p>
		<h1>{data.entry.word}</h1>
	</header>

	<form
		method="POST"
		action="?/save"
		class="stack"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
	>
		{#if form && 'saved' in form}
			<p class="notice notice-ok" role="status">Saved.</p>
		{:else if Object.keys(errors).length > 0}
			<p class="notice" role="alert">Nothing was saved. Please fix the problem below.</p>
		{/if}

		<Field
			label="Word"
			name="word"
			autocomplete="off"
			autocapitalize="none"
			spellcheck="false"
			required
			maxlength={30}
			readonly={data.practiced}
			value={values.word}
			error={errors.word}
			hint={data.practiced
				? 'This word has been practiced, so its spelling cannot change.'
				: undefined}
		/>
		<SelectField
			label="Kind of word"
			name="partOfSpeech"
			value={values.partOfSpeech}
			options={data.partsOfSpeech.map((kind) => ({ value: kind, label: kind }))}
			error={errors.partOfSpeech}
		/>
		<Field
			label="Meaning"
			name="definition"
			autocomplete="off"
			required
			maxlength={200}
			value={values.definition}
			error={errors.definition}
			hint="15 words or fewer, without using the word itself."
		/>
		<Field
			label="Sentence"
			name="sentence"
			autocomplete="off"
			required
			maxlength={200}
			value={values.sentence}
			error={errors.sentence}
			hint="Must use the word once, spelled exactly as above."
		/>
		<Field
			label="Words that mean the same (optional)"
			name="synonyms"
			autocomplete="off"
			autocapitalize="none"
			maxlength={200}
			value={values.synonyms}
			error={errors.synonyms}
			hint="Separated by commas. These are never offered as wrong answers."
		/>
		<div><Button>Save changes</Button></div>
	</form>

	<section class="stack" aria-labelledby="delete-heading">
		<h2 id="delete-heading">Remove this word</h2>
		{#if form && 'inUse' in form}
			<p class="notice" role="alert">
				This word has been practiced and cannot be removed. Switch it off in the list instead.
			</p>
		{/if}
		{#if data.practiced}
			<p class="muted">
				This word has been practiced, so it cannot be removed. To stop it being asked, switch it off
				in the list.
			</p>
		{:else}
			<form method="POST" action="?/delete">
				<Button variant="secondary">Remove word</Button>
			</form>
		{/if}
	</section>
</div>
