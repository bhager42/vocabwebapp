<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = {
		label: string;
		name: string;
		/** A problem with what was entered, shown under the field and read out with it. */
		error?: string;
		hint?: string;
	} & Omit<HTMLInputAttributes, 'name'>;

	let { label, name, error, hint, type = 'text', ...rest }: Props = $props();
	const id = $props.id();

	const describedBy = $derived(
		[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field">
	<label for={id}>{label}</label>
	<input
		{id}
		{name}
		{type}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
		{...rest}
	/>
	{#if hint}<span class="hint" id="{id}-hint">{hint}</span>{/if}
	{#if error}<span class="error" id="{id}-error">{error}</span>{/if}
</div>
