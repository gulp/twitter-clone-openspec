import type { Page } from "@playwright/test";

/**
 * Page object for social interactions
 */
export class SocialPage {
  constructor(private page: Page) {}

  async gotoProfile(username: string) {
    await this.page.goto(`/${username}`);
  }

  async followUser() {
    await this.page.click('[data-testid="follow-button"]');
  }

  async unfollowUser() {
    await this.page.click('[data-testid="unfollow-button"]');
  }

  async expectFollowButton() {
    const button = this.page.locator('[data-testid="follow-button"]');
    await button.waitFor({ state: "visible" });
    return true;
  }

  async expectUnfollowButton() {
    const button = this.page.locator('[data-testid="unfollow-button"]');
    await button.waitFor({ state: "visible" });
    return true;
  }

  async gotoFollowers(username: string) {
    await this.page.goto(`/${username}/followers`);
  }

  async gotoFollowing(username: string) {
    await this.page.goto(`/${username}/following`);
  }

  async expectUserInList(username: string) {
    const userCard = this.page.locator(`[data-testid="user-card"]:has-text("@${username}")`);
    await userCard.waitFor({ state: "visible" });
    return true;
  }

  async followUserFromWhoToFollow(username: string) {
    const userCard = this.page.locator(`[data-testid="who-to-follow-card"]:has-text("@${username}")`);
    await userCard.locator('[data-testid="follow-button"]').click();
  }

  async expectWhoToFollowCard(username: string) {
    const card = this.page.locator(`[data-testid="who-to-follow-card"]:has-text("@${username}")`);
    await card.waitFor({ state: "visible" });
    return true;
  }
}
