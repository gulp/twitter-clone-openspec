import { test, expect } from "@playwright/test";
import { Alice, login, composeTweet, screenshot } from "../helpers/personas";

/**
 * STORY: As Alice (a power user), I want to compose, view, and delete tweets
 *        so I can share my thoughts with followers.
 *
 * Persona: Alice — posts frequently, expects snappy UX
 * Precondition: Alice is logged in
 */

test.describe("US3: Tweeting", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, Alice);
  });

  test("SCENARIO: Alice composes a tweet from home feed", async ({ page }) => {
    // GIVEN Alice is on the home page
    await expect(page.locator("h1")).toContainText("Home");

    // WHEN she types a tweet and posts it
    const tweetText = `E2E test tweet from Alice ${Date.now()}`;
    await composeTweet(page, tweetText);

    // THEN the tweet appears in the feed
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.locator(`text=${tweetText}`).first()).toBeVisible();
    await screenshot(page, "08-alice-posted-tweet");
  });

  test("SCENARIO: Character counter enforces 280 limit", async ({ page }) => {
    // GIVEN Alice starts typing a tweet
    const longText = "a".repeat(281);

    // WHEN she types more than 280 characters
    await page.fill("textarea", longText);

    // THEN the character counter shows negative and post button is disabled
    await expect(page.locator("text=-1")).toBeVisible();
    await expect(page.locator('button:has-text("Post")')).toBeDisabled();
    await screenshot(page, "09-over-character-limit");
  });

  test("SCENARIO: Alice views a tweet detail with replies", async ({ page }) => {
    // GIVEN there are tweets in Alice's feed
    // WHEN she clicks on a tweet
    const tweetLink = page.locator('a[href^="/tweet/"]').first();
    await tweetLink.click();

    // THEN she sees the tweet detail page with reply composer
    await page.waitForURL("**/tweet/**");
    await expect(page.locator("h1")).toContainText("Post");
    await expect(page.locator('textarea[placeholder="Post your reply"]')).toBeVisible();
    await screenshot(page, "10-tweet-detail");
  });

  test("SCENARIO: Alice replies to a tweet", async ({ page }) => {
    // GIVEN Alice is viewing a tweet
    const tweetLink = page.locator('a[href^="/tweet/"]').first();
    await tweetLink.click();
    await page.waitForURL("**/tweet/**");

    // WHEN she writes and posts a reply
    const replyText = `Reply from Alice ${Date.now()}`;
    await page.fill('textarea[placeholder="Post your reply"]', replyText);
    await page.click('button:has-text("Reply")');
    await page.waitForTimeout(1500);

    // THEN the reply appears in the thread
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.locator(`text=${replyText}`).first()).toBeVisible();
    await screenshot(page, "11-alice-reply");
  });
});
