<script lang="ts">
	// A gallery of every design-system component. It is not linked from the app; it exists
	// so the components can be seen together and checked by the accessibility tests.
	import Button from '#lib/components/Button.svelte';
	import ChoiceCard from '#lib/components/ChoiceCard.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import FeedbackPanel from '#lib/components/FeedbackPanel.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';

	const choices = [
		{ label: 'A', text: 'very, very big' },
		{ label: 'B', text: 'shy and easily scared' },
		{ label: 'C', text: 'happening often' },
		{ label: 'D', text: 'easy to break' }
	];

	let picked = $state<string | null>(null);
	let step = $state(3);
	let dialogOpen = $state(false);
</script>

<svelte:head>
	<title>Styleguide · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<header>
		<h1>Styleguide</h1>
		<p class="muted">
			Every building block of the app in one place. Use the theme buttons at the top of the page to
			see them in light and dark.
		</p>
	</header>

	<section class="stack" aria-labelledby="sg-type">
		<h2 id="sg-type">Text</h2>
		<div class="sample stack">
			<p class="display">enormous</p>
			<h3>A smaller heading</h3>
			<p>
				Body text is large and widely spaced so it is comfortable for a young reader. The font is
				Atkinson Hyperlegible, designed so that letters such as I, l and 1 are easy to tell apart.
			</p>
			<p class="muted">Muted text is for hints and less important details.</p>
			<p><a href="#sg-buttons">A link looks like this.</a></p>
		</div>
	</section>

	<section class="stack" aria-labelledby="sg-buttons">
		<h2 id="sg-buttons">Buttons</h2>
		<div class="sample row">
			<Button type="button">Primary</Button>
			<Button type="button" variant="secondary">Secondary</Button>
			<Button type="button" variant="quiet">Quiet</Button>
			<Button type="button" disabled>Disabled</Button>
		</div>
		<div class="sample row">
			<Button type="button" size="lg">Start practicing</Button>
			<Button type="button" variant="secondary"><Icon name="speaker" /> Hear it</Button>
			<Button href="#sg-type" variant="secondary">A link styled as a button</Button>
		</div>
	</section>

	<section class="stack" aria-labelledby="sg-progress">
		<h2 id="sg-progress">Progress bar</h2>
		<div class="sample stack">
			<ProgressBar value={step} max={10} label="Question {step} of 10" />
			<div class="row">
				<Button type="button" variant="secondary" disabled={step <= 1} onclick={() => (step -= 1)}
					>Back</Button
				>
				<Button type="button" variant="secondary" disabled={step >= 10} onclick={() => (step += 1)}
					>Next</Button
				>
			</div>
		</div>
	</section>

	<section class="stack" aria-labelledby="sg-choices">
		<h2 id="sg-choices">Choice cards</h2>

		<div class="sample stack">
			<h3>Waiting for an answer</h3>
			<p>What does <strong>enormous</strong> mean?</p>
			<div class="choice-list">
				<div class="grid">
					{#each choices as choice (choice.label)}
						<ChoiceCard type="button" label={choice.label} onclick={() => (picked = choice.text)}>
							{choice.text}
						</ChoiceCard>
					{/each}
				</div>
			</div>
			<p class="muted" role="status" data-testid="picked">
				{picked ? `You picked: ${picked}` : 'Nothing picked yet.'}
			</p>
		</div>

		<div class="sample stack">
			<h3>After the answer is checked</h3>
			<div class="choice-list">
				<div class="grid">
					<ChoiceCard label="A" state="correct">very, very big</ChoiceCard>
					<ChoiceCard label="B" state="incorrect">shy and easily scared</ChoiceCard>
					<ChoiceCard label="C" state="dimmed">happening often</ChoiceCard>
					<ChoiceCard label="D" state="dimmed">easy to break</ChoiceCard>
				</div>
			</div>
		</div>

		<div class="sample stack">
			<h3>Turned off</h3>
			<ChoiceCard type="button" label="A" disabled>cannot be picked right now</ChoiceCard>
		</div>
	</section>

	<section class="stack" aria-labelledby="sg-feedback">
		<h2 id="sg-feedback">Feedback panels</h2>
		<FeedbackPanel tone="correct" title="That's right!">
			<p><strong>Enormous</strong> means very, very big.</p>
			<p class="muted">An enormous whale swam beside the little boat.</p>
		</FeedbackPanel>
		<FeedbackPanel tone="retry" title="Not quite. Here is what it means.">
			<p><strong>Timid</strong> means shy and easily scared.</p>
			<p class="muted">The timid rabbit hid under the bush.</p>
		</FeedbackPanel>
	</section>

	<section class="stack" aria-labelledby="sg-fields">
		<h2 id="sg-fields">Form field</h2>
		<div class="sample">
			<div class="field">
				<label for="sg-name">What's your name?</label>
				<input id="sg-name" type="text" autocomplete="off" aria-describedby="sg-name-hint" />
				<span class="hint" id="sg-name-hint">Type your first name.</span>
			</div>
		</div>
	</section>

	<section class="stack" aria-labelledby="sg-dialog">
		<h2 id="sg-dialog">Dialog</h2>
		<div class="sample row">
			<Button type="button" variant="secondary" onclick={() => (dialogOpen = true)}>
				Open dialog
			</Button>
		</div>
	</section>
</div>

<Dialog bind:open={dialogOpen} title="Finish for today?">
	<p>You have answered 3 of 10 questions. Your progress so far is saved.</p>
	{#snippet actions()}
		<Button type="button" variant="secondary" onclick={() => (dialogOpen = false)}>
			Keep going
		</Button>
		<Button type="button" onclick={() => (dialogOpen = false)}>Finish</Button>
	{/snippet}
</Dialog>

<style>
	.sample {
		padding: var(--space-5);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}

	.display {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		line-height: 1.1;
	}
</style>
