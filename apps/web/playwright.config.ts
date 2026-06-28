import { defineConfig } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const shouldStartWebServer = !process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL,
  },
  webServer: shouldStartWebServer
    ? {
      command: 'npm run dev',
      cwd: '.',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    }
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
})
