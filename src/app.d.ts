// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Theme } from '#lib/theme.ts';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			theme: Theme;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
