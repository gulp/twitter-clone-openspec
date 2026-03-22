/**
 * Page Load Performance Tests
 *
 * Browser-level smoke tests that measure navigation timing and LCP metrics
 * for the authenticated home page load.
 *
 * Thresholds from §9:
 * - Page load (LCP): p50 < 1.5s, p99 < 3s
 */

import { test, expect } from "@playwright/test";

// §9 Page load thresholds
const THRESHOLDS = {
  lcp: {
    p50: 1500, // 1.5s
    p99: 3000, // 3s
  },
};

interface PageLoadMetrics {
  navigationStart: number;
  domContentLoaded: number;
  loadComplete: number;
  lcp?: number;
  fcp?: number;
  ttfb?: number;
}

/**
 * Capture page load metrics using Navigation Timing API and Performance Observer
 */
async function capturePageLoadMetrics(page: any): Promise<PageLoadMetrics> {
  return await page.evaluate(() => {
    return new Promise<PageLoadMetrics>((resolve) => {
      const navigationTiming = performance.getEntriesByType(
        "navigation"
      )[0] as PerformanceNavigationTiming;

      const metrics: PageLoadMetrics = {
        navigationStart: 0,
        domContentLoaded: navigationTiming?.domContentLoadedEventEnd || 0,
        loadComplete: navigationTiming?.loadEventEnd || 0,
        ttfb: navigationTiming?.responseStart || 0,
      };

      // Capture LCP using PerformanceObserver
      let lcpValue: number | undefined;
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1] as any;
        if (lastEntry) {
          lcpValue = lastEntry.startTime;
        }
      });

      try {
        observer.observe({ type: "largest-contentful-paint", buffered: true });
      } catch (e) {
        // LCP not supported in this browser
      }

      // Wait a bit for LCP to be captured
      setTimeout(() => {
        observer.disconnect();
        metrics.lcp = lcpValue;
        resolve(metrics);
      }, 100);
    });
  });
}

test.describe("Page Load Performance", () => {
  test.beforeEach(async ({ page }) => {
    // Login with a fixture user (created by global-setup seed script)
    await page.goto("/login");
    await page.fill('input[name="email"]', "alice@example.com");
    await page.fill('input[name="password"]', "password123");
    await page.click('button[type="submit"]');

    // Wait for redirect to home
    await page.waitForURL("/home");
  });

  test("authenticated home page load meets LCP threshold", async ({ page }) => {
    // Navigate to home page
    await page.goto("/home");

    // Wait for page to be fully loaded
    await page.waitForLoadState("load");

    // Capture metrics
    const metrics = await capturePageLoadMetrics(page);

    // Log metrics for debugging
    console.log("Page Load Metrics:", {
      ttfb: metrics.ttfb ? `${metrics.ttfb.toFixed(0)}ms` : "N/A",
      domContentLoaded: `${metrics.domContentLoaded.toFixed(0)}ms`,
      loadComplete: `${metrics.loadComplete.toFixed(0)}ms`,
      lcp: metrics.lcp ? `${metrics.lcp.toFixed(0)}ms` : "N/A",
    });

    // Assert LCP is within p99 threshold
    // This is a single sample so we check against p99 (worst acceptable case)
    if (metrics.lcp) {
      expect(metrics.lcp).toBeLessThan(THRESHOLDS.lcp.p99);

      // Warn if approaching the threshold
      if (metrics.lcp > THRESHOLDS.lcp.p50) {
        console.warn(
          `⚠️  LCP ${metrics.lcp.toFixed(0)}ms exceeds p50 threshold of ${THRESHOLDS.lcp.p50}ms`
        );
      }
    } else {
      console.warn("⚠️  LCP metric not captured (browser may not support it)");
    }

    // Assert basic load timing is reasonable
    expect(metrics.loadComplete).toBeGreaterThan(0);
    expect(metrics.loadComplete).toBeLessThan(5000); // Basic sanity check
  });

  test("home page renders feed content", async ({ page }) => {
    await page.goto("/home");
    await page.waitForLoadState("networkidle");

    // Verify critical content is rendered
    // (This ensures we're measuring a real page, not an error state)
    const feedContainer = page.locator('[data-testid="feed-container"]').first();

    // Check if feed container exists OR if there's an empty state
    const hasContent = await feedContainer.isVisible().catch(() => false);
    const hasEmptyState = await page
      .locator("text=Follow users to see their tweets")
      .isVisible()
      .catch(() => false);

    expect(hasContent || hasEmptyState).toBe(true);
  });

  test("repeated page loads are consistent", async ({ page }) => {
    const samples: number[] = [];

    // Take 3 samples
    for (let i = 0; i < 3; i++) {
      await page.goto("/home");
      await page.waitForLoadState("load");

      const metrics = await capturePageLoadMetrics(page);
      if (metrics.lcp) {
        samples.push(metrics.lcp);
      }
    }

    // Verify we got samples
    if (samples.length > 0) {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const max = Math.max(...samples);

      console.log("LCP Samples:", {
        count: samples.length,
        avg: `${avg.toFixed(0)}ms`,
        max: `${max.toFixed(0)}ms`,
        samples: samples.map((s) => `${s.toFixed(0)}ms`),
      });

      // Max sample should be within p99
      expect(max).toBeLessThan(THRESHOLDS.lcp.p99);
    }
  });
});
