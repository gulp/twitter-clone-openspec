# E2E Page Objects Pattern

## What

Page Objects encapsulate UI interactions and element selectors into reusable classes, separating test logic from implementation details. Each page object represents a logical section of the app (auth, feed, profile) and provides high-level methods that hide DOM selectors and low-level Playwright API calls. This pattern reduces test brittleness and centralizes selector maintenance.

## Where

Page object implementations:
- `tests/e2e/page-objects/auth.page.ts:1-61` — Authentication flows
- `tests/e2e/page-objects/feed.page.ts:1-69` — Feed interactions
- `tests/e2e/page-objects/composer.page.ts` — Tweet composition
- `tests/e2e/page-objects/profile.page.ts` — Profile pages
- `tests/e2e/page-objects/social.page.ts` — Follow/unfollow
- `tests/e2e/page-objects/search.page.ts` — Search UI
- `tests/e2e/page-objects/notification.page.ts` — Notifications

Fixture setup:
- `tests/e2e/fixtures.ts:1-59` — Playwright fixture that injects page objects into tests

Test usage examples:
- `tests/e2e/specs/auth.spec.ts` — Login/register/reset flows
- `tests/e2e/specs/feed.spec.ts` — Feed loading, infinite scroll, new tweets indicator
- `tests/e2e/specs/tweet.spec.ts` — Tweet creation, deletion
- `tests/e2e/specs/social.spec.ts` — Follow/unfollow UI

## How It Works

### Page Object Structure

Each page object is a TypeScript class that encapsulates:
1. **Navigation** — Methods to navigate to the page
2. **Actions** — Methods to interact with elements (click, fill, etc.)
3. **Assertions** — Methods to verify page state

Example: `AuthPage`

```typescript
// tests/e2e/page-objects/auth.page.ts:6-60
export class AuthPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/login");
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

  async expectHomePage() {
    await this.page.waitForURL("/home");
  }
}
```

**Selector strategy:** Use `data-testid` attributes for stable selectors. Avoid class names (brittle) and text content (i18n-fragile).

### Fixture Integration

Playwright fixtures inject page objects into tests:

```typescript
// tests/e2e/fixtures.ts:14-44
export const test = base.extend<{
  authPage: AuthPage;
  composerPage: ComposerPage;
  feedPage: FeedPage;
  notificationPage: NotificationPage;
  profilePage: ProfilePage;
  searchPage: SearchPage;
  socialPage: SocialPage;
}>({
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },
  composerPage: async ({ page }, use) => {
    await use(new ComposerPage(page));
  },
  feedPage: async ({ page }, use) => {
    await use(new FeedPage(page));
  },
  // ... other page objects
});
```

Usage in tests:

```typescript
// tests/e2e/specs/auth.spec.ts
import { test, expect } from "../fixtures";

test("user can log in", async ({ authPage }) => {
  await authPage.goto();
  await authPage.login("test@example.com", "password123");
  await authPage.expectHomePage();
});
```

The `authPage` parameter is automatically injected by the fixture and shares the same `page` instance across all page objects in the test.

### Action Methods

Action methods perform user interactions and hide selector implementation details:

```typescript
// tests/e2e/page-objects/feed.page.ts:30-39
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
```

**Encapsulation benefit:** If the delete UI changes (e.g., menu becomes a dropdown), only this method needs updating, not every test that deletes tweets.

### Assertion Methods

Assertion methods verify page state and return booleans or throw Playwright timeouts:

```typescript
// tests/e2e/page-objects/feed.page.ts:17-21
async expectTweetInFeed(content: string) {
  const tweet = this.page.locator(`[data-testid="tweet-card"]:has-text("${content}")`);
  await tweet.waitFor({ state: "visible" });
  return true;
}

// tests/e2e/page-objects/feed.page.ts:23-28
async expectTweetNotInFeed(content: string) {
  const tweet = this.page.locator(`[data-testid="tweet-card"]:has-text("${content}")`);
  await tweet.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  const count = await tweet.count();
  return count === 0;
}
```

**Timeout strategy:** Positive assertions (`expectTweetInFeed`) use default Playwright timeout (30s). Negative assertions (`expectTweetNotInFeed`) use short timeout (5s) to fail fast.

### Locator Patterns

#### data-testid Selectors

