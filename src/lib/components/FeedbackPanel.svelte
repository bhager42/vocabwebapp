<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	type Props = {
		/** correct: the answer was right. retry: not quite, here is the right answer. */
		tone: 'correct' | 'retry';
		title: string;
		children: Snippet;
	};

	let { tone, title, children }: Props = $props();
</script>

<!-- role="status" makes screen readers read the feedback aloud when it appears,
     without moving focus away from where the child is. -->
<section class="feedback" data-tone={tone} role="status">
	<span class="badge"><Icon name={tone === 'correct' ? 'check' : 'retry'} /></span>
	<div class="content">
		<h2>{title}</h2>
		{@render children()}
	</div>
</section>

<style>
	.feedback {
		--tone: var(--color-correct);
		--tone-soft: var(--color-correct-soft);

		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border: 2px solid var(--tone);
		border-radius: var(--radius-lg);
		background: var(--tone-soft);
	}

	[data-tone='retry'] {
		--tone: var(--color-retry);
		--tone-soft: var(--color-retry-soft);
	}

	.badge {
		display: grid;
		place-items: center;
		flex: none;
		inline-size: 2.5rem;
		block-size: 2.5rem;
		border: 2px solid var(--tone);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		color: var(--tone);
	}

	.content {
		flex: 1;
		min-inline-size: 0;
	}

	h2 {
		margin-block-end: var(--space-2);
		color: var(--tone);
		font-size: var(--text-lg);
	}

	.content :global(> :last-child) {
		margin-block-end: 0;
	}

	@media (prefers-reduced-motion: no-preference) {
		.feedback {
			animation: arrive var(--duration-normal) var(--ease-out);
		}

		@keyframes arrive {
			from {
				opacity: 0;
				translate: 0 0.5rem;
			}
		}
	}
</style>
