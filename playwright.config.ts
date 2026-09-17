import { defineConfig, devices } from '@playwright/test';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Run browser tests through npm run test:e2e so Firebase emulators are active.');
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'small-phone', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_FIREBASE_API_KEY: 'local-emulator-key',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-flexflow-ui.firebaseapp.com',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-flexflow-ui',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-flexflow-ui.appspot.com',
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456789',
      NEXT_PUBLIC_FIREBASE_APP_ID: '1:123456789:web:localtest',
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
      FIREBASE_ADMIN_PROJECT_ID: 'demo-flexflow-ui',
    },
  },
});
