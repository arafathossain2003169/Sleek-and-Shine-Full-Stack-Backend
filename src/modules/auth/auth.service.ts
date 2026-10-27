import { env } from '../../config/env';
import { BadRequestError, ConflictError, TooManyRequestsError, UnauthorizedError } from '../../utils/errors';
import { OtpChallenge, otpService } from '../otp/otp.service';
import { getSettings } from '../settings/settings.service';
import { comparePassword, hashPassword, DUMMY_HASH } from '../../utils/password';
import {
  generateOpaqueId,
  hashToken,
  refreshExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/tokens';
import { authRepository, UserRow } from './auth.repository';
import {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendOtpInput,
  ResetPasswordInput,
  VerifyOtpInput,
} from './auth.schemas';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export function sanitizeUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    emailVerified: user.email_verified,
    status: user.status,
    createdAt: user.created_at,
  };
}

async function issueTokens(user: UserRow): Promise<AuthTokens> {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });

  // tokenId is the primary key of the refresh_tokens row; it is stored AND signed into the JWT.
  const tokenId = generateOpaqueId();
  const refreshToken = signRefreshToken({ sub: user.id, tokenId });

  await authRepository.storeRefreshToken({
    id: tokenId,
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: refreshExpiryDate(),
  });

  return { accessToken, refreshToken };
}

