<script lang="ts" module>
	export interface ChartPoint {
		/** Short text for the axis, such as "Nov 10". */
		label: string;
		/** Full text for the readout and the table, such as "Tue, Nov 10". */
		longLabel: string;
		/** Null where there is nothing to draw (a day without practice). */
		value: number | null;
		/** The value in words, such as "85% (17 of 20)". */
		detail: string;
	}
</script>

<script lang="ts">
	// One series over time: a line with dots, or bars. The picture is drawn for people who
	// can see it and point at it; the same numbers are in the table underneath, which is
	// what screen readers and keyboards use.
	type Props = {
		kind: 'line' | 'bar';
		/** What the chart shows. Names the picture and heads the table's second column. */
		title: string;
		points: ChartPoint[];
		/** Top of the vertical axis. */
		max: number;
		/** Text for an axis value, such as "50%". */
		tick: (value: number) => string;
		/** Heading of the table's first column. */
		labelHeading?: string;
	};

	let { kind, title, points, max, tick, labelHeading = 'Day' }: Props = $props();
	const id = $props.id();

	// The drawing is laid out in real pixels so text stays readable at any width. Until
	// the width is known (on the server), a typical one is assumed.
	let measured = $state(0);
	const width = $derived(measured || 640);
	const height = 220;
	const pad = { top: 12, right: 12, bottom: 30, left: 46 };

	const plotWidth = $derived(width - pad.left - pad.right);
	const plotHeight = height - pad.top - pad.bottom;
	const slot = $derived(plotWidth / Math.max(points.length, 1));
	const x = (index: number) => pad.left + slot * (index + 0.5);
	const y = (value: number) => pad.top + plotHeight * (1 - Math.min(value, max) / max);
	const baseline = pad.top + plotHeight;

	const ticks = $derived([0, max / 2, max]);
	// Roughly one label every 70 pixels, always including the last point.
	const labelEvery = $derived(Math.max(1, Math.ceil(70 / slot)));
	const showsLabel = (index: number) => (points.length - 1 - index) % labelEvery === 0;

	const drawn = $derived(
		points.flatMap((point, index) =>
			point.value === null ? [] : [{ index, x: x(index), y: y(point.value), value: point.value }]
		)
	);
	const linePath = $derived(
		drawn.map((point, order) => `${order === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ')
	);
	const showDots = $derived(points.length <= 31);

	const barWidth = $derived(Math.max(2, Math.min(24, slot - 2)));
	/** A bar with rounded top corners and a square foot on the baseline. */
	function barPath(centre: number, top: number): string {
		const half = barWidth / 2;
		const radius = Math.min(4, half, baseline - top);
		return (
			`M${centre - half} ${baseline}V${top + radius}` +
			`Q${centre - half} ${top} ${centre - half + radius} ${top}` +
			`H${centre + half - radius}` +
			`Q${centre + half} ${top} ${centre + half} ${top + radius}V${baseline}Z`
		);
	}

	let active = $state<number | null>(null);
	const latest = $derived(points.findLast((point) => point.value !== null));
	const readout = $derived(active === null ? latest : points[active]);
</script>

<div class="chart">
	<div class="plot" bind:clientWidth={measured}>
		<svg
			viewBox="0 0 {width} {height}"
			role="img"
			aria-labelledby="{id}-title"
			onpointerleave={() => (active = null)}
		>
			<title id="{id}-title">{title}. The numbers are in the table below.</title>

			{#each ticks as value (value)}
				<line class="grid" x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} />
				<text class="axis" x={pad.left - 8} y={y(value)} dy="0.35em" text-anchor="end">
					{tick(value)}
				</text>
			{/each}
			<line class="base" x1={pad.left} x2={width - pad.right} y1={baseline} y2={baseline} />

			{#each points as point, index (index)}
				{#if showsLabel(index)}
					<text class="axis" x={x(index)} y={height - 8} text-anchor="middle">{point.label}</text>
				{/if}
			{/each}

			{#if kind === 'line'}
				{#if active !== null}
					<line class="cross" x1={x(active)} x2={x(active)} y1={pad.top} y2={baseline} />
				{/if}
				<path class="line" d={linePath} />
				{#each drawn as point (point.index)}
					{#if showDots || point.index === active || drawn.length === 1}
						<circle class="dot" cx={point.x} cy={point.y} r={point.index === active ? 6 : 4} />
					{/if}
				{/each}
			{:else}
				{#each drawn as point (point.index)}
					{#if point.value > 0}
						<path
							class="bar"
							class:active={point.index === active}
							d={barPath(point.x, Math.min(point.y, baseline - 2))}
						/>
					{/if}
				{/each}
			{/if}

			<!-- One invisible strip per point, the full height of the chart, so pointing
			     anywhere above a day picks that day. -->
			{#each { length: points.length }, index (index)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<rect
					class="hit"
					x={pad.left + slot * index}
					y={pad.top}
					width={slot}
					height={plotHeight}
					onpointerenter={() => (active = index)}
				/>
			{/each}
		</svg>
	</div>

	<p class="readout">
		{#if readout}
			<strong>{readout.detail}</strong>
			<span class="muted">
				{readout.longLabel}{active === null ? ' (most recent)' : ''}
			</span>
		{:else}
			<span class="muted">Nothing to show yet.</span>
		{/if}
	</p>

	<details>
		<summary>Show as a table</summary>
		<table class="data-table">
			<thead>
				<tr><th scope="col">{labelHeading}</th><th scope="col">{title}</th></tr>
			</thead>
			<tbody>
				{#each points as point, index (index)}
					<tr><th scope="row">{point.longLabel}</th><td>{point.detail}</td></tr>
				{/each}
			</tbody>
		</table>
	</details>
</div>

<style>
	.chart {
		display: grid;
		gap: var(--space-2);
	}

	svg {
		inline-size: 100%;
		block-size: auto;
		overflow: visible;
	}

	.grid {
		stroke: var(--color-border);
		stroke-width: 1;
	}

	.base {
		stroke: var(--color-border-strong);
		stroke-width: 1;
	}

	.cross {
		stroke: var(--color-border-strong);
		stroke-width: 1;
	}

	.axis {
		fill: var(--color-text-muted);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}

	.line {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* The ring in the surface color keeps a dot readable where it sits on the line. */
	.dot {
		fill: var(--color-accent);
		stroke: var(--color-surface);
		stroke-width: 2;
	}

	.bar {
		fill: var(--color-accent);
	}

	.bar.active {
		fill: var(--color-accent-edge);
	}

	.hit {
		fill: transparent;
	}

	.readout {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		align-items: baseline;
		min-block-size: 1.6em;
		margin: 0;
		font-size: var(--text-sm);
	}

	summary {
		inline-size: fit-content;
		padding-block: var(--space-2);
		color: var(--color-accent-text);
		font-size: var(--text-sm);
		font-weight: var(--weight-bold);
		cursor: pointer;
	}
</style>
