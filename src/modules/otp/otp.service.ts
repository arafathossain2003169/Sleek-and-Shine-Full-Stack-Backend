import crypto from 'crypto';
import { query, withTransaction } from '../../config/db';
import { env } from '../../config/env';
import { BadRequestError, ServiceUnavailableError, TooManyRequestsError } from '../../utils/errors';
import { getSettings } from '../settings/settings.service';
import { describeMailError, otpEmail, sendMail } from './mail.service';

export type OtpPurpose = 'register' | 'login' | 'reset';

interface OtpRow {
  id: string;
  user_id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  verified_at: Date | null;
  created_at: Date;
}

export interface OtpChallenge {
  otpRequired: true;
  email: string;
  purpose: OtpPurpose;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

const hashCode = (email: string, purpose: string, code: string) =>
  crypto.createHmac('sha256', env.COOKIE_SECRET).update(`${email}:${purpose}:${code}`).digest('hex');

async function challenge(email: string, purpose: OtpPurpose): Promise<OtpChallenge> {
  const s = await getSettings();
  return {
    otpRequired: true,
    email,
    purpose,
    expiresInSeconds: s.otpTtlMinutes * 60,
    resendAfterSeconds: s.otpResendCooldownSeconds,
  };
}

export const otpService = {
  /** Creates + e-mails a fresh code (older codes for the same email/purpose stop working). */
  async issue(userId: string, email: string, purpose: OtpPurpose): Promise<OtpChallenge> {
    const cfg = await getSettings();
    const latest = (
      await query<OtpRow>(
        'SELECT * FROM otp_codes WHERE email = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1',
        [email, purpose]
      )
    ).rows[0];

    if (latest) {
      const waited = (Date.now() - new Date(latest.created_at).getTime()) / 1000;
      if (waited < cfg.otpResendCooldownSeconds) {
        const wait = Math.ceil(cfg.otpResendCooldownSeconds - waited);
        throw new TooManyRequestsError(`Please wait ${wait}s before requesting another code`, wait);
      }
    }
    const sent = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM otp_codes WHERE email = $1 AND created_at > now() - interval '1 hour'`,
      [email]
    );
    if (parseInt(sent.rows[0].c, 10) >= cfg.otpMaxSendsPerHour) {
      throw new TooManyRequestsError('Too many codes requested. Please try again in an hour.', 3600);
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const otpId = await withTransaction(async (client) => {
      await client.query(
        'UPDATE otp_codes SET consumed_at = now() WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL AND verified_at IS NULL',
        [email, purpose]
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO otp_codes (user_id, email, purpose, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval) RETURNING id`,
        [userId, email, purpose, hashCode(email, purpose, code), String(cfg.otpTtlMinutes)]
      );
      return inserted.rows[0].id;
    });

    try {
      await sendMail({ to: email, ...otpEmail(code, purpose, cfg.otpTtlMinutes) });
    } catch (err) {
      // The person never received this code: drop it so they can retry immediately (no cooldown penalty).
      await query('DELETE FROM otp_codes WHERE id = $1', [otpId]);
      // eslint-disable-next-line no-console
      console.error(`[mail] could not send the verification email to ${email}:`, describeMailError(err));
      throw new ServiceUnavailableError('We could not send the verification email right now. Please try again in a moment.');
    }
    return challenge(email, purpose);
  },

  /** Re-sends only when a code was issued before (after a correct password / sign-up) and never verified. */
  async resend(email: string, purpose: OtpPurpose): Promise<OtpChallenge> {
    const latest = (
      await query<OtpRow>(
        `SELECT * FROM otp_codes WHERE email = $1 AND purpose = $2 AND verified_at IS NULL
           AND created_at > now() - interval '30 minutes' ORDER BY created_at DESC LIMIT 1`,
        [email, purpose]
      )
    ).rows[0];
    // Same answer whether or not the email exists, so this cannot be used to probe accounts.
    if (!latest) return challenge(email, purpose);
    return this.issue(latest.user_id, email, purpose);
  },

  /** Returns the user id when the code is right. Wrong codes burn an attempt; too many invalidate the code. */
  async verify(email: string, purpose: OtpPurpose, code: string): Promise<string> {
    // The attempt counter must be COMMITTED even when the code is wrong, so the outcome is
    // returned from the transaction and the error is thrown only afterwards.
    const cfg = await getSettings();
    const outcome = await withTransaction(async (client): Promise<{ userId: string } | { error: string }> => {
      const row = (
        await client.query<OtpRow>(
          `SELECT * FROM otp_codes WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL AND verified_at IS NULL
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [email, purpose]
        )
      ).rows[0];

      if (!row || new Date(row.expires_at).getTime() < Date.now()) {
        return { error: 'This code has expired or is no longer valid. Request a new one.' };
      }

      const expected = Buffer.from(row.code_hash, 'hex');
      const given = Buffer.from(hashCode(email, purpose, code), 'hex');
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
        const attempts = row.attempts + 1;
        const locked = attempts >= cfg.otpMaxAttempts;
        await client.query(
          'UPDATE otp_codes SET attempts = $2, consumed_at = CASE WHEN $3::boolean THEN now() ELSE NULL END WHERE id = $1',
          [row.id, attempts, locked]
        );
        return {
          error: locked
            ? 'Too many incorrect attempts. Request a new code.'
            : `Incorrect code. ${cfg.otpMaxAttempts - attempts} attempt(s) left.`,
        };
      }

      await client.query('UPDATE otp_codes SET verified_at = now() WHERE id = $1', [row.id]);
      return { userId: row.user_id };
    });

    if ('error' in outcome) throw new BadRequestError(outcome.error);
    return outcome.userId;
  },
};
