const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 45000,
  use: { baseURL: process.env.BASE_URL || 'http://127.0.0.1:8080', headless: true },
  reporter: 'list',
});
