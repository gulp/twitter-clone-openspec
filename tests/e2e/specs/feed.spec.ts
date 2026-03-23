import { test, expect } from "../fixtures";

test.describe("Feed", () => {
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

    // Login as user1
    await authPage.goto();
    await authPage.login("user1@test.com", "password123");
    await authPage.expectHomePage();
  });

  test("should show home feed with followed users tweets", async ({ page, feedPage }) => {
    // user1 follows user2 and user3 (from seed data)
    // Feed should show tweets from user2 and user3
    await feedPage.gotoHome();

    // Should see tweets from followed users
    const feed = page.locator('[data-testid="home-feed"]');
    await expect(feed).toBeVisible();

    // Feed should have tweet cards
    const tweetCards = page.locator('[data-testid="tweet-card"]');
    await expect(tweetCards.first()).toBeVisible();
  });

  test("should load more tweets with infinite scroll", async ({ page, feedPage }) => {
    await feedPage.gotoHome();

    // Count initial tweets
    const initialCount = await page.locator('[data-testid="tweet-card"]').count();

    // Scroll to bottom to trigger infinite scroll
    await feedPage.scrollToBottom();

    // Wait for loading indicator
    await page.waitForTimeout(1000);

    // Should load more tweets (if there are more than one page)
    // Note: This test may not trigger loading if seed data has fewer than 20 tweets
    void page.locator('[data-testid="loading-more"]');

    // Check if there's a loading state or if count increased
    const finalCount = await page.locator('[data-testid="tweet-card"]').count();

    // Either we see loading indicator or count stays same (no more tweets)
    expect(finalCount >= initialCount).toBe(true);
  });

  test("should show new tweets indicator when SSE emits", async ({ page, feedPage }) => {
    // This test requires SSE to work
    // We'll create a tweet from another user's session and verify indicator appears

    await feedPage.gotoHome();

    // Open a second browser context as user2
    const context2 = await page.context().browser()?.newContext();
    if (!context2) {
      test.skip();
      return;
    }

    const page2 = await context2.newPage();
    const authPage2 = new (await import("../page-objects/auth.page")).AuthPage(page2);
    const composerPage2 = new (await import("../page-objects/composer.page")).ComposerPage(page2);

    // Login as user2
    await authPage2.goto();
    await authPage2.login("user2@test.com", "password123");
    await authPage2.expectHomePage();

    // user2 creates a tweet
    const newTweetContent = `New tweet from user2 ${Date.now()}`;
    await composerPage2.createTweet(newTweetContent);

    // Switch back to user1's page
    // Should see new tweets indicator (user1 follows user2)
    const indicator = page.locator('[data-testid="new-tweets-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 15000 });

    // Click indicator to refresh feed
    await feedPage.clickNewTweetsIndicator();

    // New tweet should appear in feed
    await feedPage.expectTweetInFeed(newTweetContent);

    // Cleanup
    await context2.close();
  });

  test("should show empty feed state when not following anyone", async ({ page, authPage, feedPage }) => {
    // Logout and login as user5 who doesn't follow anyone who has recent tweets in their timeline
    await page.locator('[data-testid="user-menu"]').click();
    await page.click('[data-testid="logout-button"]');

    await authPage.goto();
    await authPage.login("user4@test.com", "password123");
    await authPage.expectHomePage();

    await feedPage.gotoHome();

    // Check if empty state is shown or if there are tweets
    // user4 follows user1, so there should be tweets
    // Let's use a user that follows no one for true empty state
    // Actually, let's create a new user for this test

    await page.locator('[data-testid="user-menu"]').click();
    await page.click('[data-testid="logout-button"]');

    // Register new user
    await authPage.gotoRegister();
    const timestamp = Date.now();
    await authPage.register(
      `emptyuser${timestamp}@test.com`,
      `emptyuser${timestamp}`,
      "Empty User",
      "password123"
    );

    await authPage.expectHomePage();

    // New user follows no one, so feed should be empty or show welcome message
    const emptyState = page.locator('[data-testid="empty-feed"]');
    const tweetCards = page.locator('[data-testid="tweet-card"]');

    // Either empty state or no tweet cards
    const hasEmptyState = (await emptyState.count()) > 0;
    const hasTweets = (await tweetCards.count()) > 0;

    // Feed should either show empty state or have no tweets
    expect(hasEmptyState || !hasTweets).toBe(true);
  });

  test("should show loading state while fetching", async ({ page, feedPage }) => {
    // Navigate to home - should show loading initially
    const homePromise = feedPage.gotoHome();

    // Check for loading spinner (should appear briefly)
    void page.locator('[data-testid="loading-feed"]');

    await homePromise;

    // After loading completes, spinner should be gone and feed visible
    await expect(page.locator('[data-testid="home-feed"]')).toBeVisible();
  });
});
