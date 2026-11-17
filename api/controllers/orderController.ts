import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { OrderService } from '../services/orderService';

export class OrderController {
  public static async createOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { amount, note } = req.body;

      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        res.status(400).json({ success: false, error: 'Amount must be a positive integer in paise.' });
        return;
      }

      const order = await OrderService.createOrder(req.merchant.id, amount, note);

      res.status(201).json({
        success: true,
        data: order
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async getOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const order = await OrderService.getOrder(id, req.merchant.id);

      if (!order) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }

      res.json({
        success: true,
        data: order
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  public static async refreshOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const order = await OrderService.refreshOrder(id, req.merchant.id);

      res.json({
        success: true,
        data: order
      });
    } catch (err: any) {
      if (err.message.includes('not found')) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }
      res.status(400).json({ success: false, error: err.message });
    }
  }

  public static async listOrders(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.merchant) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const status = req.query.status as string;
      const searchRef = req.query.searchRef as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const result = await OrderService.listMerchantOrders(req.merchant.id, {
        status,
        searchRef,
        startDate,
        endDate,
        limit,
        offset
      });

      res.json({
        success: true,
        data: result.orders,
        total: result.total,
        summary: result.summary
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}
