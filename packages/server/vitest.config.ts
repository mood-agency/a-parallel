import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [
      'dist/**',
      // Tests that depend on bun:sqlite (via test-db.ts helper or direct DB imports)
      'src/__tests__/db/**',
      'src/__tests__/routes/projects.test.ts',
      'src/__tests__/routes/git.test.ts',
      'src/__tests__/routes/threads.test.ts',
      'src/__tests__/services/project-manager.test.ts',
      'src/__tests__/services/thread-manager.test.ts',
      'src/__tests__/services/worktree-manager.test.ts',
      'src/__tests__/services/agent-runner.test.ts',
      'src/__tests__/services/agent-runner-class.test.ts',
      'src/__tests__/services/automation-manager.test.ts',
      // Tests that depend on Bun.spawn / Bun runtime
      'src/__tests__/utils/process.test.ts',
      'src/__tests__/utils/git-v2.test.ts',
    ],
  },
});
