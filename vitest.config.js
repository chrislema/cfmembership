import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: './src/index.js',
        miniflare: {
          compatibilityDate: '2025-09-06',
          d1Databases: ['DB'],
          kvNamespaces: ['SESSIONS', 'MAGIC_LINKS', 'RECENT_PAGES', 'RATE_LIMITS', 'RULE_CACHE'],
        },
      },
    },
  },
});
