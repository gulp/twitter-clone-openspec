import { test, expect } from "@playwright/test";
import { NewUser, register, screenshot } from "../helpers/personas";

/**
 * STORY: As Dana (a new visitor), I want to create an account
 *        so I can start posting and following people.
 *
 * Persona: Dana — brand new user, never used the platform
 * Precondition: Database is seeded with Alice, Bob, Charlie (via npm run db:reset before test run)
 */

test.describe("US1: Registration", () => {

  test("SCENARIO: Dana visits the site and sees the login page", async ({ page }) => {
    // GIVEN Dana navigates to the app
    await page.goto("/");

    // THEN she is redirected to login
    await page.waitForURL("**/login");
    await expect(page.locator("h1")).toContainText("Sign in");
    await screenshot(page, "01-login-page");
  });

  test("SCENARIO: Dana navigates to registration", async ({ page }) => {
    // GIVEN Dana is on the login page
    await page.goto("/login");

    // WHEN she clicks "Sign up"
    await page.click('a:has-text("Sign up")');

    // THEN she sees the registration form
    await page.waitForURL("**/register");
    await expect(page.locator("h1")).toContainText("Create your account");
    await screenshot(page, "02-register-page");
  });

  test("SCENARIO: Dana registers successfully", async ({ page }) => {
    // GIVEN Dana is on the registration page
    // WHEN she fills in valid details and submits
    await register(page, NewUser);

    // THEN she is logged in and sees the home feed
    await expect(page.locator("h1")).toContainText("Home");
    await screenshot(page, "03-registered-home");
  });

  test("SCENARIO: Duplicate username is rejected", async ({ page }) => {
    // GIVEN Dana's account already exists from the previous test
    await page.goto("/register");

    // WHEN someone tries to register with the same username
    await page.fill('input[placeholder="Display name"]', "Duplicate");
    await page.fill('input[placeholder="Username"]', NewUser.username);
    await page.fill('input[type="email"]', "other@example.com");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');

    // THEN an error message is shown
    await page.waitForTimeout(2000);
    await expect(page.locator('[class*="red"]')).toBeVisible();
    await screenshot(page, "04-duplicate-username-error");
  });
});
