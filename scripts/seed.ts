/**
 * Seed script — deterministic fixture data for development and E2E tests
 *
 * Creates:
 * - 5 users with known credentials (user1@test.com / password123, etc.)
 * - 20 tweets (standalone, replies, quote tweets)
 * - Follow graph
 * - Likes and retweets
 *
 * Run: npx tsx scripts/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Fixed timestamp base for deterministic fixtures (2024-01-01 00:00:00 UTC)
 */
const BASE_TIME = new Date("2024-01-01T00:00:00.000Z").getTime();

/**
 * Helper to create deterministic timestamps
 */
function createTimestamp(offsetMinutes: number): Date {
  return new Date(BASE_TIME + offsetMinutes * 60 * 1000);
}

/**
 * Clear all data in reverse dependency order
 */
async function clearDatabase() {
  console.log("🧹 Clearing existing fixture data...");

  // Delete in reverse dependency order
  await prisma.notification.deleteMany({});
  await prisma.retweet.deleteMany({});
  await prisma.like.deleteMany({});
  await prisma.tweet.deleteMany({});
  await prisma.follow.deleteMany({});
  await prisma.passwordResetToken.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.user.deleteMany({});

  console.log("✓ Database cleared");
}

/**
 * Create fixture users
 */
async function seedUsers() {
  console.log("\n👤 Creating users...");

  const hashedPassword = await bcrypt.hash("password123", 10);

  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: "user1@test.com",
        username: "user1",
        displayName: "User One",
        bio: "First test user",
        hashedPassword,
        createdAt: createTimestamp(0),
      },
    }),
    prisma.user.create({
      data: {
        email: "user2@test.com",
        username: "user2",
        displayName: "User Two",
        bio: "Second test user",
        hashedPassword,
        createdAt: createTimestamp(5),
      },
    }),
    prisma.user.create({
      data: {
        email: "user3@test.com",
        username: "user3",
        displayName: "User Three",
        bio: "Third test user",
        hashedPassword,
        createdAt: createTimestamp(10),
      },
    }),
    prisma.user.create({
      data: {
        email: "user4@test.com",
        username: "user4",
        displayName: "User Four",
        bio: "Fourth test user",
        hashedPassword,
        createdAt: createTimestamp(15),
      },
    }),
    prisma.user.create({
      data: {
        email: "user5@test.com",
        username: "user5",
        displayName: "User Five",
        bio: "Fifth test user",
        hashedPassword,
        createdAt: createTimestamp(20),
      },
    }),
  ]);

  console.log(`✓ Created ${users.length} users`);
  for (const u of users) {
    console.log(`  - ${u.username} (${u.email})`);
  }

  return users;
}

/**
 * Create fixture tweets
 */
