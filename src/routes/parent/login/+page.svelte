<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import { clearPasswordsOnFailure } from '#lib/forms.ts';
	import Field from '#lib/components/Field.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Parent sign in · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	<h1>Parent sign in</h1>

	{#if data.needsSetup}
		<p class="notice notice-info">
			There is no parent account yet. <a href={resolve('/setup')}>Set up Vocab</a> to create one.
		</p>
	{/if}

	<form method="POST" class="stack" use:enhance={clearPasswordsOnFailure}>
		{#if form?.message}
			<p class="notice" role="alert">{form.message}</p>
		{/if}

		<Field
			label="Username"
			name="username"
			autocomplete="username"
			autocapitalize="none"
			spellcheck="false"
			required
			value={form?.username ?? ''}
		/>
		<Field
			label="Password"
			name="password"
			type="password"
			autocomplete="current-password"
			required
		/>

		<div><Button>Sign in</Button></div>
	</form>
</div>
