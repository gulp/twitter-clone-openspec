import { env } from "@/env";
import { prisma } from "@/server/db";
import { redis } from "@/server/redis";
import { s3 } from "@/server/s3";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

/**
 * Health check endpoint.
 * Reports the operational status of all subsystems.
 *
 * GET /api/health
 *
 * Returns:
 * - 200 OK if database is up (optionally degraded if Redis/S3 down)
 * - 503 Service Unavailable if database is down
 *
 * Response body:
 * {
 *   status: "ok" | "degraded" | "down",
 *   db: boolean,
 *   redis: boolean,
 *   s3: boolean,
 *   uptime: number
 * }
 */
export async function GET() {
  const checks = await Promise.allSettled([checkPostgreSQL(), checkRedis(), checkS3()]);

  const db = checks[0].status === "fulfilled" && checks[0].value;
  const redisOk = checks[1].status === "fulfilled" && checks[1].value;
  const s3Ok = checks[2].status === "fulfilled" && checks[2].value;
  const uptime = Math.floor(process.uptime());

  // Database is hard dependency - if down, entire service is down
  if (!db) {
    return NextResponse.json(
      {
        status: "down",
        db: false,
        redis: redisOk,
        s3: s3Ok,
        uptime,
      },
      { status: 503 }
    );
  }

  // Database is up - determine if degraded or ok
  const allHealthy = db && redisOk && s3Ok;
  const status = allHealthy ? "ok" : "degraded";

  return NextResponse.json(
    {
      status,
      db: true,
      redis: redisOk,
      s3: s3Ok,
      uptime,
    },
    { status: 200 }
  );
}

/**
 * Check PostgreSQL connectivity.
 */
async function checkPostgreSQL(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error("[HEALTH] PostgreSQL check failed:", error);
    return false;
  }
}

/**
 * Check Redis connectivity.
 */
async function checkRedis(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch (error) {
    console.error("[HEALTH] Redis check failed:", error);
    return false;
  }
}

/**
 * Check S3/MinIO connectivity.
 */
async function checkS3(): Promise<boolean> {
  try {
    const command = new HeadBucketCommand({
      Bucket: env.S3_BUCKET,
    });
    await s3.send(command);
    return true;
  } catch (error) {
    console.error("[HEALTH] S3 check failed:", error);
    return false;
  }
}
