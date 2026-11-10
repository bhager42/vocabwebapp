<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	type Props = {
		/** Bind to this to open and close the dialog. */
		open?: boolean;
		title: string;
		children: Snippet;
		/** Buttons shown along the bottom. */
		actions?: Snippet;
	};

	let { open = $bindable(false), title, children, actions }: Props = $props();
	const id = $props.id();

	let dialog: HTMLDialogElement;

	// The native <dialog> does the hard parts: it traps focus, closes on Escape,
	// makes the rest of the page inert and returns focus to the opener when closed.
	//
	// `open` is cleared on "cancel" (Escape or a click outside) as well as on "close",
	// because the browser sends "close" a moment after the dialog has gone. Waiting for it
	// would swallow a request to reopen the dialog made in that moment. For the same reason
	// a late "close" is ignored if the dialog has already been opened again.
	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{id}-title"
	closedby="any"
	oncancel={() => (open = false)}
	onclose={() => {
		if (!dialog.open) open = false;
	}}
>
	<header>
		<h2 id="{id}-title">{title}</h2>
		<button class="close" type="button" onclick={() => (open = false)}>
			<Icon name="close" />
			<span class="visually-hidden">Close</span>
		</button>
	</header>

	<div class="body">
		{@render children()}
	</div>

	{#if actions}
		<footer>
			{@render actions()}
		</footer>
	{/if}
</dialog>

<style>
	dialog {
		inline-size: min(32rem, 100dvi - 2 * var(--space-4));
		max-block-size: calc(100dvb - 2 * var(--space-4));
		padding: 0;
		border: 2px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-raised);
	}

	dialog::backdrop {
		background: var(--color-backdrop);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-4) 0 var(--space-5);
	}

	h2 {
		margin: 0;
		font-size: var(--text-lg);
	}

	.close {
		display: grid;
		place-items: center;
		flex: none;
		inline-size: var(--target-min);
		block-size: var(--target-min);
		border: 0;
		border-radius: var(--radius-full);
		background: transparent;
		cursor: pointer;
	}

	.close:hover {
		background: var(--color-accent-soft);
	}

	.body {
		padding: var(--space-3) var(--space-5) var(--space-5);
	}

	.body :global(> :last-child) {
		margin-block-end: 0;
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-3);
		padding: 0 var(--space-5) var(--space-5);
	}

	@media (prefers-reduced-motion: no-preference) {
		dialog[open] {
			animation: pop var(--duration-normal) var(--ease-out);
		}

		@keyframes pop {
			from {
				opacity: 0;
				scale: 0.96;
			}
		}
	}
</style>
