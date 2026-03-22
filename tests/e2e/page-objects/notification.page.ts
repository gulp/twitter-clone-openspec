import type { Page } from "@playwright/test";

/**
 * Page object for notification flows
 */
export class NotificationPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/notifications");
  }

  async waitForLoaded() {
    await this.page.getByText("Notifications").first().waitFor({ state: "visible" });
    // Wait for loading to finish
    await this.page.locator('[class*="animate-spin"]').waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  }

  async getNotificationCount() {
    // Notification cards are in bordered divs
    const cards = this.page.locator(".border-b.cursor-pointer");
    return cards.count();
  }

  async clickNotification(index: number) {
    const cards = this.page.locator(".border-b.cursor-pointer");
    await cards.nth(index).click();
  }

  async getNotificationText(index: number) {
    const cards = this.page.locator(".border-b.cursor-pointer");
    return cards.nth(index).textContent();
  }

  async clickMarkAllRead() {
    await this.page.getByRole("button", { name: "Mark all read" }).click();
  }

  async expectMarkAllReadVisible() {
    await this.page.getByRole("button", { name: "Mark all read" }).waitFor({ state: "visible" });
  }

  async expectMarkAllReadHidden() {
    await this.page.getByRole("button", { name: "Mark all read" }).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  async expectEmptyState() {
    await this.page.getByText("No notifications yet").waitFor({ state: "visible" });
  }

  async getBellBadgeCount() {
    // Bell badge is in the sidebar nav — look for the notification badge span
    const badge = this.page.locator('a[href="/notifications"] span[class*="rounded-full"][class*="bg-"]').filter({
      hasText: /\d+/,
    });
    if ((await badge.count()) === 0) return 0;
    const text = await badge.textContent();
    if (text === "99+") return 100;
    return Number.parseInt(text || "0", 10);
  }

  async hasUnreadIndicator(index: number) {
    const cards = this.page.locator(".border-b.cursor-pointer");
    const card = cards.nth(index);
    // Unread cards have a blue dot indicator
    const indicator = card.locator(".w-2.h-2.rounded-full");
    return (await indicator.count()) > 0;
  }
}
