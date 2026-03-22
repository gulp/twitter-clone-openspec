import { env } from "@/env";
import { log } from "@/lib/logger";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

/**
 * Email service using nodemailer (§1.5).
 *
 * Development mode: Auto-creates Ethereal test account for email preview.
 * Production mode: Uses configured SMTP settings.
 *
 * All email sends are fire-and-forget — errors are logged but not thrown.
 */

let transporter: Transporter | null = null;

/**
 * Get or create nodemailer transporter.
 *
 * In development (when SMTP_HOST is not configured):
 * - Auto-creates Ethereal test account
 * - Logs preview URLs to console
 *
 * In production:
 * - Uses configured SMTP settings from environment variables
 */
async function getTransporter(): Promise<Transporter> {
  if (transporter) {
    return transporter;
  }

  // Production mode: use configured SMTP
  if (env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number.parseInt(env.SMTP_PORT, 10),
      secure: Number.parseInt(env.SMTP_PORT, 10) === 465, // true for 465, false for other ports
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });

    log.info("Email service initialized", {
      mode: "production",
      smtpHost: env.SMTP_HOST,
    });
    return transporter;
  }

  // Development mode: use Ethereal test account
  log.info("Email service initializing", {
    mode: "development",
    message: "Creating Ethereal test account",
  });

  try {
    const testAccount = await nodemailer.createTestAccount();

    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });

    log.info("Email service initialized", {
      mode: "development",
      user: testAccount.user,
      previewUrl: "https://ethereal.email/messages",
    });

    return transporter;
  } catch (error) {
    log.error("Failed to create Ethereal test account", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error("Email service unavailable");
  }
}

/**
 * Send password reset email with one-time reset link.
 *
 * This function is fire-and-forget — it logs errors but never throws.
 * Callers should NEVER await this function to prevent timing attacks (§1.4).
 *
 * @param to - Recipient email address
 * @param resetUrl - One-time password reset URL with token
 */
export function sendPasswordResetEmail(to: string, resetUrl: string): void {
  // Fire-and-forget: do not await
  void (async () => {
    try {
      const transport = await getTransporter();

      const info = await transport.sendMail({
        from: env.EMAIL_FROM ?? '"Twitter Clone" <noreply@twitter-clone.local>',
        to,
        subject: "Reset your password",
        text: `Reset your password by clicking this link: ${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you did not request a password reset, please ignore this email.`,
        html: `
          <h2>Reset your password</h2>
          <p>Click the link below to reset your password:</p>
          <p><a href="${resetUrl}">${resetUrl}</a></p>
          <p>This link expires in 1 hour.</p>
          <p>If you did not request a password reset, please ignore this email.</p>
        `,
      });

      log.info("Password reset email sent", {
        to,
        messageId: info.messageId,
        previewUrl: nodemailer.getTestMessageUrl(info) || undefined,
      });
    } catch (error) {
      // Log error but do not throw — email sending is best-effort
      log.error("Failed to send password reset email", {
        to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}
