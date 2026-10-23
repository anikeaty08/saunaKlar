import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['packages/{pricing,rules,shared}/test/**/*.test.ts', 'services/api/test/unit/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'tools/catalog-import/test/**/*.unit.test.ts'] } },
      { test: { name: 'db', include: ['packages/db/test/**/*.test.ts', 'tools/catalog-import/test/**/*.db.test.ts'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 } },
      { test: { name: 'api', include: ['services/api/test/integration/**/*.test.ts'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 } },
    ],
  },
});
