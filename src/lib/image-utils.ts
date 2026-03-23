/**
 * Resize an image file to target dimensions using canvas
 */
export async function resizeImage(
  file: File,
  targetWidth: number,
  targetHeight: number
): Promise<File> {
  // Validate inputs
  if (
    targetWidth <= 0 ||
    targetHeight <= 0 ||
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetHeight)
  ) {
    throw new Error("Target dimensions must be positive finite numbers");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    // Timeout to prevent hanging on corrupted images (30 seconds)
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Image processing timeout"));
    }, 30000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      img.src = ""; // Release memory
    };

    img.onload = () => {
      cleanup();
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      // Cover-crop: scale to fill target, then center-crop the overflow
      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
      const scaledW = img.width * scale;
      const scaledH = img.height * scale;
      const offsetX = (targetWidth - scaledW) / 2;
      const offsetY = (targetHeight - scaledH) / 2;
      ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to create blob from canvas"));
            return;
          }

          // Create new file with same name and type
          const resizedFile = new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now(),
          });

          resolve(resizedFile);
        },
        file.type,
        0.95 // JPEG quality
      );
    };

    img.onerror = () => {
      cleanup();
      reject(new Error("Failed to load image"));
    };

    // Load the image from file
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error("Failed to read file"));
    };
    reader.readAsDataURL(file);
  });
}
