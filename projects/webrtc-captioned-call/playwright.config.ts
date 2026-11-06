import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  timeout: 180_000, expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173', headless: true,
    launchOptions: { args: [
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.resolve('tests/fixtures/speech.wav')}`,
    ] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start', url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: false, timeout: 30_000,
    env: { PORT: '4173', HOST: '127.0.0.1' },
    stdout: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
