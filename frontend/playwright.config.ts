import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test', workers: 1, timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4175', channel: 'msedge', headless: true, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort', url: 'http://127.0.0.1:4175', reuseExistingServer: false },
});
