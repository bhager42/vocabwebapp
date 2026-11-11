<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import Field from '#lib/components/Field.svelte';
	import SelectField from '#lib/components/SelectField.svelte';
	import TableWrap from '#lib/components/TableWrap.svelte';
	import { plural } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const list = $derived(data.list);
	const custom = $derived(list.source === 'custom');

	const drafts = $derived((form && 'drafts' in form && form.drafts) || null);
	const draftErrors = $derived<Record<string, string>[]>(
		(form && 'draftErrors' in form && form.draftErrors) || []
	);
	const leftOut = $derived<string[]>((form && 'leftOut' in form && form.leftOut) || []);
	const listErrors = $derived<Record<string, string>>(
		(form && 'listErrors' in form && form.listErrors) || {}
	);
	const hasDraftErrors = $derived(draftErrors.some((errors) => Object.keys(errors).length > 0));

	const kinds = $derived([
		{ value: '', label: 'Choose…' },
		...data.partsOfSpeech.map((kind) => ({ value: kind, label: kind }))
	]);
	const pasteId = $props.id();
	let confirmDelete = $state(false);
</script>

<svelte:head>
	<title>{list.name} · Word lists · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<header>
		<p><a href={resolve('/parent/(app)/words')}>← All word lists</a></p>
		<h1>{list.name}</h1>
		<p class="muted">
			{custom ? 'Your own list' : 'Built-in list'} for grade {list.grade} ·
			{list.activeWords} of {plural(list.words, 'word')} in use{list.active
				? ''
				: ' · the whole list is switched off'}
		</p>
	</header>

	{#if form?.added}
		<p class="notice notice-ok" role="status">{plural(form.added, 'word')} added.</p>
	{:else if form && 'renamed' in form}
		<p class="notice notice-ok" role="status">Saved.</p>
	{:else if form && 'inUse' in form}
		<p class="notice" role="alert">
			This list cannot be deleted because some of its words have been practiced. Switch it off
			instead.
		</p>
	{/if}

	{#if custom}
		<section class="stack" aria-labelledby="add-heading">
			<h2 id="add-heading">Add words</h2>

			{#if drafts}
				{#if leftOut.length > 0}
					<div class="notice notice-info">
						<p>Left out:</p>
						<ul>
							{#each leftOut as reason (reason)}<li>{reason}</li>{/each}
						</ul>
					</div>
				{/if}
				{#if hasDraftErrors}
					<p class="notice" role="alert">Nothing was saved. Please fix the problems below.</p>
				{:else}
					<p class="muted">
						Fill in each word. The meaning should be short and must not use the word; the sentence
						must use the word once, spelled exactly as it is here.
					</p>
				{/if}

				<!-- Keep what was typed when the server sends the form back with errors. -->
				<form
					method="POST"
					action="?/add"
					class="stack-lg"
					use:enhance={() =>
						({ update }) =>
							update({ reset: false })}
				>
					{#each drafts as draft, index (index)}
						{@const errors = draftErrors[index] ?? {}}
						<fieldset class="stack">
							<legend>{draft.word || `Word ${index + 1}`}</legend>
							{#if 'note' in draft && draft.note}<p class="muted">{draft.note}</p>{/if}
							<Field
								label="Word"
								name="word"
								autocomplete="off"
								autocapitalize="none"
								spellcheck="false"
								required
								maxlength={30}
								value={draft.word}
								error={errors.word}
							/>
							<SelectField
								label="Kind of word"
								name="partOfSpeech"
								value={draft.partOfSpeech}
								options={kinds}
								error={errors.partOfSpeech}
							/>
							<Field
								label="Meaning"
								name="definition"
								autocomplete="off"
								required
								maxlength={200}
								value={draft.definition}
								error={errors.definition}
								hint="15 words or fewer, in words a child knows."
							/>
							<Field
								label="Sentence"
								name="sentence"
								autocomplete="off"
								required
								maxlength={200}
								value={draft.sentence}
								error={errors.sentence}
							/>
							<Field
								label="Words that mean the same (optional)"
								name="synonyms"
								autocomplete="off"
								autocapitalize="none"
								maxlength={200}
								value={draft.synonyms}
								error={errors.synonyms}
								hint="Separated by commas. These are never offered as wrong answers."
							/>
						</fieldset>
					{/each}
					<div class="actions">
						<Button>Save {plural(drafts.length, 'word')}</Button>
						<a href={resolve('/parent/(app)/words/[list]', { list: String(list.id) })}>Cancel</a>
					</div>
				</form>
			{:else}
				<form method="POST" action="?/paste" class="stack narrow">
					<div class="field">
						<label for={pasteId}>Words to add</label>
						<textarea
							id={pasteId}
							name="pasted"
							rows="5"
							autocapitalize="none"
							spellcheck="false"
							required
							aria-invalid={form && 'pasteError' in form ? 'true' : undefined}
							aria-describedby="{pasteId}-hint{form && 'pasteError' in form
								? ` ${pasteId}-error`
								: ''}">{form && 'pasted' in form ? form.pasted : ''}</textarea
						>
						<span class="hint" id="{pasteId}-hint">
							One word on each line, or separated by commas. Up to {data.pasteMax} at a time. You fill
							in the meanings next.
						</span>
						{#if form && 'pasteError' in form}
							<span class="error" id="{pasteId}-error">{form.pasteError}</span>
						{/if}
					</div>
					<div><Button>Next: fill in meanings</Button></div>
				</form>
			{/if}
		</section>
	{/if}

	<section class="stack" aria-labelledby="words-heading">
		<h2 id="words-heading">Words</h2>
		{#if list.entries.length === 0}
			<p class="notice notice-info">This list has no words yet.</p>
		{:else}
			{#if !custom}
				<p class="muted">
					Switch off any word you would rather your child was not asked. Words already learned stay
					in their history.
				</p>
			{/if}
			<TableWrap label="Words in this list">
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Word</th>
							<th scope="col">Meaning</th>
							<th scope="col">Status</th>
						</tr>
					</thead>
					<tbody>
						{#each list.entries as entry (entry.id)}
							<tr>
								<th scope="row">
									{#if custom}
										<a
											href={resolve('/parent/(app)/words/[list]/[word]', {
												list: String(list.id),
												word: String(entry.id)
											})}
										>
											{entry.word}
										</a>
									{:else}
										{entry.word}
									{/if}
									<span class="muted kind">{entry.partOfSpeech}</span>
								</th>
								<td>{entry.definition}</td>
								<td>
									<form method="POST" action="?/toggle" class="switch" use:enhance>
										<input type="hidden" name="id" value={entry.id} />
										<input type="hidden" name="active" value={String(!entry.active)} />
										<span>{entry.active ? 'On' : 'Off'}</span>
										<Button variant="quiet">
											Switch {entry.active ? 'off' : 'on'}
											<span class="visually-hidden">{entry.word}</span>
										</Button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</TableWrap>
		{/if}
	</section>

	{#if custom}
		<section class="narrow stack" aria-labelledby="settings-heading">
			<h2 id="settings-heading">About this list</h2>
			<form
				method="POST"
				action="?/rename"
				class="stack"
				use:enhance={() =>
					({ update }) =>
						update({ reset: false })}
			>
				<Field
					label="Name of the list"
					name="name"
					autocomplete="off"
					required
					maxlength={40}
					value={list.name}
					error={listErrors.name}
				/>
				<SelectField
					label="Grade"
					name="grade"
					value={String(list.grade)}
					error={listErrors.grade}
					options={data.grades.map((grade) => ({ value: String(grade), label: `Grade ${grade}` }))}
				/>
				<div><Button variant="secondary">Save</Button></div>
			</form>

			<h3>Delete this list</h3>
			<p class="muted">
				A list can be deleted until one of its words has been practiced. After that it can only be
				switched off, so your child's history stays whole.
			</p>
			<!-- Without JavaScript this button deletes straight away; with it, a dialog asks first. -->
			<form
				method="POST"
				action="?/delete"
				use:enhance={({ cancel }) => {
					if (!confirmDelete) {
						cancel();
						confirmDelete = true;
					} else {
						confirmDelete = false;
					}
				}}
			>
				<Button variant="secondary">Delete list</Button>
				<Dialog bind:open={confirmDelete} title="Delete “{list.name}”?">
					<p>The list and its {plural(list.words, 'word')} will be removed for good.</p>
					{#snippet actions()}
						<Button type="button" variant="secondary" onclick={() => (confirmDelete = false)}>
							Cancel
						</Button>
						<Button>Yes, delete</Button>
					{/snippet}
				</Dialog>
			</form>
		</section>
	{/if}
</div>

<style>
	.switch {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.switch > span {
		min-inline-size: 2rem;
		font-weight: var(--weight-bold);
	}

	.kind {
		display: block;
		font-weight: var(--weight-normal);
	}

	.notice ul {
		margin: 0;
		padding-inline-start: var(--space-5);
	}
</style>