async function seedTweets(
  users: [{ id: string }, { id: string }, { id: string }, { id: string }, { id: string }]
) {
  console.log("\n📝 Creating tweets...");

  // Standalone tweets (1-10)
  const tweet1 = await prisma.tweet.create({
    data: {
      authorId: users[0]?.id,
      content: "Hello world! This is user1's first tweet.",
      createdAt: createTimestamp(30),
    },
  });

  const tweet2 = await prisma.tweet.create({
    data: {
      authorId: users[1]?.id,
      content: "User2 checking in. Great to be here!",
      createdAt: createTimestamp(35),
    },
  });

  const tweet3 = await prisma.tweet.create({
    data: {
      authorId: users[2]?.id,
      content: "User3 loves TypeScript and Next.js",
      createdAt: createTimestamp(40),
    },
  });

  const tweet4 = await prisma.tweet.create({
    data: {
      authorId: users[3]?.id,
      content: "User4 is learning tRPC. It's amazing!",
      createdAt: createTimestamp(45),
    },
  });

  const tweet5 = await prisma.tweet.create({
    data: {
      authorId: users[4]?.id,
      content: "User5 here. Building cool stuff with Prisma.",
      createdAt: createTimestamp(50),
    },
  });

  const tweet6 = await prisma.tweet.create({
    data: {
      authorId: users[0]?.id,
      content: "Another tweet from user1 about clean architecture",
      createdAt: createTimestamp(55),
    },
  });

  const tweet7 = await prisma.tweet.create({
    data: {
      authorId: users[1]?.id,
      content: "User2 shares thoughts on software design",
      createdAt: createTimestamp(60),
    },
  });

  const tweet8 = await prisma.tweet.create({
    data: {
      authorId: users[2]?.id,
      content: "User3 announces a new side project",
      createdAt: createTimestamp(65),
    },
  });

  const tweet9 = await prisma.tweet.create({
    data: {
      authorId: users[3]?.id,
      content: "User4 celebrates a production deployment",
      createdAt: createTimestamp(70),
    },
  });

  const tweet10 = await prisma.tweet.create({
    data: {
      authorId: users[4]?.id,
      content: "User5 reflects on developer productivity",
      createdAt: createTimestamp(75),
    },
  });

  // Replies (11-15)
  const tweet11 = await prisma.tweet.create({
    data: {
      authorId: users[1]?.id,
      parentId: tweet1.id,
      content: "@user1 Welcome! Great to see you here.",
      createdAt: createTimestamp(80),
    },
  });

  const tweet12 = await prisma.tweet.create({
    data: {
      authorId: users[2]?.id,
      parentId: tweet1.id,
      content: "@user1 Looking forward to your tweets!",
      createdAt: createTimestamp(85),
    },
  });

  const tweet13 = await prisma.tweet.create({
    data: {
      authorId: users[3]?.id,
      parentId: tweet4.id,
      content: "@user4 tRPC is indeed fantastic. Have you tried it with Next.js?",
      createdAt: createTimestamp(90),
    },
  });

  const tweet14 = await prisma.tweet.create({
    data: {
      authorId: users[0]?.id,
      parentId: tweet8.id,
      content: "@user3 Sounds exciting! Tell us more.",
      createdAt: createTimestamp(95),
    },
  });

  const tweet15 = await prisma.tweet.create({
    data: {
      authorId: users[4]?.id,
      parentId: tweet7.id,
      content: "@user2 Totally agree with your take on design patterns.",
      createdAt: createTimestamp(100),
    },
  });

  // Quote tweets (16-20)
  const tweet16 = await prisma.tweet.create({
    data: {
      authorId: users[0]?.id,
      quoteTweetId: tweet3.id,
      content: "Couldn't agree more! TypeScript is the future.",
      createdAt: createTimestamp(105),
    },
  });

  const tweet17 = await prisma.tweet.create({
    data: {
      authorId: users[1]?.id,
      quoteTweetId: tweet5.id,
      content: "Prisma makes database work so much easier.",
      createdAt: createTimestamp(110),
    },
  });

  const tweet18 = await prisma.tweet.create({
    data: {
      authorId: users[2]?.id,
      quoteTweetId: tweet9.id,
      content: "Congrats on the deployment! 🚀",
      createdAt: createTimestamp(115),
    },
  });

  const tweet19 = await prisma.tweet.create({
    data: {
      authorId: users[3]?.id,
      quoteTweetId: tweet10.id,
      content: "Great insights on productivity. Developer experience matters!",
      createdAt: createTimestamp(120),
    },
  });

  const tweet20 = await prisma.tweet.create({
    data: {
      authorId: users[4]?.id,
      quoteTweetId: tweet6.id,
      content: "Clean architecture is key to maintainable code.",
      createdAt: createTimestamp(125),
    },
  });

  const allTweets = [
    tweet1,
    tweet2,
    tweet3,
    tweet4,
    tweet5,
    tweet6,
    tweet7,
    tweet8,
    tweet9,
    tweet10,
    tweet11,
    tweet12,
    tweet13,
    tweet14,
    tweet15,
    tweet16,
    tweet17,
    tweet18,
    tweet19,
    tweet20,
  ];

  console.log(`✓ Created ${allTweets.length} tweets`);
  console.log(`  - ${allTweets.filter((t) => !t.parentId && !t.quoteTweetId).length} standalone`);
  console.log(`  - ${allTweets.filter((t) => t.parentId).length} replies`);
  console.log(`  - ${allTweets.filter((t) => t.quoteTweetId).length} quote tweets`);

  return allTweets;
}

/**
 * Create follow graph
 */
async function seedFollows(
  users: [{ id: string }, { id: string }, { id: string }, { id: string }, { id: string }]
) {
  console.log("\n🤝 Creating follow relationships...");

  const follows = await Promise.all([
    // user1 follows user2, user3
    prisma.follow.create({
      data: {
        followerId: users[0]?.id,
        followingId: users[1]?.id,
        createdAt: createTimestamp(130),
      },
    }),
    prisma.follow.create({
      data: {
        followerId: users[0]?.id,
        followingId: users[2]?.id,
        createdAt: createTimestamp(135),
      },
    }),

    // user2 follows user1, user3, user4
    prisma.follow.create({
      data: {
        followerId: users[1]?.id,
        followingId: users[0]?.id,
        createdAt: createTimestamp(140),
      },
    }),
    prisma.follow.create({
      data: {
        followerId: users[1]?.id,
        followingId: users[2]?.id,
        createdAt: createTimestamp(145),
      },
    }),
    prisma.follow.create({
      data: {
        followerId: users[1]?.id,
        followingId: users[3]?.id,
        createdAt: createTimestamp(150),
      },
    }),

    // user3 follows user1, user2
    prisma.follow.create({
      data: {
        followerId: users[2]?.id,
        followingId: users[0]?.id,
        createdAt: createTimestamp(155),
      },
    }),
    prisma.follow.create({
      data: {
        followerId: users[2]?.id,
        followingId: users[1]?.id,
        createdAt: createTimestamp(160),
      },
    }),

    // user4 follows user1
    prisma.follow.create({
      data: {
        followerId: users[3]?.id,
        followingId: users[0]?.id,
        createdAt: createTimestamp(165),
      },
    }),

    // user5 follows user1, user4
    prisma.follow.create({
      data: {
        followerId: users[4]?.id,
        followingId: users[0]?.id,
        createdAt: createTimestamp(170),
      },
    }),
    prisma.follow.create({
      data: {
        followerId: users[4]?.id,
        followingId: users[3]?.id,
        createdAt: createTimestamp(175),
      },
    }),
  ]);

  console.log(`✓ Created ${follows.length} follow relationships`);

  return follows;
}