Preferred for all interactive elements:

```typescript
// tests/e2e/page-objects/feed.page.ts:18
const tweet = this.page.locator(`[data-testid="tweet-card"]:has-text("${content}")`);

// tests/e2e/page-objects/feed.page.ts:34
await tweetCard.locator('[data-testid="tweet-menu"]').click();
```

**Implementation requirement:** Frontend components must add `data-testid` attributes to elements that E2E tests interact with.

#### Named Input Selectors

For form inputs, use `name` attribute:

```typescript
// tests/e2e/page-objects/auth.page.ts:22-23
await this.page.fill('input[name="email"]', email);
await this.page.fill('input[name="password"]', password);
```

#### Text-Based Selectors (Avoid)

Only use text selectors when combined with `data-testid` for scoping:

```typescript
// tests/e2e/page-objects/feed.page.ts:18
const tweet = this.page.locator(`[data-testid="tweet-card"]:has-text("${content}")`);
```

Never use bare text selectors like `.locator('text=Login')` — they break with i18n or copy changes.

### Navigation Methods

Each page object provides navigation to its page(s):

```typescript
// tests/e2e/page-objects/auth.page.ts:9-19
async goto() {
  await this.page.goto("/login");
}

async gotoRegister() {
  await this.page.goto("/register");
}

async gotoResetPassword() {
  await this.page.goto("/reset-password");
}
```

**Naming convention:** `goto()` for primary page, `gotoXYZ()` for related pages.

### Real-Time Interaction Methods

Page objects for real-time features use longer timeouts:

```typescript
// tests/e2e/page-objects/feed.page.ts:47-51
async expectNewTweetsIndicator() {
  const indicator = this.page.locator('[data-testid="new-tweets-indicator"]');
  await indicator.waitFor({ state: "visible", timeout: 10000 });
  return true;
}
```

**10-second timeout** accounts for SSE connection establishment and event propagation delays.

## Invariants

**I1: All interactive elements have data-testid**
Every button, input, card, or clickable element used in E2E tests must have a `data-testid` attribute in the component implementation.

**I2: One page object per logical section**
Create a new page object when a section has distinct navigation, actions, and state. Don't create one giant page object for the entire app.

**I3: No assertions in action methods**
Action methods perform interactions (`click`, `fill`) but don't assert outcomes. Assertion methods (`expect*`) verify state separately. This allows tests to compose actions and choose when to verify.

**I4: Page objects share the Playwright Page instance**
All page objects in a test receive the same `page` instance via fixtures. They don't navigate independently — navigation in one page object affects all others.

**I5: Selectors are encapsulated**
Tests never call `page.locator()` directly — they always go through page object methods. Selectors are implementation details hidden inside page objects.

**I6: Async/await everywhere**
All page object methods are `async` and `await` Playwright operations. Never return unwrapped promises.

## Gotchas

**G1: Shared page state across page objects**
If `authPage.login()` navigates to `/home`, then `feedPage.gotoProfile()` will navigate away from `/home`. Tests must understand that all page objects share the same browser tab.

**G2: data-testid must be unique**
If multiple elements have the same `data-testid`, `page.locator()` will return multiple matches and `.click()` will fail. Use unique IDs or combine with scoping selectors.

**G3: Text-based selectors break with i18n**
`has-text("Delete")` breaks when the app is translated to another language. Use `data-testid` for interactive elements; only use text for content verification.

**G4: Timeout on fast-changing UI**
For elements that appear/disappear quickly (toasts, loading spinners), use short explicit timeouts (`timeout: 2000`) to avoid 30-second waits.

**G5: No DOM selectors in tests**
If a test directly calls `page.locator('[data-testid="..."]')`, that's a code smell. Move the selector into a page object method to centralize maintenance.

**G6: waitFor doesn't retry assertions**
`await element.waitFor({ state: "visible" })` only checks visibility, not content. To assert content, use `expect(element).toHaveText(...)` which auto-retries.

**G7: Page object methods must be reusable**
Avoid methods like `loginAsAlice()` that hard-code test data. Instead: `login(email, password)` and let tests pass their own data.

**G8: Fixture lifecycle**
Page objects created by fixtures are instantiated once per test. State stored in page object properties (e.g., `this.currentUser`) persists across method calls within the same test but NOT across tests.
