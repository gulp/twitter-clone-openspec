import type { Page } from "@playwright/test";

/**
 * Page object for feed interactions
 */
export class FeedPage {
  constructor(private page: Page) {}

  async gotoHome() {
    await this.page.goto("/home");
  }

  async gotoProfile(username: string) {
    await this.page.goto(`/${username}`);
  }

  async expectTweetInFeed(content: string) {
    const tweet = this.page.locator(`[data-testid="tweet-card"]:has-text("${content}")`);
    await tweet.waitFor({ state: "visible" });
    return true;
  }

  async expectTweetNotInFeed(content: string) {
    const tweet = this.page.locator(`[data-testid="tweet-card"]:has-text("${content}")`);
    await tweet.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    const count = await tweet.count();
    return count === 0;
  }

  async deleteTweet(content: string) {
    // Find the tweet card
    const tweetCard = this.page.locator(`[data-testid="tweet-card"]:has-text("${content}")`);
    // Click the tweet menu
    await tweetCard.locator('[data-testid="tweet-menu"]').click();
    // Click delete
    await this.page.click('[data-testid="delete-tweet"]');
    // Confirm delete in modal
    await this.page.click('[data-testid="confirm-delete"]');
  }

  async scrollToBottom() {
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
  }

  async expectNewTweetsIndicator() {
    const indicator = this.page.locator('[data-testid="new-tweets-indicator"]');
    await indicator.waitFor({ state: "visible", timeout: 10000 });
    return true;
  }

  async clickNewTweetsIndicator() {
    await this.page.click('[data-testid="new-tweets-indicator"]');
  }

  async expectEmptyFeed() {
    const emptyState = this.page.locator('[data-testid="empty-feed"]');
    await emptyState.waitFor({ state: "visible" });
    return true;
  }

  async expectLoadingMore() {
    const spinner = this.page.locator('[data-testid="loading-more"]');
    await spinner.waitFor({ state: "visible" });
    return true;
  }
}
