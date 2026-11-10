<script lang="ts">
	type Props = {
		label: string;
		name: string;
		value: string;
		options: { value: string; label: string }[];
		error?: string;
		hint?: string;
	};

	let { label, name, value, options, error, hint }: Props = $props();
	const id = $props.id();

	const describedBy = $derived(
		[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field">
	<label for={id}>{label}</label>
	<select {id} {name} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy}>
		{#each options as option (option.value)}
			<option value={option.value} selected={option.value === value}>{option.label}</option>
		{/each}
	</select>
	{#if hint}<span class="hint" id="{id}-hint">{hint}</span>{/if}
	{#if error}<span class="error" id="{id}-error">{error}</span>{/if}
</div>
