import { defineConfig } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 90_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run test:e2e:serve",
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
