<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	type Props = {
		/** primary: the one main action. secondary: other actions. quiet: low-key actions. */
		variant?: 'primary' | 'secondary' | 'quiet';
		size?: 'md' | 'lg';
		/** When set, renders a link that looks like a button. */
		href?: string;
		children: Snippet;
	} & Omit<HTMLButtonAttributes, 'children'>;

	let { variant = 'primary', size = 'md', href, children, ...rest }: Props = $props();
</script>

{#if href}
	<!-- The caller passes an already-resolved href, as it would to a plain <a>. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a class="button {variant} {size}" {href} {...rest as HTMLAnchorAttributes}>
		{@render children()}
	</a>
{:else}
	<!-- Like a plain <button>, this submits its form unless type="button" is passed. -->
	<button class="button {variant} {size}" {...rest}>
		{@render children()}
	</button>
{/if}

<style>
	.button {
		--button-bg: var(--color-accent);
		--button-fg: var(--color-on-accent);
		--button-edge: var(--color-accent-edge);
		--button-border: var(--color-accent-edge);

		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-block-size: var(--target-min);
		min-inline-size: var(--target-min);
		padding: var(--space-2) var(--space-5);
		border: 2px solid var(--button-border);
		border-radius: var(--radius-md);
		background: var(--button-bg);
		color: var(--button-fg);
		/* A solid edge under the button makes it look pressable. */
		box-shadow: 0 var(--edge) 0 var(--button-edge);
		font-size: var(--text-md);
		font-weight: var(--weight-bold);
		line-height: 1.2;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition:
			translate var(--duration-fast) var(--ease-out),
			box-shadow var(--duration-fast) var(--ease-out),
			filter var(--duration-fast) var(--ease-out);
	}

	.button:hover {
		filter: brightness(1.08);
	}

	.button:active {
		translate: 0 var(--edge);
		box-shadow: 0 0 0 var(--button-edge);
	}

	.secondary {
		--button-bg: var(--color-surface);
		--button-fg: var(--color-text);
		--button-edge: var(--color-border-strong);
		--button-border: var(--color-border-strong);
	}

	.quiet {
		--button-bg: transparent;
		--button-fg: var(--color-accent-text);
		--button-edge: transparent;
		--button-border: transparent;
	}

	.quiet:hover {
		--button-bg: var(--color-accent-soft);
		filter: none;
	}

	.lg {
		padding: var(--space-3) var(--space-6);
		font-size: var(--text-lg);
	}

	.button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		filter: none;
		translate: none;
	}
</style>
