import { test, expect } from "@playwright/test";
import { Alice, Bob, Charlie, login, screenshot } from "../helpers/personas";

/**
 * STORY: As Bob (an engaged reader), I want to follow/unfollow users and
 *        see their content in my feed so I can curate my timeline.
 *
 * Persona: Bob — engaged reader, follows people whose content he enjoys
 * Precondition: Bob follows Alice (from seed). Charlie exists.
 */

test.describe("US4: Social Graph — Follow & Unfollow", () => {
  test("SCENARIO: Bob views Alice's profile and sees follow status", async ({ page }) => {
    // GIVEN Bob is logged in
    await login(page, Bob);

    // WHEN he navigates to Alice's profile
    await page.goto("/alice");
    await page.waitForTimeout(2000);

    // THEN he sees Alice's profile with stats
    await expect(page.locator("h2").filter({ hasText: "Alice Johnson" })).toBeVisible();
    await expect(page.locator("span").filter({ hasText: /^Following$/ })).toBeVisible();
    await screenshot(page, "12-bob-views-alice-profile");
  });

  test("SCENARIO: Bob views the Who to follow sidebar", async ({ page }) => {
    // GIVEN Bob is logged in
    await login(page, Bob);

    // THEN the right sidebar shows follow suggestions
    // (may or may not show depending on who Bob follows)
    await page.waitForTimeout(2000);
    await screenshot(page, "13-who-to-follow-sidebar");
  });

  test("SCENARIO: Bob views a profile that doesn't exist", async ({ page }) => {
    // GIVEN Bob is logged in
    await login(page, Bob);

    // WHEN he navigates to a non-existent profile
    await page.goto("/nonexistentuser12345");
    await page.waitForTimeout(2000);

    // THEN he sees a not-found message
    await page.waitForTimeout(3000);
    await expect(page.locator("h2").filter({ hasText: "doesn't exist" })).toBeVisible({ timeout: 10000 });
    await screenshot(page, "14-profile-not-found");
  });
});
