import { type Page, expect } from "@playwright/test";

/**
 * BDD Personas for Twitter Clone E2E tests.
 *
 * Each persona represents a distinct user archetype with
 * their own credentials, behavior patterns, and goals.
 */

export interface Persona {
  name: string;
  email: string;
  username: string;
  displayName: string;
  password: string;
  bio: string;
  role: string;
}

// Seeded users (already in DB)
export const Alice: Persona = {
  name: "Alice",
  email: "alice@example.com",
  username: "alice",
  displayName: "Alice Johnson",
  password: "password123",
  bio: "Software engineer. Building cool things.",
  role: "Power user — posts frequently, follows many people",
};

export const Bob: Persona = {
  name: "Bob",
  email: "bob@example.com",
  username: "bob",
  displayName: "Bob Smith",
  password: "password123",
  bio: "Designer & developer. Coffee enthusiast.",
  role: "Engaged reader — likes and replies often",
};

export const Charlie: Persona = {
  name: "Charlie",
  email: "charlie@example.com",
  username: "charlie",
  displayName: "Charlie Davis",
  password: "password123",
  bio: "Tech writer. Open source advocate.",
  role: "Lurker — reads more than posts, follows selectively",
};

// New user (not yet registered)
export const NewUser: Persona = {
  name: "Dana",
  email: "dana@example.com",
  username: "dana",
  displayName: "Dana Lee",
  password: "securepass99",
  bio: "Just joined!",
  role: "Brand new user — first time on the platform",
};

/**
 * Helpers for persona-driven actions
 */

export async function login(page: Page, persona: Persona) {
  await page.goto("/login");
  await page.fill('input[type="email"]', persona.email);
  await page.fill('input[type="password"]', persona.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/home", { timeout: 10000 });
}

export async function register(page: Page, persona: Persona) {
  await page.goto("/register");
  await page.fill('input[placeholder="Display name"]', persona.displayName);
  await page.fill('input[placeholder="Username"]', persona.username);
  await page.fill('input[type="email"]', persona.email);
  await page.fill('input[type="password"]', persona.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/home", { timeout: 10000 });
}

export async function composeTweet(page: Page, text: string) {
  await page.fill("textarea", text);
  await page.click('button:has-text("Post")');
  // Wait for the tweet to appear or composer to clear
  await page.waitForTimeout(1000);
}

export async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: `e2e/screenshots/${name}.png`,
    fullPage: false,
  });
}

export async function screenshotFull(page: Page, name: string) {
  await page.screenshot({
    path: `e2e/screenshots/${name}.png`,
    fullPage: true,
  });
}
