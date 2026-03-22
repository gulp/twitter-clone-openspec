import type { Page } from "@playwright/test";

/**
 * Page object for search flows
 */
export class SearchPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/search");
  }

  async gotoWithQuery(query: string) {
    await this.page.goto(`/search?q=${encodeURIComponent(query)}`);
  }

  async typeQuery(query: string) {
    const input = this.page.locator('input[type="text"], input[type="search"]').first();
    await input.clear();
    await input.fill(query);
  }

  async clearQuery() {
    // Look for clear button or clear the input
    const clearButton = this.page.locator('button[aria-label="Clear"]');
    if ((await clearButton.count()) > 0) {
      await clearButton.click();
    } else {
      const input = this.page.locator('input[type="text"], input[type="search"]').first();
      await input.clear();
    }
  }

  async clickTab(tab: "Tweets" | "People") {
    await this.page.getByRole("tab", { name: tab }).or(
      this.page.locator(`button:has-text("${tab}")`)
    ).first().click();
  }

  async waitForResults() {
    // Wait for either results or empty state to appear
    await this.page.waitForTimeout(500); // debounce
    await this.page.locator('[class*="animate-spin"]').waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  }

  async getTweetResultCount() {
    // Tweet cards in search results
    const cards = this.page.locator('article, [class*="tweet-card"], [class*="border-b"]').filter({
      hasText: /.+/,
    });
    return cards.count();
  }

  async getUserResultCount() {
    // User cards with @ usernames
    const cards = this.page.locator('a[href^="/"], div').filter({
      hasText: /@\w+/,
    });
    return cards.count();
  }

  async expectEmptyState() {
    await this.page.getByText(/no (tweets|people) found/i).waitFor({ state: "visible", timeout: 10000 });
  }

  async expectSearchPage() {
    await this.page.waitForURL(/\/search/);
  }

  async getUrlQuery() {
    const url = new URL(this.page.url());
    return url.searchParams.get("q");
  }

  async getUrlTab() {
    const url = new URL(this.page.url());
    return url.searchParams.get("tab");
  }
}
