<script lang="ts">
	// One whole split into parts: how many of a grade's words are at each stage. The bar is
	// only a picture; the list beside it gives every number, and each stage is named in
	// words, so nothing depends on telling the colors apart.
	type Stage = 'fresh' | 'learning' | 'almost' | 'mastered';
	type Props = { parts: { stage: Stage; label: string; count: number }[] };

	let { parts }: Props = $props();
	const id = $props.id();

	const total = $derived(parts.reduce((sum, part) => sum + part.count, 0));
	const segments = $derived.by(() => {
		let before = 0;
		return parts
			.filter((part) => part.count > 0)
			.map((part) => {
				const start = before;
				before += part.count;
				return { ...part, x: (start / total) * 100, width: (part.count / total) * 100 };
			});
	});
</script>

<div class="status">
	{#if total > 0}
		<!-- Positions are SVG attributes in percent, so no inline styles are needed. -->
		<svg aria-hidden="true" focusable="false">
			<clipPath id="{id}-ends"><rect width="100%" height="100%" rx="6" /></clipPath>
			<g clip-path="url(#{id}-ends)">
				{#each segments as segment (segment.stage)}
					<rect class={segment.stage} x="{segment.x}%" width="{segment.width}%" height="100%" />
				{/each}
			</g>
		</svg>
	{/if}
	<ul>
		{#each parts as part (part.stage)}
			<li>
				<span class="swatch {part.stage}" aria-hidden="true"></span>
				<span>{part.label}</span>
				<strong>{part.count}</strong>
			</li>
		{/each}
	</ul>
</div>

<style>
	.status {
		--stage-fresh: var(--color-surface-sunken);
		/* One hue, stepped by how well the words are known. Checked with the dataviz
		   palette validator against both surfaces. */
		--stage-learning: light-dark(#86b6ef, #256abf);
		--stage-almost: light-dark(#3987e5, #5598e7);
		--stage-mastered: light-dark(#184f95, #b7d3f6);

		display: grid;
		gap: var(--space-3);
	}

	svg {
		inline-size: 100%;
		block-size: 0.75rem;
	}

	/* The stroke in the surface color leaves a gap between neighbors. */
	rect {
		stroke: var(--color-surface);
		stroke-width: 2;
	}

	.fresh {
		fill: var(--stage-fresh);
		background: var(--stage-fresh);
	}

	.learning {
		fill: var(--stage-learning);
		background: var(--stage-learning);
	}

	.almost {
		fill: var(--stage-almost);
		background: var(--stage-almost);
	}

	.mastered {
		fill: var(--stage-mastered);
		background: var(--stage-mastered);
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}

	li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.swatch {
		inline-size: 0.875rem;
		block-size: 0.875rem;
		border: 1px solid var(--color-border-strong);
		border-radius: 0.25rem;
	}
</style>
