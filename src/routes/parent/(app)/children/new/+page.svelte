<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Field from '#lib/components/Field.svelte';
	import SelectField from '#lib/components/SelectField.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived<Record<string, string>>(form?.errors ?? {});
</script>

<svelte:head>
	<title>Add a child · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	<h1>Add a child</h1>

	<form method="POST" class="stack" use:enhance>
		<Field
			label="First name"
			name="name"
			autocomplete="off"
			required
			maxlength={30}
			value={form?.values.name ?? ''}
			error={errors.name}
			hint="This is what your child types to start. Capital letters do not matter."
		/>
		<SelectField
			label="Grade"
			name="grade"
			value={form?.values.grade ?? '3'}
			error={errors.grade}
			options={data.grades.map((grade) => ({ value: String(grade), label: `Grade ${grade}` }))}
			hint="Words start at this grade. You can change it later."
		/>

		<div class="actions">
			<Button>Add child</Button>
			<Button variant="quiet" href={resolve('/parent/(app)')}>Cancel</Button>
		</div>
	</form>
</div>
