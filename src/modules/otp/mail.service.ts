import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Non-production only: every message that "was sent" (tests read OTP codes from here). */
export const outbox: MailMessage[] = [];

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE, // true for port 465 (implicit TLS); false for 587 (STARTTLS is used automatically)
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      // never let a slow mail server hang a login request
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

export async function sendMail(message: MailMessage): Promise<void> {
  const smtp = getTransporter();
  if (smtp) {
    await smtp.sendMail({ from: env.MAIL_FROM, ...message });
    return;
  }
  if (env.IS_PROD) throw new Error('SMTP is not configured');

  // Development / test fallback: no real e-mail, show it in the server console.
  outbox.push(message);
  if (outbox.length > 200) outbox.shift();
  if (!env.IS_TEST) {
    // eslint-disable-next-line no-console
    console.log(`\n[DEV MAIL] to=${message.to}  subject="${message.subject}"\n${message.text}\n`);
  }
}

export function otpEmail(code: string, purpose: 'register' | 'login' | 'reset', ttlMinutes: number): Omit<MailMessage, 'to'> {
  const what =
    purpose === 'register' ? 'verify your email address' : purpose === 'reset' ? 'reset your password' : 'sign in';
  return {
    subject:
      purpose === 'reset'
        ? `${code} is your SleeknShine password reset code`
        : `${code} is your SleeknShine verification code`,
    text: `Use this code to ${what}: ${code}\n\nIt expires in ${ttlMinutes} minutes. If you did not request it, you can ignore this message.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px">
      <h2 style="margin:0 0 12px">SleeknShine</h2>
      <p>Use this code to ${what}:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0">${code}</p>
      <p style="color:#666">It expires in ${ttlMinutes} minutes. If you did not request it, you can ignore this email.</p>
    </div>`,
  };
}

/** A readable one-liner for logs: includes the SMTP response and a hint for the most common mistakes. */
export function describeMailError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string; command?: string };
  const parts = [e.message ?? String(err)];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.responseCode) parts.push(`smtp=${e.responseCode}`);
  let hint = '';
  if (e.code === 'EAUTH' || e.responseCode === 535) {
    hint = ' HINT: wrong SMTP_USER/SMTP_PASS. For Gmail you need an App Password (not your normal password) with 2-Step Verification on.';
  } else if (e.code === 'ESOCKET' || e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED') {
    hint = ' HINT: cannot reach the SMTP server. Check SMTP_HOST/SMTP_PORT, SMTP_SECURE (true for 465, false for 587) and your firewall.';
  }
  return `${parts.join(' | ')}${hint}`;
}

export function describeMailConfig(): string {
  return env.SMTP_HOST
    ? `${env.SMTP_HOST}:${env.SMTP_PORT} (${env.SMTP_SECURE ? 'TLS' : 'STARTTLS'})${env.SMTP_USER ? ` as ${env.SMTP_USER}` : ''}, from ${env.MAIL_FROM}`
    : 'not configured (codes are printed to the console in development)';
}

/** Connects + authenticates to the SMTP server without sending anything. Used at startup and by `npm run mail:test`. */
export async function verifyMailTransport(): Promise<{ ok: boolean; detail: string }> {
  const smtp = getTransporter();
  if (!smtp) return { ok: false, detail: 'SMTP_HOST is not set' };
  try {
    await smtp.verify();
    return { ok: true, detail: describeMailConfig() };
  } catch (err) {
    return { ok: false, detail: describeMailError(err) };
  }
}
