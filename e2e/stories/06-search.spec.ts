import { test, expect } from "@playwright/test";
import { Charlie, login, screenshot } from "../helpers/personas";

/**
 * STORY: As Charlie (a selective lurker), I want to search for tweets and people
 *        so I can find interesting content and accounts to follow.
 *
 * Persona: Charlie — reads more than posts, uses search to discover
 * Precondition: Charlie is logged in, database has tweets and users
 */

test.describe("US6: Search", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, Charlie);
  });

  test("SCENARIO: Charlie searches for tweets by keyword", async ({ page }) => {
    // GIVEN Charlie navigates to search
    await page.goto("/search");
    await page.waitForTimeout(1000);

    // WHEN he types a search query
    await page.fill('input[placeholder="Search"]', "project");
    // Wait for 300ms debounce + response
    await page.waitForTimeout(1500);

    // THEN matching tweets are displayed
    await screenshot(page, "17-search-tweets");
  });

  test("SCENARIO: Charlie switches to People tab", async ({ page }) => {
    // GIVEN Charlie is on the search page
    await page.goto("/search");

    // WHEN he searches for a person
    await page.fill('input[placeholder="Search"]', "alice");
    await page.waitForTimeout(500);

    // AND switches to the People tab
    await page.click('button:has-text("People")');
    await page.waitForTimeout(1500);

    // THEN he sees user results
    await screenshot(page, "18-search-people");
  });

  test("SCENARIO: Search with no results", async ({ page }) => {
    // GIVEN Charlie is on the search page
    await page.goto("/search");

    // WHEN he searches for something that doesn't exist
    await page.fill('input[placeholder="Search"]', "xyznonexistent999");
    await page.waitForTimeout(1500);

    // THEN he sees a "no results" message
    await expect(page.locator("text=No tweets found")).toBeVisible();
    await screenshot(page, "19-search-no-results");
  });
});
