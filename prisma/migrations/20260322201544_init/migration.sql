-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LIKE', 'RETWEET', 'FOLLOW', 'REPLY', 'MENTION', 'QUOTE_TWEET');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT NOT NULL DEFAULT '',
    "bannerUrl" TEXT NOT NULL DEFAULT '',
    "hashedPassword" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "followerCount" INTEGER NOT NULL DEFAULT 0,
    "followingCount" INTEGER NOT NULL DEFAULT 0,
    "tweetCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tweet" (
    "id" TEXT NOT NULL,
    "content" VARCHAR(280) NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "quoteTweetId" TEXT,
    "mediaUrls" TEXT[],
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "retweetCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Tweet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("followerId","followingId")
);

-- CreateTable
CREATE TABLE "Like" (
    "userId" TEXT NOT NULL,
    "tweetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("userId","tweetId")
);

-- CreateTable
CREATE TABLE "Retweet" (
    "userId" TEXT NOT NULL,
    "tweetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Retweet_pkey" PRIMARY KEY ("userId","tweetId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "tweetId" TEXT,
    "dedupeKey" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Tweet_authorId_deleted_createdAt_id_idx" ON "Tweet"("authorId", "deleted", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Tweet_parentId_idx" ON "Tweet"("parentId");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE INDEX "Like_tweetId_idx" ON "Like"("tweetId");

-- CreateIndex
CREATE INDEX "Retweet_tweetId_idx" ON "Retweet"("tweetId");

-- CreateIndex
CREATE INDEX "Retweet_userId_createdAt_idx" ON "Retweet"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientId_createdAt_idx" ON "Notification"("recipientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_recipientId_read_createdAt_idx" ON "Notification"("recipientId", "read", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_tokenHash_idx" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Tweet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_quoteTweetId_fkey" FOREIGN KEY ("quoteTweetId") REFERENCES "Tweet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_tweetId_fkey" FOREIGN KEY ("tweetId") REFERENCES "Tweet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retweet" ADD CONSTRAINT "Retweet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retweet" ADD CONSTRAINT "Retweet_tweetId_fkey" FOREIGN KEY ("tweetId") REFERENCES "Tweet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tweetId_fkey" FOREIGN KEY ("tweetId") REFERENCES "Tweet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Post-migration SQL: Full-text search, indexes, constraints

-- Add full-text search generated column and GIN index
ALTER TABLE "Tweet" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS "Tweet_search_vector_idx" ON "Tweet" USING GIN ("search_vector");

-- Enable trigram extension for user ILIKE search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes for user search
CREATE INDEX IF NOT EXISTS "User_username_trgm_idx" ON "User" USING GIN (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_displayName_trgm_idx" ON "User" USING GIN ("displayName" gin_trgm_ops);

-- Partial indexes for hot-path queries on live tweets and unread notifications
CREATE INDEX IF NOT EXISTS "Tweet_live_created_idx"
  ON "Tweet" ("createdAt" DESC, "id" DESC) WHERE "deleted" = false;

CREATE INDEX IF NOT EXISTS "Notification_unread_created_idx"
  ON "Notification" ("recipientId", "createdAt" DESC) WHERE "read" = false;

-- Guardrail constraints (see §1.21)
ALTER TABLE "User" ADD CONSTRAINT "User_counts_nonneg"
  CHECK ("followerCount" >= 0 AND "followingCount" >= 0 AND "tweetCount" >= 0);
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_counts_nonneg"
  CHECK ("likeCount" >= 0 AND "retweetCount" >= 0 AND "replyCount" >= 0);
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_deleted_consistency"
  CHECK (("deleted" = false AND "deletedAt" IS NULL) OR ("deleted" = true AND "deletedAt" IS NOT NULL));
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_content_or_media"
  CHECK (char_length(content) > 0 OR cardinality("mediaUrls") > 0);
