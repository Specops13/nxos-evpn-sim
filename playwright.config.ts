import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  outputDir: 'e2e-results/output',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 360, height: 740 },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 1420',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'pixel7', use: { ...devices['Pixel 7'] } },
    {
      name: 'narrow',
      use: {
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
});
