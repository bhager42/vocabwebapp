// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { ParentAccount } from '#lib/server/auth/parent.ts';
import type { Theme } from '#lib/theme.ts';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			theme: Theme;
			/** The signed-in parent, or null. Set on every request by hooks.server.ts. */
			parent: ParentAccount | null;
			/** Hash of the parent session token in use, so "sign out everywhere else" can keep it. */
			parentSession: string | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
