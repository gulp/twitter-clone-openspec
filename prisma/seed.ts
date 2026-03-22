import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("password123", 10);

  const alice = await prisma.user.upsert({
    where: { email: "alice@example.com" },
    update: {},
    create: {
      email: "alice@example.com",
      username: "alice",
      displayName: "Alice Johnson",
      bio: "Software engineer. Building cool things.",
      hashedPassword: password,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: "bob@example.com" },
    update: {},
    create: {
      email: "bob@example.com",
      username: "bob",
      displayName: "Bob Smith",
      bio: "Designer & developer. Coffee enthusiast.",
      hashedPassword: password,
    },
  });

  const charlie = await prisma.user.upsert({
    where: { email: "charlie@example.com" },
    update: {},
    create: {
      email: "charlie@example.com",
      username: "charlie",
      displayName: "Charlie Davis",
      bio: "Tech writer. Open source advocate.",
      hashedPassword: password,
    },
  });

  // Create tweets
  const tweet1 = await prisma.tweet.create({
    data: {
      content: "Just launched my new project! So excited to share it with the world 🚀",
      authorId: alice.id,
    },
  });

  const tweet2 = await prisma.tweet.create({
    data: {
      content: "The best way to learn is by building. Start small, iterate fast.",
      authorId: bob.id,
    },
  });

  const tweet3 = await prisma.tweet.create({
    data: {
      content: "Hot take: TypeScript makes JavaScript actually enjoyable to write.",
      authorId: charlie.id,
    },
  });

  await prisma.tweet.create({
    data: {
      content: "Working on a Twitter clone with Next.js, tRPC, and Prisma. The DX is incredible.",
      authorId: alice.id,
    },
  });

  await prisma.tweet.create({
    data: {
      content: "Remember to take breaks. Your code will still be there when you get back.",
      authorId: bob.id,
    },
  });

  // Create replies
  await prisma.tweet.create({
    data: {
      content: "@alice Congrats! What tech stack did you use?",
      authorId: bob.id,
      parentId: tweet1.id,
    },
  });

  await prisma.tweet.create({
    data: {
      content: "100% agree! Tutorials only get you so far.",
      authorId: alice.id,
      parentId: tweet2.id,
    },
  });

  // Create follows
  await prisma.follow.createMany({
    data: [
      { followerId: alice.id, followingId: bob.id },
      { followerId: alice.id, followingId: charlie.id },
      { followerId: bob.id, followingId: alice.id },
      { followerId: charlie.id, followingId: alice.id },
      { followerId: charlie.id, followingId: bob.id },
    ],
    skipDuplicates: true,
  });

  // Create likes
  await prisma.like.createMany({
    data: [
      { userId: bob.id, tweetId: tweet1.id },
      { userId: charlie.id, tweetId: tweet1.id },
      { userId: alice.id, tweetId: tweet2.id },
      { userId: alice.id, tweetId: tweet3.id },
      { userId: bob.id, tweetId: tweet3.id },
    ],
    skipDuplicates: true,
  });

  console.log("Seeded database with 3 users, 7 tweets, 5 follows, 5 likes");
  console.log("Login with any user: password123");
  console.log("  alice@example.com / bob@example.com / charlie@example.com");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
