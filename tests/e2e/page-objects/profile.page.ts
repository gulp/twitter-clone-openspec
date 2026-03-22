import type { Page } from "@playwright/test";

/**
 * Page object for profile flows
 */
export class ProfilePage {
  constructor(private page: Page) {}

  async goto(username: string) {
    await this.page.goto(`/${username}`);
  }

  async waitForLoaded() {
    // Wait for profile header to appear (display name heading)
    await this.page.locator("h1").first().waitFor({ state: "visible" });
  }

  async getDisplayName() {
    // The display name is in the profile header section, not the sticky nav
    const header = this.page.locator("h1").nth(1);
    return header.textContent();
  }

  async getUsername() {
    return this.page.locator('p:has-text("@")').first().textContent();
  }

  async getBio() {
    // Bio is a <p> with whitespace-pre-wrap class
    const bio = this.page.locator("p.whitespace-pre-wrap");
    if ((await bio.count()) === 0) return null;
    return bio.textContent();
  }

  async getFollowerCount() {
    const link = this.page.locator('a[href$="/followers"]');
    const text = await link.locator("span").first().textContent();
    return Number.parseInt(text || "0", 10);
  }

  async getFollowingCount() {
    const link = this.page.locator('a[href$="/following"]');
    const text = await link.locator("span").first().textContent();
    return Number.parseInt(text || "0", 10);
  }

  async getTweetCount() {
    // Tweet count is in the sticky nav header, e.g. "42 Tweets"
    const countText = await this.page.locator('p:has-text("Tweet")').first().textContent();
    return Number.parseInt(countText || "0", 10);
  }

  async clickEditProfile() {
    await this.page.getByRole("button", { name: "Edit profile" }).click();
  }

  async clickTab(tab: "Tweets" | "Replies" | "Likes") {
    await this.page.getByRole("button", { name: tab }).click();
  }

  async expectTabActive(tab: "Tweets" | "Replies" | "Likes") {
    const button = this.page.getByRole("button", { name: tab });
    await button.waitFor({ state: "visible" });
    // Active tab has aria-current="page"
    return button.getAttribute("aria-current");
  }

  async fillEditModal(fields: { displayName?: string; bio?: string }) {
    if (fields.displayName !== undefined) {
      const input = this.page.locator("#displayName");
      await input.clear();
      await input.fill(fields.displayName);
    }
    if (fields.bio !== undefined) {
      const textarea = this.page.locator("#bio");
      await textarea.clear();
      await textarea.fill(fields.bio);
    }
  }

  async saveEditModal() {
    await this.page.getByRole("button", { name: "Save" }).click();
  }

  async closeEditModal() {
    await this.page.getByLabel("Close").click();
  }

  async expectEditModalVisible() {
    await this.page.getByText("Edit profile", { exact: true }).nth(1).waitFor({ state: "visible" });
  }

  async expectFollowButton() {
    await this.page.getByRole("button", { name: "Follow" }).waitFor({ state: "visible" });
  }

  async expectFollowingButton() {
    await this.page.getByRole("button", { name: "Following" }).waitFor({ state: "visible" });
  }
}
