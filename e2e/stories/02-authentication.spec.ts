import { test, expect } from "@playwright/test";
import { Alice, Bob, login, screenshot } from "../helpers/personas";

/**
 * STORY: As Alice (a returning user), I want to log in and log out
 *        so I can access my account securely.
 *
 * Persona: Alice — power user, posts frequently
 * Precondition: Alice's account exists in seeded DB
 */

test.describe("US2: Authentication", () => {
  test("SCENARIO: Alice logs in with valid credentials", async ({ page }) => {
    // GIVEN Alice has an account
    // WHEN she logs in with correct email and password
    await login(page, Alice);

    // THEN she sees her home feed
    await expect(page.locator("h1")).toContainText("Home");
    await screenshot(page, "05-alice-logged-in-home");
  });

  test("SCENARIO: Invalid credentials show error", async ({ page }) => {
    // GIVEN Alice is on the login page
    await page.goto("/login");

    // WHEN she enters wrong password
    await page.fill('input[type="email"]', Alice.email);
    await page.fill('input[type="password"]', "wrongpassword");
    await page.click('button[type="submit"]');

    // THEN an error is displayed
    await page.waitForTimeout(2000);
    await expect(page.locator("text=Invalid email or password")).toBeVisible();
    await screenshot(page, "06-invalid-login");
  });

  test("SCENARIO: Alice logs out", async ({ page }) => {
    // GIVEN Alice is logged in
    await login(page, Alice);

    // WHEN she clicks her profile button in sidebar (which triggers signOut)
    const profileButton = page.locator("aside button").last();
    await profileButton.click();

    // THEN she is redirected to login
    await page.waitForURL("**/login", { timeout: 10000 });
    await screenshot(page, "07-logged-out");
  });
});
