<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/Button.svelte';
	import { clearPasswordsOnFailure } from '#lib/forms.ts';
	import Field from '#lib/components/Field.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived<Record<string, string>>(form?.errors ?? {});
</script>

<svelte:head>
	<title>Set up · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	<header>
		<h1>Set up Vocab</h1>
		<p class="muted">
			Create the parent account. This is the only account that can see progress and change settings,
			and this page closes once it exists.
		</p>
	</header>

	{#if !data.enabled}
		<p class="notice" role="alert">
			Setup is turned off because no setup code is configured. Set the
			<code>SETUP_TOKEN</code> environment variable for the app and restart it.
		</p>
	{:else}
		<form method="POST" class="stack" use:enhance={clearPasswordsOnFailure}>
			{#if errors.form}
				<p class="notice" role="alert">{errors.form}</p>
			{/if}

			<Field
				label="Setup code"
				name="token"
				type="password"
				autocomplete="off"
				required
				error={errors.token}
				hint="The SETUP_TOKEN value from the app's configuration."
			/>
			<Field
				label="Username"
				name="username"
				autocomplete="username"
				autocapitalize="none"
				spellcheck="false"
				required
				value={form?.username ?? ''}
				error={errors.username}
			/>
			<Field
				label="Password"
				name="password"
				type="password"
				autocomplete="new-password"
				required
				minlength={12}
				error={errors.password}
				hint="At least 12 characters. A few unrelated words make a strong password."
			/>
			<Field
				label="Password again"
				name="confirm"
				type="password"
				autocomplete="new-password"
				required
				error={errors.confirm}
			/>

			<div><Button>Create account</Button></div>
		</form>
	{/if}
</div>
