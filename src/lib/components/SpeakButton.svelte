<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';

	// Reads a word aloud with the browser's own speech engine. Nothing is sent anywhere.
	let { text }: { text: string } = $props();

	// The button only appears once the page knows the browser can speak, so nobody is
	// ever shown a button that does nothing (for example with JavaScript turned off).
	let supported = $state(false);
	onMount(() => {
		supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
	});

	function speak() {
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = 'en-US';
		utterance.rate = 0.85; // a little slower than normal, for a learner
		speechSynthesis.cancel(); // stop anything still being said
		speechSynthesis.speak(utterance);
	}
</script>

{#if supported}
	<button class="speak" type="button" onclick={speak}>
		<Icon name="speaker" />
		<span class="visually-hidden">Hear “{text}”</span>
	</button>
{/if}

<style>
	.speak {
		display: grid;
		place-items: center;
		flex: none;
		inline-size: var(--target-min);
		block-size: var(--target-min);
		border: 2px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		color: var(--color-accent-text);
		cursor: pointer;
	}

	.speak:hover {
		background: var(--color-accent-soft);
	}
</style>
