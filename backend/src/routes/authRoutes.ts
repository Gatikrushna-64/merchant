import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { requireAuth } from '../middleware/authMiddleware';
import { otpSendLimiter, otpVerifyLimiter, loginLimiter } from '../middleware/rateLimiters';

const router = Router();

// Public auth endpoints
router.post('/otp/send', otpSendLimiter, AuthController.sendOtp);
router.post('/otp/verify', otpVerifyLimiter, AuthController.verifyOtp);
router.post('/login', loginLimiter, AuthController.login);
router.post('/logout', AuthController.logout);
router.post('/reset-pin', loginLimiter, AuthController.resetPin);
router.post('/register', AuthController.register);

// Protected session check
router.get('/me', requireAuth, AuthController.me);

export default router;
