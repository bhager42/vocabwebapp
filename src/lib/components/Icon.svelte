<script lang="ts" module>
	export type IconName = 'check' | 'close' | 'retry' | 'sun' | 'moon' | 'monitor' | 'speaker';
</script>

<script lang="ts">
	// Icons are decoration: they are hidden from screen readers, and whatever uses one
	// must also say the same thing in text.
	let { name }: { name: IconName } = $props();
</script>

<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
	{#if name === 'check'}
		<path d="M5 12.5l4.5 4.5L19 7.5" />
	{:else if name === 'close'}
		<path d="M6 6l12 12M18 6L6 18" />
	{:else if name === 'retry'}
		<path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5" />
		<path d="M4 4v4.5h4.5" />
	{:else if name === 'sun'}
		<circle cx="12" cy="12" r="4" />
		<path
			d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
		/>
	{:else if name === 'moon'}
		<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
	{:else if name === 'monitor'}
		<rect x="3" y="4" width="18" height="12" rx="2" />
		<path d="M8 20h8M12 16v4" />
	{:else if name === 'speaker'}
		<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4z" />
		<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
	{/if}
</svg>

<style>
	.icon {
		flex: none;
		inline-size: 1.25em;
		block-size: 1.25em;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.25;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
