import { test as base } from "@playwright/test";
import { execSync } from "node:child_process";
import { AuthPage } from "./page-objects/auth.page";
import { ComposerPage } from "./page-objects/composer.page";
import { FeedPage } from "./page-objects/feed.page";
import { NotificationPage } from "./page-objects/notification.page";
import { ProfilePage } from "./page-objects/profile.page";
import { SearchPage } from "./page-objects/search.page";
import { SocialPage } from "./page-objects/social.page";

/**
 * Extended test fixture with page objects and setup
 */
export const test = base.extend<{
  authPage: AuthPage;
  composerPage: ComposerPage;
  feedPage: FeedPage;
  notificationPage: NotificationPage;
  profilePage: ProfilePage;
  searchPage: SearchPage;
  socialPage: SocialPage;
}>({
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },
  composerPage: async ({ page }, use) => {
    await use(new ComposerPage(page));
  },
  feedPage: async ({ page }, use) => {
    await use(new FeedPage(page));
  },
  notificationPage: async ({ page }, use) => {
    await use(new NotificationPage(page));
  },
  profilePage: async ({ page }, use) => {
    await use(new ProfilePage(page));
  },
  searchPage: async ({ page }, use) => {
    await use(new SearchPage(page));
  },
  socialPage: async ({ page }, use) => {
    await use(new SocialPage(page));
  },
});

export { expect } from "@playwright/test";

/**
 * Global setup: Run seed script before all tests
 */
export async function seedDatabase() {
  console.log("🌱 Seeding database for E2E tests...");
  execSync("npx tsx scripts/seed.ts", {
    stdio: "inherit",
    env: process.env,
  });
  console.log("✓ Database seeded");
}
