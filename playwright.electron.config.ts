import { defineConfig } from '@playwright/test'
import path from 'node:path'

const ARTIFACTS_ROOT = path.join(process.cwd(), '.context', 'playwright')

export default defineConfig({
  testDir: path.join(process.cwd(), 'tests', 'e2e'),
  timeout: 120_000,
  expect: {
    timeout: 10_000
  },
  // Run tests serially to ensure clean app state between tests
  fullyParallel: false,
  workers: 1,
  outputDir: path.join(ARTIFACTS_ROOT, 'artifacts'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(ARTIFACTS_ROOT, 'html-report'), open: 'never' }]
  ],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'electron'
    }
  ]
})
