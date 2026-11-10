<script lang="ts">
	type Props = {
		value: number;
		max: number;
		/** Visible text, such as "Question 3 of 10". Also names the bar for screen readers. */
		label: string;
	};

	let { value, max, label }: Props = $props();
	const id = $props.id();
</script>

<!-- A native <progress> element: no inline styles needed, and assistive technology
     already understands it. -->
<div class="progress">
	<label for={id}>{label}</label>
	<progress {id} {value} {max}>{value} of {max}</progress>
</div>

<style>
	.progress {
		display: grid;
		gap: var(--space-2);
	}

	label {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		font-weight: var(--weight-bold);
	}

	progress {
		appearance: none;
		display: block;
		inline-size: 100%;
		block-size: 1rem;
		overflow: hidden;
		border: 2px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		background: var(--color-surface-sunken);
		/* Firefox takes the fill color from `color` when ::-moz-progress-bar is unset. */
		color: var(--color-accent);
	}

	progress::-webkit-progress-bar {
		background: var(--color-surface-sunken);
	}

	progress::-webkit-progress-value {
		border-radius: var(--radius-full);
		background: var(--color-accent);
		transition: inline-size var(--duration-normal) var(--ease-out);
	}

	progress::-moz-progress-bar {
		border-radius: var(--radius-full);
		background: var(--color-accent);
	}
</style>
