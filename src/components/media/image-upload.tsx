"use client";

import { ALLOWED_MIME_TYPES, MAX_MEDIA_SIZE_BYTES } from "@/lib/constants";
import { resizeImage } from "@/lib/image-utils";
import { trpc } from "@/lib/trpc";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface ImageUploadProps {
  urls: string[];
  onChange: (urls: string[]) => void;
  maxImages?: number;
  trigger?: ReactNode;
  purpose?: "tweet" | "avatar" | "banner";
}

interface UploadingFile {
  id: string;
  file: File;
  preview: string;
  progress: number;
  error?: string;
  xhr?: XMLHttpRequest;
}

export function ImageUpload({
  urls,
  onChange,
  maxImages = 4,
  trigger,
  purpose = "tweet",
}: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const uploadingFilesRef = useRef(uploadingFiles);
  uploadingFilesRef.current = uploadingFiles;
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

  const getUploadUrlMutation = trpc.media.getUploadUrl.useMutation();

  // Cleanup preview URLs on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      uploadingFilesRef.current.forEach((file) => {
        URL.revokeObjectURL(file.preview);
        file.xhr?.abort();
      });
    };
  }, []);

  const processFiles = async (files: File[]) => {
    setValidationError(null);

    if (files.length === 0) return;

    // Early check for quick feedback (still may race, but provides immediate UX)
    const remainingSlots = maxImages - urls.length - uploadingFiles.length;
    if (remainingSlots <= 0) {
      setValidationError(`Maximum ${maxImages} image${maxImages > 1 ? "s" : ""} allowed`);
      return;
    }

    const filesToUpload = files.slice(0, remainingSlots);

    // Validate and resize files
    const validFiles: File[] = [];
    for (const file of filesToUpload) {
      // Check file type
      if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
        setValidationError(`Unsupported format. Only JPEG, PNG, GIF, and WebP are allowed.`);
        continue;
      }

      // Check file size
      if (file.size > MAX_MEDIA_SIZE_BYTES) {
        setValidationError(`File too large. Maximum size is 5MB.`);
        continue;
      }

      // Resize based on purpose
      let processedFile = file;
      try {
        if (purpose === "avatar") {
          processedFile = await resizeImage(file, 400, 400);
        } else if (purpose === "banner") {
          processedFile = await resizeImage(file, 1500, 500);
        }
      } catch (error) {
        console.error("Resize failed:", error);
        setValidationError("Failed to process image");
        continue;
      }

      validFiles.push(processedFile);
    }

    // Track which files were actually added after atomic capacity check
    const addedFiles = new Map<string, { file: File; preview: string }>();

    // Create preview URLs and add to uploading queue with atomic capacity check
    for (const file of validFiles) {
      const fileId = Math.random().toString(36).substring(7);
      const preview = URL.createObjectURL(file);

      setUploadingFiles((prev) => {
        // Atomic capacity check with current state — prevents race condition
        if (urls.length + prev.length >= maxImages) {
          URL.revokeObjectURL(preview);
          return prev;
        }

        // File fits, add it and track it for upload
        addedFiles.set(fileId, { file, preview });
        return [...prev, { id: fileId, file, preview, progress: 0 }];
      });
    }

    // Upload only files that were successfully added
    for (const [fileId, { file, preview }] of addedFiles) {
      try {
        // Get pre-signed upload URL
        const { uploadUrl, publicUrl } = await getUploadUrlMutation.mutateAsync({
          filename: file.name,
          contentType: file.type,
          purpose,
        });

        // Upload file to S3
        await uploadToS3(
          uploadUrl,
          file,
          (progress) => {
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === fileId ? { ...f, progress } : f))
            );
          },
          (xhr) => {
            // Store xhr reference so it can be aborted
            setUploadingFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, xhr } : f)));
          }
        );

        // Add to uploaded URLs — use ref for current value to avoid stale closure
        onChange([...urlsRef.current, publicUrl]);

        // Remove from uploading
        setUploadingFiles((prev) => prev.filter((f) => f.id !== fileId));
        URL.revokeObjectURL(preview);
      } catch (error) {
        console.error("Upload failed:", error);
        setUploadingFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, error: error instanceof Error ? error.message : "Upload failed" }
              : f
          )
        );
        // Clean up preview URL on error to prevent memory leak
        URL.revokeObjectURL(preview);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await processFiles(files);

    // Clear input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    await processFiles(files);
  };

  const uploadToS3 = async (
    uploadUrl: string,
    file: File,
    onProgress: (progress: number) => void,
    onXhrCreated?: (xhr: XMLHttpRequest) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // 60 second timeout for upload
      xhr.timeout = 60000;

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          onProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Network error during upload"));
      });

      xhr.addEventListener("timeout", () => {
        reject(new Error("Upload timeout"));
      });

      xhr.addEventListener("abort", () => {
        reject(new Error("Upload cancelled"));
      });

      // Notify caller of xhr instance so it can be aborted
      onXhrCreated?.(xhr);

      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.send(file);
    });
  };

  const handleRemove = (url: string) => {
    onChange(urls.filter((u) => u !== url));
  };

  const handleRemoveUploading = (fileId: string) => {
    const file = uploadingFiles.find((f) => f.id === fileId);
    if (file) {
      // Abort ongoing upload if xhr exists
      if (file.xhr) {
        file.xhr.abort();
      }
      URL.revokeObjectURL(file.preview);
      setUploadingFiles((prev) => prev.filter((f) => f.id !== fileId));
    }
  };

  const handleTriggerClick = () => {
    fileInputRef.current?.click();
  };

  const showPreviews = urls.length > 0 || uploadingFiles.length > 0;
  const canAddMore = urls.length + uploadingFiles.length < maxImages;

  // If trigger provided, just render the trigger button
  if (trigger && !showPreviews) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_MIME_TYPES.join(",")}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <div onClick={handleTriggerClick}>{trigger}</div>
      </>
    );
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(",")}
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {validationError && (
        <div className="mb-2 text-sm text-red-400 bg-red-500/10 border border-red-500/50 rounded px-3 py-2">
          {validationError}
        </div>
      )}

      {showPreviews && (
        <div
          className="grid grid-cols-2 gap-2"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Uploaded images */}
          {urls.map((url, index) => (
            <div
              key={url}
              className="relative aspect-square rounded-lg overflow-hidden bg-[#192734] border border-[#38444d]"
            >
              {failedUrls.has(url) ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[#192734] text-[#71767B]">
                  <svg className="w-8 h-8 mb-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                  </svg>
                  <span className="text-xs">Load failed</span>
                </div>
              ) : (
                <img
                  src={url}
                  alt={`Upload ${index + 1}`}
                  onError={() => setFailedUrls((prev) => new Set(prev).add(url))}
                  className="w-full h-full object-cover"
                />
              )}
              <button
                type="button"
                onClick={() => handleRemove(url)}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white transition-colors hover:bg-black/90"
                aria-label="Remove image"
              >
                <svg
                  role="img"
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}

          {/* Uploading files */}
          {uploadingFiles.map((file) => (
            <div
              key={file.id}
              className="relative aspect-square rounded-lg overflow-hidden bg-[#192734] border border-[#38444d]"
            >
              <img
                src={file.preview}
                alt="Uploading"
                onError={() => {
                  // Preview is a blob URL - error unlikely but handle gracefully
                  console.warn("Failed to load upload preview");
                }}
                className="w-full h-full object-cover opacity-50"
              />

              {/* Progress bar */}
              {!file.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="w-3/4">
                    <div className="h-1 bg-[#38444d] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#1DA1F2] transition-all duration-300"
                        style={{ width: `${file.progress}%` }}
                      />
                    </div>
                    <p className="text-white text-sm text-center mt-2 font-mono">
                      {file.progress}%
                    </p>
                  </div>
                </div>
              )}

              {/* Error state */}
              {file.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <div className="text-center px-4">
                    <p className="text-red-400 text-sm mb-2">{file.error}</p>
                    <button
                      type="button"
                      onClick={() => handleRemoveUploading(file.id)}
                      className="text-white text-sm underline hover:no-underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}

              {/* Remove button */}
              {!file.error && (
                <button
                  onClick={() => handleRemoveUploading(file.id)}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white transition-colors hover:bg-black/90"
                  aria-label="Cancel upload"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          {/* Add more button */}
          {canAddMore && (
            <button
              type="button"
              onClick={handleTriggerClick}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`aspect-square rounded-lg border-2 border-dashed flex items-center justify-center transition-colors ${
                isDragging
                  ? "border-[#1DA1F2] bg-[#1DA1F2]/10 text-[#1DA1F2]"
                  : "border-[#38444d] hover:border-[#1DA1F2] hover:bg-[#1DA1F2]/5 text-[#71767B] hover:text-[#1DA1F2]"
              }`}
              aria-label="Add more images"
            >
              <svg
                role="img"
                className="w-8 h-8"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
