import { test, expect } from "../fixtures";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    // Capture console logs and network errors for debugging
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error(`[Browser Console Error]: ${msg.text()}`);
      }
    });

    page.on("pageerror", (error) => {
      console.error(`[Page Error]: ${error.message}`);
    });
  });

  test("should register new user and redirect to home", async ({ page, authPage }) => {
    await authPage.gotoRegister();

    const timestamp = Date.now();
    const email = `newuser${timestamp}@test.com`;
    const username = `newuser${timestamp}`;
    const displayName = `New User ${timestamp}`;
    const password = "password123";

    await authPage.register(email, username, displayName, password);

    // Should redirect to home after successful registration
    await authPage.expectHomePage();

    // Home feed should be visible
    await expect(page.locator('[data-testid="home-feed"]')).toBeVisible();
  });

  test("should login with credentials and show home feed", async ({ page, authPage }) => {
    await authPage.goto();

    // Use seeded user credentials
    await authPage.login("user1@test.com", "password123");

    // Should redirect to home after successful login
    await authPage.expectHomePage();

    // Home feed should be visible
    await expect(page.locator('[data-testid="home-feed"]')).toBeVisible();
  });

  test("should logout and redirect to login", async ({ authPage }) => {
    // Login first
    await authPage.goto();
    await authPage.login("user1@test.com", "password123");
    await authPage.expectHomePage();

    // Logout
    await authPage.logout();

    // Should redirect to login page
    await authPage.expectLoginPage();
  });

  test("should complete password reset flow", async ({ page, authPage }) => {
    // Request password reset
    await authPage.gotoResetPassword();
    await authPage.requestPasswordReset("user1@test.com");

    // Verify success message shown
    await expect(page.locator('text="Check your email"')).toBeVisible({ timeout: 10000 });

    // Note: In a real E2E test, we would:
    // 1. Check email inbox (using a test email service)
    // 2. Extract the reset token from the email
    // 3. Complete the reset with the token
    // For now, we verify the request flow completes without error
  });

  test("should show error for invalid credentials", async ({ page, authPage }) => {
    await authPage.goto();

    await authPage.login("user1@test.com", "wrongpassword");

    // Should show error message
    await expect(page.locator('text="Invalid credentials"')).toBeVisible({ timeout: 10000 });

    // Should stay on login page
    await expect(page).toHaveURL("/login");
  });

  test("should show error for non-existent user", async ({ page, authPage }) => {
    await authPage.goto();

    await authPage.login("nonexistent@test.com", "password123");

    // Should show error message
    await expect(page.locator('text="Invalid credentials"')).toBeVisible({ timeout: 10000 });
  });
});
