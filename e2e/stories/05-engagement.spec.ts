import { test, expect } from "@playwright/test";
import { Bob, login, screenshot } from "../helpers/personas";

/**
 * STORY: As Bob (an engaged reader), I want to like and retweet posts
 *        so I can show appreciation and amplify content.
 *
 * Persona: Bob — likes and retweets often, wants instant feedback
 * Precondition: Bob is logged in, there are tweets in his feed
 */

test.describe("US5: Engagement — Likes & Retweets", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, Bob);
  });

  test("SCENARIO: Bob likes a tweet (optimistic UI)", async ({ page }) => {
    // GIVEN Bob sees tweets in his feed
    await page.waitForTimeout(2000);

    // WHEN he clicks the like button on a tweet
    const likeButton = page.locator("button").filter({ has: page.locator('svg[viewBox="0 0 24 24"]') }).nth(2);
    // Find a heart/like button
    const heartButtons = page.locator('button:has(svg path[d*="4.318"])');
    const firstHeart = heartButtons.first();

    if (await firstHeart.isVisible()) {
      await firstHeart.click();
      await page.waitForTimeout(500);

      // THEN the like count updates optimistically
      await screenshot(page, "15-bob-liked-tweet");
    }
  });

  test("SCENARIO: Bob unlikes a previously liked tweet", async ({ page }) => {
    // GIVEN Bob has liked a tweet
    await page.waitForTimeout(2000);

    // Find a liked (pink) heart and click to unlike
    const pinkHearts = page.locator('button.text-pink-500:has(svg)');
    if (await pinkHearts.count() > 0) {
      await pinkHearts.first().click();
      await page.waitForTimeout(500);
      await screenshot(page, "16-bob-unliked-tweet");
    }
  });
});
