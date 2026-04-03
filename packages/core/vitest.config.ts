import path from 'path';

import { defineConfig } from 'vitest/config';

const shared = path.resolve(__dirname, '../shared/src');

export default defineConfig({
  resolve: {
    alias: {
      '@funny/shared/errors': path.join(shared, 'errors.ts'),
      '@funny/shared/models': path.join(shared, 'models.ts'),
      '@funny/shared/thread-machine': path.join(shared, 'thread-machine.ts'),
      '@funny/shared': path.join(shared, 'types.ts'),
      '@funny/core/agents': path.resolve(__dirname, 'src/agents/index.ts'),
      '@funny/core/git': path.resolve(__dirname, 'src/git/index.ts'),
      '@funny/core/ports': path.resolve(__dirname, 'src/ports/index.ts'),
      '@funny/core': path.resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    // Only include tests that use vi.mock() and would pollute bun test's shared process.
    // Integration tests that need Bun runtime APIs run via `bun test` separately.
    include: ['src/**/*.vitest.ts'],
  },
});
