import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	return {
		theme: locals.theme,
		// The address the app is set up for (ORIGIN; see server.js). The error page compares
		// it with the one in the browser when a form is refused for coming from elsewhere.
		origin: url.origin
	};
};
