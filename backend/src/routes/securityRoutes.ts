import { Router } from 'express';
import { SecurityController } from '../controllers/securityController';
import { requireAuth, requireSensitiveAction } from '../middleware/authMiddleware';
import { verifyPasscodeLimiter } from '../middleware/rateLimiters';

const router = Router();

// All security routes require an active authenticated merchant session
router.use(requireAuth);

// Profile and status
router.get('/status', SecurityController.getSecurityStatus);
router.post('/verify-passcode', verifyPasscodeLimiter, SecurityController.verifyPasscode);

// WebAuthn Passkey Management
router.post('/webauthn/register/options', SecurityController.getRegistrationOptions);
router.post('/webauthn/register/verify', SecurityController.verifyRegistration);
router.post('/webauthn/authenticate/options', SecurityController.getAuthenticationOptions);
router.post('/webauthn/authenticate/verify', SecurityController.verifyAuthentication);
router.get('/webauthn/devices', SecurityController.listWebAuthnDevices);
router.delete(
  '/webauthn/devices/:id',
  requireSensitiveAction('DISABLE_LOCK'),
  SecurityController.deleteWebAuthnDevice
);

// Toggle Biometrics (disabling requires sensitive action token with DISABLE_LOCK)
router.post(
  '/biometrics/toggle',
  (req, res, next) => {
    if (req.body.enabled === false) {
      return requireSensitiveAction('DISABLE_LOCK')(req, res, next);
    }
    next();
  },
  SecurityController.toggleBiometrics
);

// Payouts & Reports (Guarded by sensitive action tokens)
router.post('/payouts', requireSensitiveAction('PAYOUT'), SecurityController.executePayout);
router.get('/payouts', SecurityController.listPayouts);
router.put('/bank-details', requireSensitiveAction('BANK_DETAILS'), SecurityController.updateBankDetails);
router.get('/reports/export', requireSensitiveAction('EXPORT'), SecurityController.exportReport);
router.get('/needs-attention', SecurityController.listNeedsAttention);

export default router;