export const authService = {
  /**
   * Creates the account (unverified) and e-mails a code. NO session is issued until the code is verified.
   */
  async register(input: RegisterInput): Promise<{ challenge: OtpChallenge } | { user: ReturnType<typeof sanitizeUser>; tokens: AuthTokens }> {
    const existing = await authRepository.findByEmail(input.email);
    const passwordHash = await hashPassword(input.password);

    let userId: string;
    if (existing) {
      // Only a customer account that never finished verification can be re-registered
      // (otherwise anyone could overwrite a staff or verified account's password).
      if (existing.email_verified || existing.role !== 'customer') {
        throw new ConflictError('An account with this email already exists');
      }
      await authRepository.resetUnverifiedCustomer(existing.id, { name: input.name, passwordHash, phone: input.phone });
      userId = existing.id;
    } else {
      userId = (
        await authRepository.createUser({ name: input.name, email: input.email, passwordHash, phone: input.phone })
      ).id;
    }

    if (!env.OTP_REQUIRED) {
      await authRepository.markEmailVerified(userId);
      const user = (await authRepository.findById(userId))!;
      return { user: sanitizeUser(user), tokens: await issueTokens(user) };
    }
    return { challenge: await otpService.issue(userId, input.email, 'register') };
  },

  /** Password check only. The session starts after the e-mailed code is verified. */
  async login(input: LoginInput): Promise<{ challenge: OtpChallenge } | { user: ReturnType<typeof sanitizeUser>; tokens: AuthTokens }> {
    const user = await authRepository.findByEmail(input.email);

    // Always run bcrypt so response time doesn't reveal whether the email exists.
    const passwordMatches = await comparePassword(input.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !passwordMatches) {
      throw new UnauthorizedError('Invalid email or password');
    }
    // Only reveal account state to someone who proved they know the password.
    if (user.status !== 'active') {
      throw new UnauthorizedError('This account is not active. Please contact support.');
    }

    if (!env.OTP_REQUIRED) return { user: sanitizeUser(user), tokens: await issueTokens(user) };
    return { challenge: await otpService.issue(user.id, user.email, 'login') };
  },

  async verifyOtp(input: VerifyOtpInput) {
    const userId = await otpService.verify(input.email, input.purpose, input.code);
    const user = await authRepository.findById(userId);
    if (!user || user.status !== 'active') throw new UnauthorizedError('This account is not active. Please contact support.');
    if (!user.email_verified) await authRepository.markEmailVerified(userId);
    const fresh = (await authRepository.findById(userId))!;
    return { user: sanitizeUser(fresh), tokens: await issueTokens(fresh) };
  },

  resendOtp(input: ResendOtpInput) {
    return otpService.resend(input.email, input.purpose);
  },

  async refresh(refreshTokenValue: string): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyRefreshToken(refreshTokenValue);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const tokenRow = await authRepository.findRefreshTokenById(payload.tokenId);
    if (
      !tokenRow ||
      tokenRow.user_id !== payload.sub ||
      hashToken(refreshTokenValue) !== tokenRow.token_hash
    ) {
      throw new UnauthorizedError('Refresh token is no longer valid');
    }
    if (tokenRow.revoked_at) {
      // A rotated-out token is being replayed: assume theft and kill every session.
      await authRepository.revokeAllUserRefreshTokens(tokenRow.user_id);
      throw new UnauthorizedError('Refresh token is no longer valid');
    }
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      throw new UnauthorizedError('Refresh token has expired');
    }

    const user = await authRepository.findById(payload.sub);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedError('Account is not available');
    }

    // Atomic rotate: only one concurrent request can win the revoke.
    const revoked = await authRepository.revokeRefreshToken(tokenRow.id);
    if (!revoked) throw new UnauthorizedError('Refresh token is no longer valid');
    return issueTokens(user);
  },

  async logout(refreshTokenValue: string | undefined): Promise<void> {
    if (!refreshTokenValue) return;
    try {
      const payload = verifyRefreshToken(refreshTokenValue);
      await authRepository.revokeRefreshToken(payload.tokenId);
    } catch {
      // token already invalid/expired - nothing to revoke
    }
  },

  /**
   * Starts a password reset. The answer is identical whether or not the email has an account
   * (and whether or not the mail could be sent), so this cannot be used to discover accounts.
   */
  async forgotPassword(input: ForgotPasswordInput): Promise<OtpChallenge> {
    const cfg = await getSettings();
    const generic: OtpChallenge = {
      otpRequired: true,
      email: input.email,
      purpose: 'reset',
      expiresInSeconds: cfg.otpTtlMinutes * 60,
      resendAfterSeconds: cfg.otpResendCooldownSeconds,
    };

    const user = await authRepository.findByEmail(input.email);
    if (!user || user.status !== 'active') {
      // Burn comparable time so response timing does not reveal whether the account exists.
      await hashPassword('timing-padding-0');
      return generic;
    }
    try {
      return await otpService.issue(user.id, user.email, 'reset');
    } catch (err) {
      if (err instanceof TooManyRequestsError) return generic; // cooldown / hourly cap: stay silent
      // eslint-disable-next-line no-console
      console.error('[auth] could not start password reset:', err instanceof Error ? err.message : err);
      return generic;
    }
  },

  /** Checks the e-mailed code, sets the new password and signs the account out everywhere. */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const userId = await otpService.verify(input.email, 'reset', input.code);
    const user = await authRepository.findById(userId);
    if (!user || user.status !== 'active') {
      throw new BadRequestError('This code has expired or is no longer valid. Request a new one.');
    }
    await authRepository.updatePassword(userId, await hashPassword(input.newPassword));
    // Receiving the code proves control of the mailbox.
    if (!user.email_verified) await authRepository.markEmailVerified(userId);
    await authRepository.revokeAllUserRefreshTokens(userId);
  },

  async getCurrentUser(userId: string) {
    const user = await authRepository.findById(userId);
    if (!user) throw new UnauthorizedError('User not found');
    return sanitizeUser(user);
  },

  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await authRepository.findById(userId);
    if (!user) throw new UnauthorizedError('User not found');
    if (!(await comparePassword(input.currentPassword, user.password_hash))) {
      throw new BadRequestError('Current password is incorrect');
    }
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestError('New password must be different from the current one');
    }
    await authRepository.updatePassword(userId, await hashPassword(input.newPassword));
    // Sign out everywhere else, then start a fresh session for this device.
    await authRepository.revokeAllUserRefreshTokens(userId);
    const tokens = await issueTokens(user);
    return { user: sanitizeUser(user), tokens };
  },
};
