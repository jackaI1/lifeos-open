import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3217",
    trace: "retain-on-failure",
    launchOptions: process.env.STUDY_CHROME_PATH
      ? { executablePath: process.env.STUDY_CHROME_PATH }
      : {},
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:3217",
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});
