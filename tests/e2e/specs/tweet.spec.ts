import { test, expect } from "../fixtures";

test.describe("Tweet Management", () => {
  test.beforeEach(async ({ page, authPage }) => {
    // Capture console and page errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error(`[Browser Console Error]: ${msg.text()}`);
      }
    });

    page.on("pageerror", (error) => {
      console.error(`[Page Error]: ${error.message}`);
    });

    // Login before each test
    await authPage.goto();
    await authPage.login("user1@test.com", "password123");
    await authPage.expectHomePage();
  });

  test("should create tweet and appear in feed", async ({ composerPage, feedPage }) => {
    const tweetContent = `E2E test tweet ${Date.now()}`;

    await composerPage.createTweet(tweetContent);

    // Wait for tweet to appear in feed
    await feedPage.expectTweetInFeed(tweetContent);
  });

  test("should show character counter at limit", async ({ page }) => {
    // Fill composer with exactly 280 characters
    const maxContent = "a".repeat(280);
    await page.fill('[data-testid="tweet-composer"]', maxContent);

    // Character counter should show 280/280
    const counterText = await page.textContent('[data-testid="character-counter"]');
    expect(counterText).toContain("280");

    // Tweet button should be enabled at exactly 280
    await expect(page.locator('[data-testid="tweet-button"]')).toBeEnabled();

    // Add one more character
    await page.fill('[data-testid="tweet-composer"]', maxContent + "b");

    // Tweet button should be disabled
    await expect(page.locator('[data-testid="tweet-button"]')).toBeDisabled();
  });

  test("should delete own tweet and remove from feed", async ({
    composerPage,
    feedPage,
  }) => {
    const tweetContent = `Tweet to delete ${Date.now()}`;

    // Create tweet
    await composerPage.createTweet(tweetContent);
    await feedPage.expectTweetInFeed(tweetContent);

    // Delete tweet
    await feedPage.deleteTweet(tweetContent);

    // Tweet should be removed from feed
    await feedPage.expectTweetNotInFeed(tweetContent);
  });

  test("should create reply and appear in thread", async ({ page, composerPage, feedPage }) => {
    const tweetContent = `Parent tweet ${Date.now()}`;
    const replyContent = `Reply to tweet ${Date.now()}`;

    // Create parent tweet
    await composerPage.createTweet(tweetContent);
    await feedPage.expectTweetInFeed(tweetContent);

    // Click the tweet to go to detail page
    const tweetCard = page.locator(`[data-testid="tweet-card"]:has-text("${tweetContent}")`);
    await tweetCard.click();

    // Wait for detail page to load
    await expect(page).toHaveURL(/\/status\//);

    // Create reply
    await composerPage.createReply(replyContent);

    // Reply should appear in thread
    await expect(page.locator(`[data-testid="tweet-card"]:has-text("${replyContent}")`)).toBeVisible();
  });

  test("should disable tweet button for empty content", async ({ page }) => {
    // Tweet button should be disabled when composer is empty
    await expect(page.locator('[data-testid="tweet-button"]')).toBeDisabled();

    // Type something
    await page.fill('[data-testid="tweet-composer"]', "Test");

    // Tweet button should be enabled
    await expect(page.locator('[data-testid="tweet-button"]')).toBeEnabled();

    // Clear the content
    await page.fill('[data-testid="tweet-composer"]', "");

    // Tweet button should be disabled again
    await expect(page.locator('[data-testid="tweet-button"]')).toBeDisabled();
  });
});
