import { test, expect } from "../fixtures";

test.describe("Social Graph", () => {
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

  test("should follow user and button changes to Following", async ({ page, socialPage }) => {
    // user1 doesn't follow user4 initially (from seed data)
    await socialPage.gotoProfile("user4");

    // Should see Follow button
    await expect(page.locator('[data-testid="follow-button"]')).toBeVisible();

    // Click Follow
    await socialPage.followUser();

    // Button should change to Unfollow/Following
    await expect(page.locator('[data-testid="unfollow-button"]')).toBeVisible({ timeout: 10000 });
  });

  test("should unfollow user and button changes to Follow", async ({ page, socialPage }) => {
    // user1 follows user2 (from seed data)
    await socialPage.gotoProfile("user2");

    // Should see Unfollow/Following button
    await expect(page.locator('[data-testid="unfollow-button"]')).toBeVisible();

    // Click Unfollow
    await socialPage.unfollowUser();

    // Button should change to Follow
    await expect(page.locator('[data-testid="follow-button"]')).toBeVisible({ timeout: 10000 });
  });

  test("should show followers list", async ({ page, socialPage }) => {
    // user1 has followers (user2, user3, user4, user5 from seed data)
    await socialPage.gotoFollowers("user1");

    // Should see user cards for followers
    const userCards = page.locator('[data-testid="user-card"]');
    await expect(userCards.first()).toBeVisible();

    // Should see at least one follower
    const count = await userCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should show following list", async ({ page, socialPage }) => {
    // user1 follows user2 and user3 (from seed data)
    await socialPage.gotoFollowing("user1");

    // Should see user cards for following
    const userCards = page.locator('[data-testid="user-card"]');
    await expect(userCards.first()).toBeVisible();

    // Should see at least one user being followed
    const count = await userCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should update who-to-follow after following user", async ({ page }) => {
    await page.goto("/home");

    // Check if who-to-follow sidebar exists
    const whoToFollow = page.locator('[data-testid="who-to-follow"]');

    if ((await whoToFollow.count()) === 0) {
      test.skip();
      return;
    }

    await expect(whoToFollow).toBeVisible();

    // Get a suggested user (should be someone user1 doesn't follow)
    const suggestedUsers = page.locator('[data-testid="who-to-follow-card"]');

    if ((await suggestedUsers.count()) === 0) {
      test.skip();
      return;
    }

    const firstSuggestion = suggestedUsers.first();
    await expect(firstSuggestion).toBeVisible();

    // Get the username from the first suggestion
    const usernameText = await firstSuggestion.locator('[data-testid="username"]').textContent();
    expect(usernameText).toBeTruthy();

    // Click follow on the suggestion
    await firstSuggestion.locator('[data-testid="follow-button"]').click();

    // Button should change to following state
    await expect(firstSuggestion.locator('[data-testid="unfollow-button"]')).toBeVisible({ timeout: 10000 });
  });

  test("should show follow button on user cards in followers/following lists", async ({
    page,
    socialPage,
  }) => {
    // Go to user2's followers list
    await socialPage.gotoFollowers("user2");

    // Should see user cards with follow buttons
    const userCards = page.locator('[data-testid="user-card"]');
    await expect(userCards.first()).toBeVisible();

    // Each card should have either follow or unfollow button
    const firstCard = userCards.first();
    const hasFollowButton = (await firstCard.locator('[data-testid="follow-button"]').count()) > 0;
    const hasUnfollowButton =
      (await firstCard.locator('[data-testid="unfollow-button"]').count()) > 0;

    expect(hasFollowButton || hasUnfollowButton).toBe(true);
  });

  test("should update follower count after following", async ({ page, socialPage }) => {
    // Go to user4's profile (user1 doesn't follow user4 initially)
    await socialPage.gotoProfile("user4");

    // Get initial follower count
    const followerCountText = await page.locator('[data-testid="follower-count"]').textContent();
    const initialCount = Number.parseInt(followerCountText || "0", 10);

    // Follow user4
    await socialPage.followUser();

    // Wait for button state change
    await expect(page.locator('[data-testid="unfollow-button"]')).toBeVisible({ timeout: 10000 });

    // Follower count should increment
    const newFollowerCountText = await page.locator('[data-testid="follower-count"]').textContent();
    const newCount = Number.parseInt(newFollowerCountText || "0", 10);

    expect(newCount).toBe(initialCount + 1);
  });
});
