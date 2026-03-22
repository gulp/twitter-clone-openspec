import { router } from "../trpc";
import { userRouter } from "./user";
import { tweetRouter } from "./tweet";
import { feedRouter } from "./feed";
import { socialRouter } from "./social";
import { notificationRouter } from "./notification";

export const appRouter = router({
  user: userRouter,
  tweet: tweetRouter,
  feed: feedRouter,
  social: socialRouter,
  notification: notificationRouter,
});

export type AppRouter = typeof appRouter;
