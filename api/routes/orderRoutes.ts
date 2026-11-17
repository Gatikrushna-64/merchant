import { Router } from 'express';
import { OrderController } from '../controllers/orderController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// All order routes are strictly protected and isolated by session
router.use(requireAuth);

router.post('/', OrderController.createOrder);
router.get('/', OrderController.listOrders);
router.get('/:id', OrderController.getOrder);
router.post('/:id/refresh', OrderController.refreshOrder);

export default router;
