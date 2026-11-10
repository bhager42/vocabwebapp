<script lang="ts">
	type Props = {
		label: string;
		name: string;
		checked: boolean;
		hint?: string;
	};

	let { label, name, checked, hint }: Props = $props();
	const id = $props.id();
</script>

<div class="check-field">
	<!-- The label wraps the box, so the whole row is one comfortably large target. -->
	<label class="check">
		<input {name} type="checkbox" {checked} aria-describedby={hint ? `${id}-hint` : undefined} />
		<span>{label}</span>
	</label>
	{#if hint}<span class="hint" id="{id}-hint">{hint}</span>{/if}
</div>
