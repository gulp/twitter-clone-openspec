import { createTRPCRouter } from "./index";
import { authRouter } from "./routers/auth";
import { mediaRouter } from "./routers/media";
import { notificationRouter } from "./routers/notification";
import { socialRouter } from "./routers/social";
import { tweetRouter } from "./routers/tweet";

/**
 * Root appRouter.
 *
 * Merges all sub-routers (auth, user, tweet, feed, social, engagement, notification, search, media).
 * Sub-routers will be added in subsequent phases.
 */
export const appRouter = createTRPCRouter({
  auth: authRouter,
  media: mediaRouter,
  notification: notificationRouter,
  social: socialRouter,
  tweet: tweetRouter,
  // Sub-routers will be added here as they are implemented:
  // user: userRouter,
  // feed: feedRouter,
  // engagement: engagementRouter,
  // search: searchRouter,
});

/**
 * Export AppRouter type for client type inference.
 */
export type AppRouter = typeof appRouter;
