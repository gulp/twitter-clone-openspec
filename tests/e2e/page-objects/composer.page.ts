import type { Page } from "@playwright/test";

/**
 * Page object for tweet composer
 */
export class ComposerPage {
  constructor(private page: Page) {}

  async createTweet(content: string) {
    // Focus the composer textarea
    await this.page.fill('[data-testid="tweet-composer"]', content);
    // Click tweet button
    await this.page.click('[data-testid="tweet-button"]');
  }

  async createReply(content: string) {
    // Fill reply textarea
    await this.page.fill('[data-testid="reply-composer"]', content);
    // Click reply button
    await this.page.click('[data-testid="reply-button"]');
  }

  async expectCharacterCount(count: number) {
    const counterText = await this.page.textContent('[data-testid="character-counter"]');
    return counterText?.includes(count.toString());
  }

  async expectTweetButtonDisabled() {
    const button = this.page.locator('[data-testid="tweet-button"]');
    return await button.isDisabled();
  }

  async expectTweetButtonEnabled() {
    const button = this.page.locator('[data-testid="tweet-button"]');
    return await button.isEnabled();
  }
}
