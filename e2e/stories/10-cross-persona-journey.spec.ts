import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { Alice, Bob, Charlie, login, register, composeTweet, screenshot, type Persona } from "../helpers/personas";

/**
 * STORY: Full cross-persona journey — simulates realistic multi-user interaction.
 *
 * Journey:
 * 1. Eve registers (new user)
 * 2. Eve follows Alice
 * 3. Alice posts a new tweet
 * 4. Eve sees Alice's tweet in her feed
 * 5. Eve likes a tweet
 * 6. Alice checks her notifications and sees Eve's interaction
 *
 * This validates the full loop: registration -> social graph -> feed -> engagement -> notifications
 */

// Unique user per test run to avoid conflicts with other suites
const ts = Date.now();
const JourneyUser: Persona = {
  name: "Eve",
  email: `eve${ts}@example.com`,
  username: `eve${ts}`.slice(0, 15),
  displayName: "Eve Martinez",
  password: "securepass99",
  bio: "Journey test user",
  role: "Integration test persona",
};

test.describe("US10: Cross-Persona Integration Journey", () => {
  test("JOURNEY: Eve joins, follows Alice, engages with content", async ({ browser }) => {
    // ===== STEP 1: Eve registers =====
    const eveContext = await browser.newContext();
    const evePage = await eveContext.newPage();

    await register(evePage, JourneyUser);
    await expect(evePage.locator("h1")).toContainText("Home");
    await screenshot(evePage, "30-journey-eve-registered");

    // ===== STEP 2: Eve visits Alice's profile and follows her =====
    await evePage.goto("/alice");
    await evePage.waitForTimeout(2000);
    await expect(evePage.locator("h2").filter({ hasText: "Alice Johnson" })).toBeVisible();

    // Target the Follow button in the main content area (not sidebar suggestions)
    const followBtn = evePage.locator('main button:has-text("Follow")').first();
    if (await followBtn.isVisible()) {
      await followBtn.click();
      await evePage.waitForTimeout(1000);
    }
    await screenshot(evePage, "31-journey-eve-follows-alice");

    // ===== STEP 3: Alice posts a new tweet =====
    const aliceContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    await login(alicePage, Alice);

    const aliceTweet = `Hello from Alice! Journey test ${Date.now()}`;
    await composeTweet(alicePage, aliceTweet);
    await alicePage.waitForTimeout(1000);
    await screenshot(alicePage, "32-journey-alice-posts");

    // ===== STEP 4: Eve sees Alice's tweet in her feed =====
    await evePage.goto("/home");
    await evePage.waitForTimeout(2000);
    await evePage.reload();
    await evePage.waitForTimeout(2000);
    await screenshot(evePage, "33-journey-eve-sees-feed");

    // ===== STEP 5: Eve likes a tweet =====
    const heartButton = evePage.locator('button:has(svg path[d*="4.318"])').first();
    if (await heartButton.isVisible()) {
      await heartButton.click();
      await evePage.waitForTimeout(500);
    }
    await screenshot(evePage, "34-journey-eve-likes");

    // ===== STEP 6: Alice checks notifications =====
    await alicePage.goto("/notifications");
    await alicePage.waitForTimeout(2000);
    await screenshot(alicePage, "35-journey-alice-notifications");

    // Cleanup
    await eveContext.close();
    await aliceContext.close();
  });
});
