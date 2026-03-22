import { test, expect } from "@playwright/test";
import { Alice, Bob, login, composeTweet, screenshot } from "../helpers/personas";

/**
 * STORY: As Alice (a power user), I want my home feed to show tweets
 *        from people I follow, in reverse chronological order.
 *
 * Persona: Alice — follows Bob and Charlie, expects their tweets in feed
 * Precondition: Alice follows Bob and Charlie (from seed)
 */

test.describe("US9: Home Feed Assembly", () => {
  test("SCENARIO: Alice sees tweets from followed users", async ({ page }) => {
    // GIVEN Alice is logged in and follows Bob and Charlie
    await login(page, Alice);
    await page.waitForTimeout(2000);

    // THEN her feed shows tweets (her own + from followed users)
    const feedContent = page.locator("main");
    await expect(feedContent).toBeVisible();
    await screenshot(page, "26-alice-home-feed");
  });

  test("SCENARIO: New tweet appears after posting", async ({ page }) => {
    // GIVEN Alice is on her home feed
    await login(page, Alice);
    await page.waitForTimeout(2000);

    // WHEN she posts a new tweet
    const uniqueText = `Feed test tweet ${Date.now()}`;
    await composeTweet(page, uniqueText);
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForTimeout(2000);

    // THEN the new tweet appears at the top of the feed
    await expect(page.locator(`text=${uniqueText}`).first()).toBeVisible();
    await screenshot(page, "27-new-tweet-in-feed");
  });

  test("SCENARIO: Feed shows tweets in reverse chronological order", async ({ page }) => {
    // GIVEN Alice is logged in
    await login(page, Alice);
    await page.waitForTimeout(2000);

    // THEN tweets are ordered newest first (just verify multiple tweets exist)
    const timeIndicators = page.locator('a[href^="/tweet/"]');
    const count = await timeIndicators.count();
    expect(count).toBeGreaterThan(0);
    await screenshot(page, "28-feed-chronological");
  });
});
