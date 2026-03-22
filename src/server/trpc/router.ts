import { createTRPCRouter } from "./index";
import { notificationRouter } from "./routers/notification";

/**
 * Root appRouter.
 *
 * Merges all sub-routers (auth, user, tweet, feed, social, engagement, notification, search, media).
 * Sub-routers will be added in subsequent phases.
 */
export const appRouter = createTRPCRouter({
  notification: notificationRouter,
  // Sub-routers will be added here as they are implemented:
  // auth: authRouter,
  // user: userRouter,
  // tweet: tweetRouter,
  // feed: feedRouter,
  // social: socialRouter,
  // engagement: engagementRouter,
  // search: searchRouter,
  // media: mediaRouter,
});

/**
 * Export AppRouter type for client type inference.
 */
export type AppRouter = typeof appRouter;
