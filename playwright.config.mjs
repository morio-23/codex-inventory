import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./tests/e2e',
  timeout:30000,
  expect:{timeout:10000},
  workers:1,
  reporter:'list',
  use:{browserName:'chromium',locale:'ja-JP',headless:true,trace:'retain-on-failure'}
});
