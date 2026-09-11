import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://localhost:7712', browserName: 'chromium', locale: 'en-US', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
})
