import { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { sendSuccess } from '../../utils/apiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { UnauthorizedError } from '../../utils/errors';
import { authService } from './auth.service';

const REFRESH_COOKIE_NAME = 'refresh_token';
const ACCESS_COOKIE_NAME = 'access_token';

function baseCookie(path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: env.IS_PROD,
    sameSite: env.IS_PROD ? 'none' : 'lax',
    path,
  };
}

function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...baseCookie('/api/auth'),
    maxAge: env.JWT_REFRESH_EXPIRES_IN_MS,
  });
  res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, {
    ...baseCookie('/'),
    maxAge: env.JWT_ACCESS_EXPIRES_IN_MS,
  });
}

function clearAuthCookies(res: Response): void {
  // Attributes must match the ones used when setting, or some browsers keep the cookie.
  res.clearCookie(REFRESH_COOKIE_NAME, baseCookie('/api/auth'));
  res.clearCookie(ACCESS_COOKIE_NAME, baseCookie('/'));
}

export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.register(req.body);
    if ('challenge' in result) {
      sendSuccess(res, result.challenge, 'We sent a verification code to your email', 200);
      return;
    }
    setAuthCookies(res, result.tokens);
    sendSuccess(res, { user: result.user, accessToken: result.tokens.accessToken }, 'Account created successfully', 201);
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body);
    if ('challenge' in result) {
      sendSuccess(res, result.challenge, 'We sent a verification code to your email', 200);
      return;
    }
    setAuthCookies(res, result.tokens);
    sendSuccess(res, { user: result.user, accessToken: result.tokens.accessToken }, 'Logged in successfully');
  }),

  verifyOtp: asyncHandler(async (req: Request, res: Response) => {
    const { user, tokens } = await authService.verifyOtp(req.body);
    setAuthCookies(res, tokens);
    sendSuccess(res, { user, accessToken: tokens.accessToken }, 'Verified. You are signed in');
  }),

  resendOtp: asyncHandler(async (req: Request, res: Response) => {
    const challenge = await authService.resendOtp(req.body);
    sendSuccess(res, challenge, 'If the account exists, a new code was sent');
  }),

  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.forgotPassword(req.body);
    sendSuccess(res, result, 'If an account exists for that email, we sent a reset code');
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.resetPassword(req.body);
    // Every session was revoked; make sure this browser is signed out too.
    clearAuthCookies(res);
    sendSuccess(res, {}, 'Password updated. Please log in with your new password');
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME]);
    clearAuthCookies(res);
    sendSuccess(res, {}, 'Logged out successfully');
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) throw new UnauthorizedError('No refresh token provided');
    try {
      const tokens = await authService.refresh(refreshToken);
      setAuthCookies(res, tokens);
      sendSuccess(res, { accessToken: tokens.accessToken }, 'Token refreshed');
    } catch (err) {
      if (err instanceof UnauthorizedError) clearAuthCookies(res);
      throw err;
    }
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.getCurrentUser(req.user!.id);
    sendSuccess(res, { user }, 'Current user fetched');
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    const { user, tokens } = await authService.changePassword(req.user!.id, req.body);
    setAuthCookies(res, tokens);
    sendSuccess(res, { user, accessToken: tokens.accessToken }, 'Password changed successfully');
  }),
};
