<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/Button.svelte';
	import { clearPasswordsOnFailure } from '#lib/forms.ts';
	import Field from '#lib/components/Field.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived<Record<string, string>>((form && 'errors' in form && form.errors) || {});
</script>

<svelte:head>
	<title>Account · Vocab</title>
</svelte:head>

<div class="narrow stack-lg">
	<header>
		<h1>Account</h1>
		<p class="muted">Signed in as <strong>{data.username}</strong>.</p>
	</header>

	<section class="stack" aria-labelledby="password-heading">
		<h2 id="password-heading">Change password</h2>
		<form method="POST" action="?/password" class="stack" use:enhance={clearPasswordsOnFailure}>
			{#if form && 'passwordChanged' in form}
				<p class="notice notice-ok" role="status">
					Your password has been changed. Any other device that was signed in has been signed out.
				</p>
			{/if}
			<!-- Lets password managers attach the new password to the right account. -->
			<input type="hidden" name="username" autocomplete="username" value={data.username} />
			<Field
				label="Current password"
				name="current"
				type="password"
				autocomplete="current-password"
				required
				error={errors.current}
			/>
			<Field
				label="New password"
				name="password"
				type="password"
				autocomplete="new-password"
				required
				minlength={12}
				error={errors.password}
				hint="At least 12 characters."
			/>
			<Field
				label="New password again"
				name="confirm"
				type="password"
				autocomplete="new-password"
				required
				error={errors.confirm}
			/>
			<div><Button>Change password</Button></div>
		</form>
	</section>

	<section class="stack" aria-labelledby="sessions-heading">
		<h2 id="sessions-heading">Sign out everywhere</h2>
		<p class="muted">
			Signs you out on every device, including this one. Use it if you left the app signed in
			somewhere.
		</p>
		<form method="POST" action="?/signOutEverywhere">
			<Button variant="secondary">Sign out everywhere</Button>
		</form>
	</section>
</div>
