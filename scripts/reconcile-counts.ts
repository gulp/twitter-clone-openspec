/**
 * Reconcile denormalized counts — maintenance script
 *
 * Recomputes all denormalized counts from source-of-truth tables and fixes discrepancies.
 *
 * User counts:
 * - followerCount = COUNT(Follow WHERE followingId)
 * - followingCount = COUNT(Follow WHERE followerId)
 * - tweetCount = COUNT(Tweet WHERE authorId AND NOT deleted)
 *
 * Tweet counts:
 * - likeCount = COUNT(Like)
 * - retweetCount = COUNT(Retweet)
 * - replyCount = COUNT(Tweet WHERE parentId AND NOT deleted)
 *
 * Run: npx tsx scripts/reconcile-counts.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface UserCountDiscrepancy {
  userId: string;
  username: string;
  field: "followerCount" | "followingCount" | "tweetCount";
  expected: number;
  actual: number;
}

interface TweetCountDiscrepancy {
  tweetId: string;
  author: string;
  field: "likeCount" | "retweetCount" | "replyCount";
  expected: number;
  actual: number;
}

/**
 * Reconcile user counts
 */
async function reconcileUserCounts() {
  console.log("👤 Reconciling user counts...\n");

  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      followerCount: true,
      followingCount: true,
      tweetCount: true,
    },
  });

  if (users.length === 0) {
    console.log("  No users found. Skipping user count reconciliation.\n");
    return;
  }

  const discrepancies: UserCountDiscrepancy[] = [];
  let fixCount = 0;

  for (const user of users) {
    // Compute actual counts from source tables
    const actualFollowerCount = await prisma.follow.count({
      where: { followingId: user.id },
    });
    const actualFollowingCount = await prisma.follow.count({
      where: { followerId: user.id },
    });
    const actualTweetCount = await prisma.tweet.count({
      where: { authorId: user.id, deleted: false },
    });

    // Detect discrepancies
    if (user.followerCount !== actualFollowerCount) {
      discrepancies.push({
        userId: user.id,
        username: user.username,
        field: "followerCount",
        expected: actualFollowerCount,
        actual: user.followerCount,
      });
    }

    if (user.followingCount !== actualFollowingCount) {
      discrepancies.push({
        userId: user.id,
        username: user.username,
        field: "followingCount",
        expected: actualFollowingCount,
        actual: user.followingCount,
      });
    }

    if (user.tweetCount !== actualTweetCount) {
      discrepancies.push({
        userId: user.id,
        username: user.username,
        field: "tweetCount",
        expected: actualTweetCount,
        actual: user.tweetCount,
      });
    }

    // Fix if any discrepancies found
    if (
      user.followerCount !== actualFollowerCount ||
      user.followingCount !== actualFollowingCount ||
      user.tweetCount !== actualTweetCount
    ) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          followerCount: actualFollowerCount,
          followingCount: actualFollowingCount,
          tweetCount: actualTweetCount,
        },
      });
      fixCount++;
    }
  }

  // Log discrepancies
  if (discrepancies.length > 0) {
    console.log("  ⚠️  Discrepancies found:\n");
    for (const d of discrepancies) {
      console.log(
        `    @${d.username} (${d.userId.slice(0, 8)}...): ${d.field} was ${d.actual}, corrected to ${d.expected}`
      );
    }
    console.log();
  } else {
    console.log("  ✓ All user counts are correct.\n");
  }

  console.log(`  Fixed ${fixCount} user(s)\n`);
  return discrepancies;
}

/**
 * Reconcile tweet counts
 */
async function reconcileTweetCounts() {
  console.log("📝 Reconciling tweet counts...\n");

  const tweets = await prisma.tweet.findMany({
    select: {
      id: true,
      likeCount: true,
      retweetCount: true,
      replyCount: true,
      author: {
        select: {
          username: true,
        },
      },
    },
  });

  if (tweets.length === 0) {
    console.log("  No tweets found. Skipping tweet count reconciliation.\n");
    return;
  }

  const discrepancies: TweetCountDiscrepancy[] = [];
  let fixCount = 0;

  for (const tweet of tweets) {
    // Compute actual counts from source tables
    const actualLikeCount = await prisma.like.count({
      where: { tweetId: tweet.id },
    });
    const actualRetweetCount = await prisma.retweet.count({
      where: { tweetId: tweet.id },
    });
    const actualReplyCount = await prisma.tweet.count({
      where: { parentId: tweet.id, deleted: false },
    });

    // Detect discrepancies
    if (tweet.likeCount !== actualLikeCount) {
      discrepancies.push({
        tweetId: tweet.id,
        author: tweet.author.username,
        field: "likeCount",
        expected: actualLikeCount,
        actual: tweet.likeCount,
      });
    }

    if (tweet.retweetCount !== actualRetweetCount) {
      discrepancies.push({
        tweetId: tweet.id,
        author: tweet.author.username,
        field: "retweetCount",
        expected: actualRetweetCount,
        actual: tweet.retweetCount,
      });
    }

    if (tweet.replyCount !== actualReplyCount) {
      discrepancies.push({
        tweetId: tweet.id,
        author: tweet.author.username,
        field: "replyCount",
        expected: actualReplyCount,
        actual: tweet.replyCount,
      });
    }

    // Fix if any discrepancies found
    if (
      tweet.likeCount !== actualLikeCount ||
      tweet.retweetCount !== actualRetweetCount ||
      tweet.replyCount !== actualReplyCount
    ) {
      await prisma.tweet.update({
        where: { id: tweet.id },
        data: {
          likeCount: actualLikeCount,
          retweetCount: actualRetweetCount,
          replyCount: actualReplyCount,
        },
      });
      fixCount++;
    }
  }

  // Log discrepancies
  if (discrepancies.length > 0) {
    console.log("  ⚠️  Discrepancies found:\n");
    for (const d of discrepancies) {
      console.log(
        `    Tweet ${d.tweetId.slice(0, 8)}... (@${d.author}): ${d.field} was ${d.actual}, corrected to ${d.expected}`
      );
    }
    console.log();
  } else {
    console.log("  ✓ All tweet counts are correct.\n");
  }

  console.log(`  Fixed ${fixCount} tweet(s)\n`);
  return discrepancies;
}

/**
 * Main reconciliation function
 */
async function main() {
  console.log("🔄 Starting count reconciliation...\n");

  try {
    const userDiscrepancies = await reconcileUserCounts();
    const tweetDiscrepancies = await reconcileTweetCounts();

    const totalDiscrepancies =
      (userDiscrepancies?.length || 0) + (tweetDiscrepancies?.length || 0);

    console.log("✅ Count reconciliation complete!\n");
    console.log("Summary:");
    console.log(`  - Total discrepancies found: ${totalDiscrepancies}`);
    console.log(`  - User count discrepancies: ${userDiscrepancies?.length || 0}`);
    console.log(`  - Tweet count discrepancies: ${tweetDiscrepancies?.length || 0}`);

    if (totalDiscrepancies === 0) {
      console.log("\n  All counts are in sync! 🎉\n");
    } else {
      console.log("\n  All discrepancies have been corrected.\n");
    }
  } catch (error) {
    console.error("❌ Reconciliation failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
