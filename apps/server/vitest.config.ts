import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    exclude: process.env.PRINTER_DASHBOARD_LIVE ? [] : ['src/**/*.live.test.ts'],
    testTimeout: 15000,
  },
});
