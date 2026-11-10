<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { colorSchemeFor, isTheme, type Theme } from '#lib/theme.ts';
	import Icon, { type IconName } from './Icon.svelte';

	/** The theme the server rendered the page with (from the cookie). */
	let { theme }: { theme: Theme } = $props();

	// Set once the person picks a theme on this page; until then the server's value stands.
	let picked = $state<Theme | null>(null);
	const current = $derived(picked ?? theme);

	const options: { value: Theme; label: string; icon: IconName }[] = [
		{ value: 'system', label: 'Match this device', icon: 'monitor' },
		{ value: 'light', label: 'Light', icon: 'sun' },
		{ value: 'dark', label: 'Dark', icon: 'moon' }
	];

	function apply(next: Theme) {
		document.documentElement.dataset.theme = next;
		document
			.querySelector('meta[name="color-scheme"]')
			?.setAttribute('content', colorSchemeFor(next));
	}

	// Without JavaScript the form posts normally and the server redirects back here.
	// With it, switch at once and save the choice in the background.
	async function onsubmit(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
		const button = event.submitter;
		if (!(button instanceof HTMLButtonElement) || !isTheme(button.value)) return;
		event.preventDefault();

		const form = event.currentTarget;
		const previous = current;
		picked = button.value;
		apply(button.value);

		try {
			const response = await fetch(form.action, {
				method: 'POST',
				body: new FormData(form, button),
				headers: { accept: 'application/json' }
			});
			if (!response.ok) throw new Error(`Saving the theme failed (${response.status})`);
		} catch {
			// Do not show a theme that will be gone on the next page load.
			picked = previous;
			apply(previous);
		}
	}
</script>

<form class="theme-toggle" method="POST" action={resolve('/theme')} {onsubmit}>
	<input type="hidden" name="returnTo" value={page.url.pathname + page.url.search} />
	<div class="group" role="group" aria-label="Color theme">
		{#each options as option (option.value)}
			<button
				name="theme"
				value={option.value}
				aria-pressed={current === option.value}
				title={option.label}
			>
				<Icon name={option.icon} />
				<span class="visually-hidden">{option.label}</span>
			</button>
		{/each}
	</div>
</form>

<style>
	.group {
		display: inline-flex;
		padding: 2px;
		border: 2px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		background: var(--color-surface);
	}

	button {
		display: grid;
		place-items: center;
		inline-size: var(--target-min);
		block-size: var(--target-min);
		border: 0;
		border-radius: var(--radius-full);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--ease-out);
	}

	button:hover {
		background: var(--color-accent-soft);
		color: var(--color-text);
	}

	button[aria-pressed='true'] {
		background: var(--color-accent);
		color: var(--color-on-accent);
	}
</style>
