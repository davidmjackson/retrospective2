const { defineConfig, devices } = require("@playwright/test");
const path = require("path");

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT || "3101", 10);
const localBrowserLibs = path.join(
  __dirname,
  ".playwright-libs",
  "extract",
  "usr",
  "lib",
  "x86_64-linux-gnu"
);

module.exports = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    launchOptions: {
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [localBrowserLibs, process.env.LD_LIBRARY_PATH]
          .filter(Boolean)
          .join(":")
      }
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: [
      "rm -f .playwright-retros.db .playwright-retros.db-shm .playwright-retros.db-wal &&",
      "rm -rf tests/e2e/.data &&",
      `PORT=${port}`,
      "APP_NAME=retro",
      "HUB_BASE_URL=http://127.0.0.1:9",
      "HUB_API_KEY=test",
      "APP_SESSIONS_DB=tests/e2e/.data/retro-sessions.db",
      "RETRO_DB_PATH=.playwright-retros.db",
      "RETRO_ALLOWED_ORIGINS=*",
      "node server.js"
    ].join(" "),
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 15000
  }
});
