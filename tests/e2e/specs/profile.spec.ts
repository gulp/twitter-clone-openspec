import { test, expect } from "../fixtures";

test.describe("Profile", () => {
  test.beforeEach(async ({ page, authPage }) => {
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

  test("should view own profile with correct stats", async ({ page, profilePage }) => {
    await profilePage.goto("user1");
    await profilePage.waitForLoaded();

    // Display name visible
    await expect(page.getByText("User One").first()).toBeVisible();

    // Username visible
    await expect(page.getByText("@user1").first()).toBeVisible();

    // Stats visible — follower/following counts exist
    const followingLink = page.locator('a[href="/user1/following"]');
    await expect(followingLink).toBeVisible();

    const followersLink = page.locator('a[href="/user1/followers"]');
    await expect(followersLink).toBeVisible();

    // Tweet count visible in header
    await expect(page.getByText(/Tweet/)).toBeVisible();
  });

  test("should edit profile display name and bio", async ({ page, profilePage }) => {
    await profilePage.goto("user1");
    await profilePage.waitForLoaded();

    // Click Edit profile
    await profilePage.clickEditProfile();
    await profilePage.expectEditModalVisible();

    const timestamp = Date.now();
    const newDisplayName = `Updated User ${timestamp}`;
    const newBio = `Bio updated at ${timestamp}`;

    // Fill in new values
    await profilePage.fillEditModal({
      displayName: newDisplayName,
      bio: newBio,
    });

    // Save
    await profilePage.saveEditModal();

    // Wait for modal to close and profile to update
    await page.waitForTimeout(1000);

    // Verify updated values appear on profile
    await expect(page.getByText(newDisplayName).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(newBio)).toBeVisible({ timeout: 10000 });
  });

  test("should view other user's profile", async ({ page, profilePage }) => {
    await profilePage.goto("user2");
    await profilePage.waitForLoaded();

    // Should see user2's display name
    await expect(page.getByText("User Two").first()).toBeVisible();
    await expect(page.getByText("@user2").first()).toBeVisible();

    // Should see Follow/Following button (not Edit profile)
    const editButton = page.getByRole("button", { name: "Edit profile" });
    await expect(editButton).toHaveCount(0);

    // Should see either Follow or Following button
    const followButton = page.getByRole("button", { name: /Follow/ });
    await expect(followButton.first()).toBeVisible();
  });

  test("should switch between Tweets, Replies, and Likes tabs", async ({ page, profilePage }) => {
    await profilePage.goto("user1");
    await profilePage.waitForLoaded();

    // Default tab is Tweets
    const tweetsTab = page.getByRole("button", { name: "Tweets" });
    await expect(tweetsTab).toHaveAttribute("aria-current", "page");

    // Click Replies tab
    await profilePage.clickTab("Replies");
    await page.waitForTimeout(500);

    const repliesTab = page.getByRole("button", { name: "Replies" });
    await expect(repliesTab).toHaveAttribute("aria-current", "page");

    // Click Likes tab
    await profilePage.clickTab("Likes");
    await page.waitForTimeout(500);

    const likesTab = page.getByRole("button", { name: "Likes" });
    await expect(likesTab).toHaveAttribute("aria-current", "page");

    // Click back to Tweets
    await profilePage.clickTab("Tweets");
    await page.waitForTimeout(500);
    await expect(tweetsTab).toHaveAttribute("aria-current", "page");
  });

  test("should show 404-style message for non-existent user", async ({ page, profilePage }) => {
    await profilePage.goto("nonexistentuser999");

    // Should show account doesn't exist message
    await expect(page.getByText("This account doesn't exist")).toBeVisible({ timeout: 10000 });
  });
});
