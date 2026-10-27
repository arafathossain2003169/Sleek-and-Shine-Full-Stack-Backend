import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { authRateLimiter, forgotPasswordRateLimiter, otpResendRateLimiter, refreshRateLimiter, resetPasswordRateLimiter } from '../../middlewares/rateLimit.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { authController } from './auth.controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from './auth.schemas';

const router = Router();

router.post('/register', authRateLimiter, validate({ body: registerSchema }), authController.register);
router.post('/login', authRateLimiter, validate({ body: loginSchema }), authController.login);
router.post('/verify-otp', authRateLimiter, validate({ body: verifyOtpSchema }), authController.verifyOtp);
router.post('/resend-otp', otpResendRateLimiter, validate({ body: resendOtpSchema }), authController.resendOtp);
router.post(
  '/forgot-password',
  forgotPasswordRateLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword
);
router.post('/reset-password', resetPasswordRateLimiter, validate({ body: resetPasswordSchema }), authController.resetPassword);
router.post('/logout', authController.logout);
router.post('/refresh', refreshRateLimiter, authController.refresh);
router.get('/me', requireAuth, authController.me);
router.post(
  '/change-password',
  requireAuth,
  authRateLimiter,
  validate({ body: changePasswordSchema }),
  authController.changePassword
);

export default router;
