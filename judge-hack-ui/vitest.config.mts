import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
	plugins: [
		{
			name: 'pipe-as-json',
			transform(code, id) {
				if (id.endsWith('.pipe')) return { code: `export default ${code}`, map: null };
			},
		},
	],
	resolve: {
		alias: {
			shell: path.resolve(root, 'test/stubs/shell.ts'),
		},
	},
});