/**
 * Create likes and retweets
 */
async function seedEngagement(
  users: [{ id: string }, { id: string }, { id: string }, { id: string }, { id: string }],
  tweets: Array<{ id: string }>
) {
  console.log("\n❤️  Creating engagement (likes & retweets)...");

  // Validate arrays have expected length
  if (users.length < 5) {
    throw new Error(`Expected at least 5 users, got ${users.length}`);
  }
  if (tweets.length < 20) {
    throw new Error(`Expected at least 20 tweets, got ${tweets.length}`);
  }

  // Likes (validated arrays - using type assertions)
  const likes = await Promise.all([
    // Multiple users like tweet1
    prisma.like.create({
      data: {
        userId: users[1]?.id as string,
        tweetId: tweets[0]?.id as string,
        createdAt: createTimestamp(180),
      },
    }),
    prisma.like.create({
      data: {
        userId: users[2]?.id as string,
        tweetId: tweets[0]?.id as string,
        createdAt: createTimestamp(185),
      },
    }),
    prisma.like.create({
      data: {
        userId: users[3]?.id as string,
        tweetId: tweets[0]?.id as string,
        createdAt: createTimestamp(190),
      },
    }),

    // User1 likes some tweets
    prisma.like.create({
      data: {
        userId: users[0]?.id as string,
        tweetId: tweets[1]?.id as string,
        createdAt: createTimestamp(195),
      },
    }),
    prisma.like.create({
      data: {
        userId: users[0]?.id as string,
        tweetId: tweets[2]?.id as string,
        createdAt: createTimestamp(200),
      },
    }),

    // More scattered likes
    prisma.like.create({
      data: {
        userId: users[4]?.id as string,
        tweetId: tweets[3]?.id as string,
        createdAt: createTimestamp(205),
      },
    }),
    prisma.like.create({
      data: {
        userId: users[1]?.id as string,
        tweetId: tweets[5]?.id as string,
        createdAt: createTimestamp(210),
      },
    }),
  ]);

  // Retweets
  const retweets = await Promise.all([
    // User2 retweets tweet1
    prisma.retweet.create({
      data: {
        userId: users[1]?.id as string,
        tweetId: tweets[0]?.id as string,
        createdAt: createTimestamp(215),
      },
    }),

    // User3 retweets tweet1
    prisma.retweet.create({
      data: {
        userId: users[2]?.id as string,
        tweetId: tweets[0]?.id as string,
        createdAt: createTimestamp(220),
      },
    }),

    // User1 retweets tweet2
    prisma.retweet.create({
      data: {
        userId: users[0]?.id as string,
        tweetId: tweets[1]?.id as string,
        createdAt: createTimestamp(225),
      },
    }),

    // User4 retweets tweet3
    prisma.retweet.create({
      data: {
        userId: users[3]?.id as string,
        tweetId: tweets[2]?.id as string,
        createdAt: createTimestamp(230),
      },
    }),
  ]);

  console.log(`✓ Created ${likes.length} likes and ${retweets.length} retweets`);

  return { likes, retweets };
}

/**
 * Update denormalized counts (simulate count reconciliation)
 */
async function updateCounts() {
  console.log("\n🔢 Updating denormalized counts...");

  // Update user counts
  const users = await prisma.user.findMany();
  for (const user of users) {
    const followerCount = await prisma.follow.count({
      where: { followingId: user.id },
    });
    const followingCount = await prisma.follow.count({
      where: { followerId: user.id },
    });
    const tweetCount = await prisma.tweet.count({
      where: { authorId: user.id, deleted: false },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { followerCount, followingCount, tweetCount },
    });
  }

  // Update tweet counts
  const tweets = await prisma.tweet.findMany();
  for (const tweet of tweets) {
    const likeCount = await prisma.like.count({
      where: { tweetId: tweet.id },
    });
    const retweetCount = await prisma.retweet.count({
      where: { tweetId: tweet.id },
    });
    const replyCount = await prisma.tweet.count({
      where: { parentId: tweet.id, deleted: false },
    });

    await prisma.tweet.update({
      where: { id: tweet.id },
      data: { likeCount, retweetCount, replyCount },
    });
  }

  console.log("✓ Counts updated");
}

/**
 * Main seed function
 */
async function main() {
  console.log("🌱 Starting seed script...\n");

  try {
    await clearDatabase();
    const users = await seedUsers();
    const tweets = await seedTweets(users);
    await seedFollows(users);
    await seedEngagement(users, tweets);
    await updateCounts();

    console.log("\n✅ Seed complete!\n");
    console.log("Summary:");
    console.log("  - 5 users created (user1@test.com - user5@test.com, password: password123)");
    console.log("  - 20 tweets created (10 standalone, 5 replies, 5 quote tweets)");
    console.log("  - 10 follow relationships created");
    console.log("  - 7 likes and 4 retweets created");
    console.log("  - All denormalized counts updated\n");
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
