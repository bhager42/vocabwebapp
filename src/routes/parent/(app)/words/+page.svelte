<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Field from '#lib/components/Field.svelte';
	import SelectField from '#lib/components/SelectField.svelte';
	import TableWrap from '#lib/components/TableWrap.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived<Record<string, string>>((form && 'errors' in form && form.errors) || {});
	const values = $derived((form && 'values' in form && form.values) || { name: '', grade: '3' });
</script>

<svelte:head>
	<title>Word lists · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<header>
		<h1>Word lists</h1>
		<p class="muted">
			A child is given new words from every list that is switched on for their grade, and words from
			your own lists come first. Switching a list off stops its words being asked; nothing is
			deleted.
		</p>
	</header>

	<TableWrap label="Word lists">
		<table class="data-table">
			<thead>
				<tr>
					<th scope="col">List</th>
					<th scope="col">Grade</th>
					<th scope="col">Words in use</th>
					<th scope="col">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.lists as list (list.id)}
					<tr>
						<th scope="row">
							<a href={resolve('/parent/(app)/words/[list]', { list: String(list.id) })}>
								{list.name}
							</a>
							<span class="muted">{list.source === 'builtin' ? '(built in)' : '(yours)'}</span>
						</th>
						<td>{list.grade}</td>
						<td>{list.activeWords} of {list.words}</td>
						<td>
							<form method="POST" action="?/toggle" class="switch" use:enhance>
								<input type="hidden" name="id" value={list.id} />
								<input type="hidden" name="active" value={String(!list.active)} />
								<span>{list.active ? 'On' : 'Off'}</span>
								<Button variant="secondary">
									Switch {list.active ? 'off' : 'on'}
									<span class="visually-hidden">{list.name}</span>
								</Button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</TableWrap>

	<section class="narrow stack" aria-labelledby="new-heading">
		<h2 id="new-heading">Make your own list</h2>
		<p class="muted">For example, this week's words from school. You add the words next.</p>
		<form method="POST" action="?/create" class="stack" use:enhance>
			<Field
				label="Name of the list"
				name="name"
				autocomplete="off"
				required
				maxlength={40}
				value={values.name}
				error={errors.name}
			/>
			<SelectField
				label="Grade"
				name="grade"
				value={values.grade}
				error={errors.grade}
				options={data.grades.map((grade) => ({ value: String(grade), label: `Grade ${grade}` }))}
				hint="Children in this grade are given these words."
			/>
			<div><Button>Create list</Button></div>
		</form>
	</section>
</div>

<style>
	.switch {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.switch > span {
		min-inline-size: 2rem;
		font-weight: var(--weight-bold);
	}
</style>
