<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Children · Vocab</title>
</svelte:head>

<div class="stack-lg">
	<header class="page-header">
		<h1>Children</h1>
		<Button href={resolve('/parent/(app)/children/new')}>Add a child</Button>
	</header>

	{#if data.children.length === 0}
		<p class="notice notice-info">
			No children yet. Add your child so they can type their name and start practicing.
		</p>
	{:else}
		<ul class="cards">
			{#each data.children as child (child.id)}
				<li class="card">
					<div>
						<h2>{child.name}</h2>
						<p class="muted">Grade {child.grade}</p>
					</div>
					<Button
						variant="secondary"
						href={resolve('/parent/(app)/children/[id]', { id: String(child.id) })}
					>
						Edit <span class="visually-hidden">{child.name}</span>
					</Button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.archived.length > 0}
		<section class="stack" aria-labelledby="archived-heading">
			<h2 id="archived-heading">Archived</h2>
			<p class="muted">
				Archived children cannot practice, but their history is kept. Restore one to bring them
				back.
			</p>
			<ul class="cards">
				{#each data.archived as child (child.id)}
					<li class="card">
						<div>
							<h3>{child.name}</h3>
							<p class="muted">Grade {child.grade}</p>
						</div>
						<form method="POST" action="?/restore" use:enhance>
							<input type="hidden" name="id" value={child.id} />
							<Button variant="secondary">
								Restore <span class="visually-hidden">{child.name}</span>
							</Button>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.cards {
		display: grid;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.card h2,
	.card h3 {
		margin: 0;
		font-size: var(--text-lg);
		overflow-wrap: anywhere;
	}

	.card p {
		margin: 0;
	}
</style>
