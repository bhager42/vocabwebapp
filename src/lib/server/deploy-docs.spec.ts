// The README shows the TrueNAS YAML in full so it can be copied from there. This keeps that
// copy identical to compose.truenas.yaml, so a change to one cannot leave the other behind.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('README', () => {
	it('shows compose.truenas.yaml exactly as it is', () => {
		const readme = readFileSync('README.md', 'utf8');
		const yaml = readFileSync('compose.truenas.yaml', 'utf8');
		expect(readme).toContain('```yaml\n' + yaml + '```');
	});
});
