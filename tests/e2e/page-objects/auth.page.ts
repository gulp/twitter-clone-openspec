import type { Page } from "@playwright/test";

/**
 * Page object for authentication flows
 */
export class AuthPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/login");
  }

  async gotoRegister() {
    await this.page.goto("/register");
  }

  async gotoResetPassword() {
    await this.page.goto("/reset-password");
  }

  async login(email: string, password: string) {
    await this.page.fill('input[name="email"]', email);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('button[type="submit"]');
  }

  async register(email: string, username: string, displayName: string, password: string) {
    await this.page.fill('input[name="email"]', email);
    await this.page.fill('input[name="username"]', username);
    await this.page.fill('input[name="displayName"]', displayName);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('button[type="submit"]');
  }

  async requestPasswordReset(email: string) {
    await this.page.fill('input[name="email"]', email);
    await this.page.click('button[type="submit"]');
  }

  async completePasswordReset(token: string, newPassword: string) {
    await this.page.goto(`/reset-password/${token}`);
    await this.page.fill('input[name="password"]', newPassword);
    await this.page.click('button[type="submit"]');
  }

  async logout() {
    // Click user menu
    await this.page.click('[data-testid="user-menu"]');
    // Click logout button
    await this.page.click('[data-testid="logout-button"]');
  }

  async expectLoginPage() {
    await this.page.waitForURL("/login");
  }

  async expectHomePage() {
    await this.page.waitForURL("/home");
  }
}
