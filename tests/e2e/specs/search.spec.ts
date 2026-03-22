import { test, expect } from "../fixtures";

test.describe("Search", () => {
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

  test("should show initial search page with prompt", async ({ page, searchPage }) => {
    await searchPage.goto();
    await searchPage.expectSearchPage();

    // Should show search prompt
    await expect(page.getByText("Search Twitter")).toBeVisible();
  });

  test("should search for tweets and show results", async ({ page, searchPage }) => {
    await searchPage.goto();

    // Type a search query that matches seeded tweets
    await searchPage.typeQuery("hello");

    // Wait for debounce + results
    await page.waitForTimeout(500);
    await searchPage.waitForResults();

    // URL should be updated with query
    await page.waitForTimeout(300);
    const urlQuery = await searchPage.getUrlQuery();
    expect(urlQuery).toBe("hello");
  });

  test("should switch between Tweets and People tabs", async ({ page, searchPage }) => {
    await searchPage.gotoWithQuery("user");

    // Wait for results to load
    await searchPage.waitForResults();

    // Click People tab
    await searchPage.clickTab("People");
    await page.waitForTimeout(500);

    // URL should have tab=people
    const urlTab = await searchPage.getUrlTab();
    expect(urlTab).toBe("people");

    // Switch back to Tweets
    await searchPage.clickTab("Tweets");
    await page.waitForTimeout(500);
  });

  test("should search for users in People tab", async ({ page, searchPage }) => {
    await searchPage.gotoWithQuery("user");

    // Switch to People tab
    await searchPage.clickTab("People");
    await searchPage.waitForResults();

    // Should show user results with @username
    await expect(page.getByText(/@user\d/).first()).toBeVisible({ timeout: 10000 });
  });

  test("should persist search query in URL", async ({ page, searchPage }) => {
    await searchPage.goto();

    await searchPage.typeQuery("test query");

    // Wait for debounce to fire
    await page.waitForTimeout(500);

    // URL should contain the query
    await expect(page).toHaveURL(/q=test/);
  });

  test("should show empty state for no results", async ({ page, searchPage }) => {
    await searchPage.goto();

    // Search for something unlikely to match
    await searchPage.typeQuery("zzzzznonexistent999");

    await page.waitForTimeout(500);
    await searchPage.waitForResults();

    // Should show no results message
    await expect(page.getByText(/no tweets found/i)).toBeVisible({ timeout: 10000 });
  });

  test("should enforce minimum query length", async ({ page, searchPage }) => {
    await searchPage.goto();

    // Type single character — should show minimum length message
    await searchPage.typeQuery("a");
    await page.waitForTimeout(500);

    await expect(page.getByText(/at least 2 characters/i)).toBeVisible({ timeout: 5000 });
  });
});
