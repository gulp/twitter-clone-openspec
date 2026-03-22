import { createTRPCRouter } from "./index";
import { authRouter } from "./routers/auth";
import { engagementRouter } from "./routers/engagement";
import { feedRouter } from "./routers/feed";
import { mediaRouter } from "./routers/media";
import { notificationRouter } from "./routers/notification";
import { searchRouter } from "./routers/search";
import { socialRouter } from "./routers/social";
import { tweetRouter } from "./routers/tweet";
import { userRouter } from "./routers/user";

/**
 * Root appRouter.
 *
 * Merges all sub-routers (auth, user, tweet, feed, social, engagement, notification, search, media).
 * Sub-routers will be added in subsequent phases.
 */
export const appRouter = createTRPCRouter({
  auth: authRouter,
  engagement: engagementRouter,
  feed: feedRouter,
  media: mediaRouter,
  notification: notificationRouter,
  search: searchRouter,
  social: socialRouter,
  tweet: tweetRouter,
  user: userRouter,
});

/**
 * Export AppRouter type for client type inference.
 */
export type AppRouter = typeof appRouter;
