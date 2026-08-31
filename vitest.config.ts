import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // Exclude nested git worktrees checked out under .claude/ (e.g. by Claude Code
    // agent tooling) — without this, their lib/__tests__ files get picked up as if
    // they were part of this repo, producing spurious unrelated failures.
    exclude: [...configDefaults.exclude, '.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/__tests__/**', 'lib/types.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
