import rateLimit from 'express-rate-limit';

function limiter(windowMs: number, max: number, message: string, skipSuccessfulRequests = false) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: { success: false, message, errors: [] },
  });
}

const FIFTEEN_MIN = 15 * 60 * 1000;

// Only failed attempts count, so legitimate logins never eat the budget.
export const authRateLimiter = limiter(
  FIFTEEN_MIN,
  20,
  'Too many attempts. Please try again later.',
  true
);

// Separate budget for silent token refreshes so they can never lock out logins.
export const refreshRateLimiter = limiter(
  FIFTEEN_MIN,
  120,
  'Too many refresh attempts. Please try again later.',
  true
);

export const generalApiRateLimiter = limiter(FIFTEEN_MIN, 600, 'Too many requests. Please slow down.');
export const uploadRateLimiter = limiter(FIFTEEN_MIN, 60, 'Too many upload requests. Please try again later.');
export const couponRateLimiter = limiter(FIFTEEN_MIN, 30, 'Too many coupon attempts. Please try again later.');
export const checkoutRateLimiter = limiter(FIFTEEN_MIN, 30, 'Too many checkout attempts. Please try again later.');

// Resending e-mails costs money and can annoy people: cap it per IP (per-address caps live in otp.service).
export const otpResendRateLimiter = limiter(FIFTEEN_MIN, 20, 'Too many code requests. Please try again later.');

// Forgot-password sends e-mail: cap it per IP (per-address caps live in otp.service).
export const forgotPasswordRateLimiter = limiter(FIFTEEN_MIN, 20, 'Too many reset requests. Please try again later.');

// Wrong reset codes count; has its own budget so password resets and logins cannot lock each other out.
export const resetPasswordRateLimiter = limiter(
  FIFTEEN_MIN,
  20,
  'Too many attempts. Please try again later.',
  true
);
