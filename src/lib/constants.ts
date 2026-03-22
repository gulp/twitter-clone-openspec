// Content limits
export const MAX_TWEET_LENGTH = 280;
export const MAX_DISPLAY_NAME_LENGTH = 50;
export const MAX_BIO_LENGTH = 160;

// Pagination
export const PAGE_SIZE = 20;

// Media
export const MAX_MEDIA_PER_TWEET = 4;
export const MAX_MEDIA_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

// SSE
export const SSE_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
export const SSE_REPLAY_BUFFER_SIZE = 200;

// Rate limits
export const RATE_LIMITS = {
  auth: {
    window: 60, // 60 seconds
    max: 5, // 5 requests per window
  },
  tweet: {
    window: 3600, // 1 hour
    max: 30, // 30 tweets per hour
  },
  general: {
    window: 60, // 60 seconds
    max: 100, // 100 requests per minute
  },
} as const;
