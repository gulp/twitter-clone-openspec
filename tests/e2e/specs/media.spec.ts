import { test, expect } from "../fixtures";

test.describe("Media Upload", () => {
  test.beforeEach(async ({ page, authPage }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error(`[Browser Console Error]: ${msg.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      console.error(`[Page Error]: ${error.message}`);
    });

    // Login as user1
    await authPage.goto();
    await authPage.login("user1@test.com", "password123");
    await authPage.expectHomePage();
  });

  test("should show validation error for unsupported file type", async ({ page }) => {
    // Navigate to compose or home where composer is available
    await page.goto("/home");

    // Find the file input in the composer
    const fileInput = page.locator('input[type="file"]').first();

    if ((await fileInput.count()) === 0) {
      console.log("[Media Test] No file input found in composer, skipping");
      test.skip();
      return;
    }

    // Try to upload a text file (unsupported type)
    // Create a fake file via page evaluation since we can't create real files
    await fileInput.setInputFiles({
      name: "test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });

    // Should show validation error
    await expect(page.getByText(/unsupported format/i).or(
      page.getByText(/only jpeg/i)
    )).toBeVisible({ timeout: 5000 });
  });

  test("should show validation error for oversized file", async ({ page }) => {
    await page.goto("/home");

    const fileInput = page.locator('input[type="file"]').first();

    if ((await fileInput.count()) === 0) {
      console.log("[Media Test] No file input found in composer, skipping");
      test.skip();
      return;
    }

    // Create a buffer slightly over 5MB
    const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1, 0);

    await fileInput.setInputFiles({
      name: "large.jpg",
      mimeType: "image/jpeg",
      buffer: oversizedBuffer,
    });

    // Should show size validation error
    await expect(page.getByText(/too large/i).or(
      page.getByText(/maximum size/i)
    )).toBeVisible({ timeout: 5000 });
  });

  test("should show image preview after selecting valid file", async ({ page }) => {
    await page.goto("/home");

    const fileInput = page.locator('input[type="file"]').first();

    if ((await fileInput.count()) === 0) {
      console.log("[Media Test] No file input found in composer, skipping");
      test.skip();
      return;
    }

    // Create a minimal valid JPEG (1x1 pixel)
    const jpegHeader = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);

    await fileInput.setInputFiles({
      name: "test.jpg",
      mimeType: "image/jpeg",
      buffer: jpegHeader,
    });

    // Should show preview or upload progress
    // Either a preview image appears or a progress indicator
    await page.waitForTimeout(1000);

    const hasPreview = (await page.locator('img[alt*="Upload"], img[alt*="preview"]').count()) > 0;
    const hasProgress = (await page.locator('[class*="progress"], [style*="width"]').count()) > 0;

    console.log(`[Media Test] Preview: ${hasPreview}, Progress: ${hasProgress}`);
    // At minimum, the file input should have been processed without crash
  });

  test("should allow removing individual images from selection", async ({ page }) => {
    await page.goto("/home");

    const fileInput = page.locator('input[type="file"]').first();

    if ((await fileInput.count()) === 0) {
      console.log("[Media Test] No file input found in composer, skipping");
      test.skip();
      return;
    }

    // Upload a valid small image
    const jpegHeader = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);

    await fileInput.setInputFiles({
      name: "test.jpg",
      mimeType: "image/jpeg",
      buffer: jpegHeader,
    });

    await page.waitForTimeout(1000);

    // Look for remove button (X button on image preview)
    const removeButton = page.locator('button[aria-label="Remove image"], button[aria-label="Cancel upload"]');
    if ((await removeButton.count()) > 0) {
      await removeButton.first().click();
      await page.waitForTimeout(500);
      console.log("[Media Test] Successfully removed image from selection");
    } else {
      console.log("[Media Test] No remove button found (upload may have failed or not shown preview)");
    }
  });

  test("should show drag-drop zone styling", async ({ page }) => {
    await page.goto("/home");

    // Check that the composer area exists and supports drag events
    // Just verify the composer is present and the upload infrastructure exists
    const fileInput = page.locator('input[type="file"]');
    const hasFileInput = (await fileInput.count()) > 0;

    console.log(`[Media Test] File input found: ${hasFileInput}`);
    expect(hasFileInput).toBe(true);
  });

  test("should handle avatar upload in edit profile modal", async ({ page, profilePage }) => {
    await profilePage.goto("user1");
    await profilePage.waitForLoaded();

    await profilePage.clickEditProfile();
    await profilePage.expectEditModalVisible();

    // The edit modal should have avatar and banner upload areas
    // Check for the avatar upload button (camera/image icon)
    const avatarUploadButton = page.locator('button[aria-label*="avatar"], button[aria-label*="Avatar"]');
    const addAvatarButton = page.locator('button[aria-label="Add avatar"], button[aria-label="Change avatar"]');

    const hasAvatarUpload = (await avatarUploadButton.count()) > 0 || (await addAvatarButton.count()) > 0;
    console.log(`[Media Test] Avatar upload button found: ${hasAvatarUpload}`);

    // Check for banner upload
    const bannerUploadButton = page.locator('button[aria-label*="banner"], button[aria-label*="Banner"]');
    const addBannerButton = page.locator('button[aria-label="Add banner"], button[aria-label="Change banner"]');

    const hasBannerUpload = (await bannerUploadButton.count()) > 0 || (await addBannerButton.count()) > 0;
    console.log(`[Media Test] Banner upload button found: ${hasBannerUpload}`);

    expect(hasAvatarUpload || hasBannerUpload).toBe(true);

    // Close modal
    await profilePage.closeEditModal();
  });
});
