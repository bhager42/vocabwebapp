<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import CheckField from '#lib/components/CheckField.svelte';
	import { clearPasswordsOnFailure } from '#lib/forms.ts';
	import Field from '#lib/components/Field.svelte';
	import TableWrap from '#lib/components/TableWrap.svelte';
	import { fileSize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived<Record<string, string>>((form && 'errors' in form && form.errors) || {});
	const emailErrors = $derived<Record<string, string>>(
		(form && 'emailErrors' in form && form.emailErrors) || {}
	);
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

	<section class="stack" aria-labelledby="email-heading">
		<h2 id="email-heading">Weekly summary email</h2>
		<p class="muted">
			Every Monday morning, a short email about the week before: days and minutes practiced, new and
			mastered words, accuracy and the words each child found hardest.
			<a href={resolve('/parent/(app)/settings/summary')}>See this week's summary</a>.
		</p>

		{#if !data.email.configured}
			<p class="notice notice-info">
				Email is not set up. To send it, the app needs a Gmail account and an app password, given as
				<code>GMAIL_USER</code> and <code>GMAIL_APP_PASSWORD</code> in the app's settings. The README
				explains how.
			</p>
		{:else}
			<form
				method="POST"
				action="?/summary"
				class="stack"
				use:enhance={() =>
					({ update }) =>
						update({ reset: false })}
			>
				{#if form && 'emailSaved' in form}
					<p class="notice notice-ok" role="status">
						Saved. {data.email.enabled
							? 'The first summary comes next Monday morning.'
							: 'No more summaries will be sent.'}
					</p>
				{:else if emailErrors.form}
					<p class="notice" role="alert">{emailErrors.form}</p>
				{/if}
				<CheckField
					label="Send a weekly summary"
					name="enabled"
					checked={data.email.enabled}
					hint="Sent from {data.email.from} through Gmail."
				/>
				<Field
					label="Send it to"
					name="to"
					type="email"
					autocomplete="email"
					maxlength={254}
					value={data.email.to}
					error={emailErrors.to}
				/>
				<div><Button>Save</Button></div>
			</form>

			{#if data.email.to}
				<form method="POST" action="?/testEmail" class="stack" use:enhance>
					{#if form && 'testSent' in form}
						<p class="notice notice-ok" role="status">
							A test email was sent to {form.testSent}. It can take a minute to arrive.
						</p>
					{:else if form && 'testError' in form}
						<p class="notice" role="alert">The test email was not sent: {form.testError}</p>
					{/if}
					<div><Button variant="secondary">Send a test email now</Button></div>
				</form>
			{/if}

			{#if data.email.lastError}
				<p class="notice" role="status">The last summary was not sent: {data.email.lastError}</p>
			{:else if data.email.lastSent}
				<p class="muted">The last summary was sent {data.email.lastSent}.</p>
			{/if}
		{/if}
	</section>

	<section class="stack" aria-labelledby="backup-heading">
		<h2 id="backup-heading">Backups</h2>
		<p class="muted">
			A backup is one file holding everything: children, their progress, your word lists and your
			account. Keep it somewhere private.
		</p>
		<form method="POST" action={resolve('/parent/(app)/settings/backup')}>
			<Button variant="secondary">Download a backup now</Button>
		</form>
		{#if data.backups.length === 0}
			<p class="muted">
				The app also saves a copy every day in its data folder. There are none yet; the first is
				made a minute after the app starts.
			</p>
		{:else}
			<p class="muted">
				The app also saves a copy every day in the <code>backups</code> folder of its data folder, and
				keeps the newest 14.
			</p>
			<TableWrap label="Saved backups">
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Made</th>
							<th scope="col">Kind</th>
							<th scope="col">Size</th>
						</tr>
					</thead>
					<tbody>
						{#each data.backups as backup (backup.name)}
							<tr>
								<th scope="row">{backup.created}</th>
								<td>{backup.kind === 'nightly' ? 'Daily' : 'Before an update'}</td>
								<td>{fileSize(backup.bytes)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</TableWrap>
		{/if}
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
