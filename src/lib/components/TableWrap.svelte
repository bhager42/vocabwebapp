<script lang="ts">
	import type { Snippet } from 'svelte';

	// A wide table scrolls sideways inside this box instead of stretching the page. The
	// box can be focused so the keyboard can scroll it, and has a name so a screen reader
	// can say what it is. It is a group, not a region: a page with a dozen tables should
	// not gain a dozen landmarks.
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="table-wrap" role="group" aria-label={label} tabindex="0">
	{@render children()}
</div>

<style>
	.table-wrap {
		overflow-x: auto;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
</style>
