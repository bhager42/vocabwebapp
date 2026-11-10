<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	type Props = {
		/** Short key shown before the text, such as "A". */
		label: string;
		/**
		 * idle: can be picked. After the answer is checked the choices become a read-only
		 * result: correct (the right answer), incorrect (picked, but wrong) or dimmed (the rest).
		 */
		state?: 'idle' | 'correct' | 'incorrect' | 'dimmed';
		children: Snippet;
	} & Omit<HTMLButtonAttributes, 'children'>;

	let { label, state = 'idle', children, ...rest }: Props = $props();
</script>

{#if state === 'idle'}
	<!-- Inside a form this is a submit button, so answering works without JavaScript. -->
	<button class="choice" {...rest}>
		<span class="key">{label}</span>
		<span class="text">{@render children()}</span>
	</button>
{:else}
	<!-- Results are not controls: nothing here can be pressed or focused. -->
	<div class="choice" data-state={state}>
		<span class="key">{label}</span>
		<span class="text">{@render children()}</span>
		<!-- The state is given as an icon and words, never by color alone. -->
		{#if state === 'correct'}
			<span class="mark"><Icon name="check" /> Correct answer</span>
		{:else if state === 'incorrect'}
			<span class="mark"><Icon name="close" /> Your answer</span>
		{/if}
	</div>
{/if}

<style>
	.choice {
		--choice-bg: var(--color-surface);
		--choice-border: var(--color-border-strong);
		--choice-key-bg: var(--color-surface-sunken);

		display: flex;
		align-items: center;
		gap: var(--space-3);
		inline-size: 100%;
		min-block-size: calc(var(--target-min) * 1.4);
		padding: var(--space-3) var(--space-4);
		border: 2px solid var(--choice-border);
		border-radius: var(--radius-lg);
		background: var(--choice-bg);
		color: var(--color-text);
		box-shadow: 0 var(--edge) 0 var(--choice-border);
		font-size: var(--text-lg);
		line-height: 1.3;
		text-align: start;
	}

	button.choice {
		cursor: pointer;
		transition:
			translate var(--duration-fast) var(--ease-out),
			box-shadow var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	button.choice:hover {
		--choice-bg: var(--color-accent-soft);
		--choice-border: var(--color-accent);
	}

	button.choice:active {
		translate: 0 var(--edge);
		box-shadow: 0 0 0 var(--choice-border);
	}

	button.choice:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.key {
		display: grid;
		place-items: center;
		flex: none;
		inline-size: 2em;
		block-size: 2em;
		border-radius: var(--radius-sm);
		background: var(--choice-key-bg);
		font-size: var(--text-md);
		font-weight: var(--weight-bold);
	}

	.text {
		flex: 1;
		/* Long words wrap instead of pushing the card wider than the screen. */
		overflow-wrap: anywhere;
	}

	.mark {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex: none;
		font-size: var(--text-sm);
		font-weight: var(--weight-bold);
	}

	div.choice {
		box-shadow: none;
	}

	[data-state='correct'] {
		--choice-bg: var(--color-correct-soft);
		--choice-border: var(--color-correct);
		--choice-key-bg: transparent;
	}

	[data-state='correct'] .mark {
		color: var(--color-correct);
	}

	[data-state='incorrect'] {
		--choice-bg: var(--color-retry-soft);
		--choice-border: var(--color-retry);
		--choice-key-bg: transparent;
		border-style: dashed;
	}

	[data-state='incorrect'] .mark {
		color: var(--color-retry);
	}

	[data-state='dimmed'] {
		--choice-border: var(--color-border);
		color: var(--color-text-muted);
	}

	/* When there is no room beside the text, the mark wraps onto its own line. */
	div.choice {
		flex-wrap: wrap;
	}

	div.choice .text {
		flex-basis: 10rem;
	}
</style>
