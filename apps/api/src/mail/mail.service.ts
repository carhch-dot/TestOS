import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

// `[ASSUMPTION: 5000ms]` per spec-1-4 — generous enough for a real SMTP
// round-trip, short enough to never meaningfully delay the caller.
const DEFAULT_MAIL_TIMEOUT_MS = 5000;
const DEFAULT_SMTP_PORT = 587;
const SMTPS_PORT = 465;

/**
 * Shared outbound-email service (AD-9). `send` NEVER rejects: any failure —
 * missing configuration, a connection error, or a timeout — is logged and
 * swallowed so a mail problem never fails the operation that triggered it
 * (e.g. login lockout). Callers should simply `await mailService.send(...)`
 * with no try/catch.
 *
 * No SMTP provider is chosen here (Deferred, per the architecture spine) —
 * this is a generic SMTP client wired to environment variables.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async send(to: string, subject: string, body: string): Promise<void> {
    const host = process.env.SMTP_HOST;

    // No SMTP provider configured at all: skip immediately, never attempt a
    // connection (this project has no SMTP provider decided yet).
    if (!host?.trim()) {
      this.logger.warn(`Skipping email to ${to}: SMTP_HOST is not configured.`);
      return;
    }

    const timeoutMs = this.getTimeoutMs();

    try {
      await this.withTimeout(
        this.sendViaSmtp(host, to, subject, body, timeoutMs),
        timeoutMs,
      );
    } catch (error) {
      // Non-blocking degradation (AD-9): log and swallow — never throw.
      this.logger.error(
        `Failed to send email to ${to}: ${(error as Error).message}`,
      );
    }
  }

  private getTimeoutMs(): number {
    const raw = Number(process.env.MAIL_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAIL_TIMEOUT_MS;
  }

  private async sendViaSmtp(
    host: string,
    to: string,
    subject: string,
    body: string,
    timeoutMs: number,
  ): Promise<void> {
    const port = Number(process.env.SMTP_PORT) || DEFAULT_SMTP_PORT;
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;
    const from = process.env.MAIL_FROM ?? user ?? 'no-reply@example.com';

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === SMTPS_PORT,
      auth: user && password ? { user, pass: password } : undefined,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });

    try {
      await transporter.sendMail({ from, to, subject, text: body });
    } finally {
      // Always release the transporter/socket, including when the timeout
      // race in `withTimeout` has already given up while this is pending.
      transporter.close();
    }
  }

  /** Races `promise` against a timeout so a hung SMTP call cannot hang `send`. */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Mail send timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}
