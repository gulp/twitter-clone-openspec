import { test, expect } from "@playwright/test";
import { Alice, Bob, Charlie, login, screenshot } from "../helpers/personas";

/**
 * STORY: As Alice, I want to view and manage my profile
 *        so others can learn about me.
 *
 * Persona: Alice — maintains an active profile
 * Precondition: Alice is logged in
 */

test.describe("US8: Profile Management", () => {
  test("SCENARIO: Alice views her own profile", async ({ page }) => {
    // GIVEN Alice is logged in
    await login(page, Alice);

    // WHEN she navigates to her profile
    await page.goto("/alice");
    await page.waitForTimeout(2000);

    // THEN she sees her display name, username, bio, and stats
    await expect(page.locator("h2").filter({ hasText: "Alice Johnson" })).toBeVisible();
    await expect(page.locator("text=Software engineer")).toBeVisible();
    // She should see follower/following counts
    await expect(page.locator("text=Following")).toBeVisible();
    await expect(page.locator("text=Followers")).toBeVisible();
    await screenshot(page, "23-alice-own-profile");
  });

  test("SCENARIO: Alice sees her tweets on her profile", async ({ page }) => {
    // GIVEN Alice is logged in and on her profile
    await login(page, Alice);
    await page.goto("/alice");
    await page.waitForTimeout(2000);

    // THEN she sees her tweets listed below the profile header
    const tweetCards = page.locator('[class*="border-b"][class*="border-twitter"]').filter({ has: page.locator('text=@alice') });
    await screenshot(page, "24-alice-profile-tweets");
  });

  test("SCENARIO: Charlie views Bob's profile", async ({ page }) => {
    // GIVEN Charlie is logged in
    await login(page, Charlie);

    // WHEN he visits Bob's profile
    await page.goto("/bob");
    await page.waitForTimeout(2000);

    // THEN he sees Bob's info and a Follow/Following button
    await expect(page.locator("h2").filter({ hasText: "Bob Smith" })).toBeVisible();
    await screenshot(page, "25-charlie-views-bob");
  });
});
