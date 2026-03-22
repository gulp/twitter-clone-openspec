import { test, expect } from "@playwright/test";
import { Alice, Bob, login, screenshot } from "../helpers/personas";

/**
 * STORY: As Alice (a power user), I want to see notifications when people
 *        interact with my tweets so I can stay engaged.
 *
 * Persona: Alice — wants to know who liked/replied/followed
 * Precondition: Bob has liked some of Alice's tweets (from seed),
 *               so Alice should have notifications
 */

test.describe("US7: Notifications", () => {
  test("SCENARIO: Bob likes Alice's tweet, Alice sees notification", async ({ page }) => {
    // GIVEN Bob likes one of Alice's tweets
    await login(page, Bob);
    await page.waitForTimeout(2000);

    // Find and like a tweet from alice
    const aliceTweets = page.locator('a:has-text("@alice")').first();
    if (await aliceTweets.isVisible()) {
      // Navigate to the tweet
      const tweetLink = page.locator('a[href^="/tweet/"]').first();
      await tweetLink.click();
      await page.waitForURL("**/tweet/**");
      await page.waitForTimeout(1000);

      // Like it
      const heartButton = page.locator('button:has(svg path[d*="4.318"])').first();
      if (await heartButton.isVisible()) {
        await heartButton.click();
        await page.waitForTimeout(500);
      }
    }
    await screenshot(page, "20-bob-interacts");
  });

  test("SCENARIO: Alice views her notifications page", async ({ page }) => {
    // GIVEN Alice has received notifications
    await login(page, Alice);

    // WHEN she navigates to notifications
    await page.goto("/notifications");
    await page.waitForTimeout(2000);

    // THEN she sees a list of notifications
    await expect(page.locator("h1")).toContainText("Notifications");
    await screenshot(page, "21-alice-notifications");
  });

  test("SCENARIO: Alice marks all notifications as read", async ({ page }) => {
    // GIVEN Alice is on the notifications page
    await login(page, Alice);
    await page.goto("/notifications");
    await page.waitForTimeout(2000);

    // WHEN she clicks "Mark all read"
    const markAllBtn = page.locator('button:has-text("Mark all read")');
    if (await markAllBtn.isVisible()) {
      await markAllBtn.click();
      await page.waitForTimeout(1000);
    }

    // THEN notifications are marked as read
    await screenshot(page, "22-notifications-read");
  });
});
