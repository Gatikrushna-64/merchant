import { Order, AppConfig, Payout } from '../types';

const API_BASE = '/api/v1';

export const api = {
  async getConfig(): Promise<AppConfig> {
    const res = await fetch(`${API_BASE}/config`, { credentials: 'include' });
    const data = await res.json();
    return data.data;
  },

  async createOrder(amountInPaise: number, note?: string): Promise<Order> {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ amount: amountInPaise, note })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to generate dynamic QR code');
    }
    return data.data;
  },

  async getOrder(id: string): Promise<Order> {
    const res = await fetch(`${API_BASE}/orders/${id}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch order status');
    }
    return data.data;
  },

  async refreshOrder(id: string): Promise<Order> {
    const res = await fetch(`${API_BASE}/orders/${id}/refresh`, {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to refresh QR code');
    }
    return data.data;
  },

  async listOrders(params: {
    status?: string;
    searchRef?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ orders: Order[]; total: number; summary: { todayOrdersCount: number; todayPaidPaise: number } }> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.searchRef) query.set('searchRef', params.searchRef);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.offset) query.set('offset', params.offset.toString());

    const res = await fetch(`${API_BASE}/orders?${query.toString()}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to list transactions');
    }
    return {
      orders: data.data,
      total: data.total,
      summary: data.summary
    };
  },

  async simulateCustomerPayment(orderId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/payments/simulate-success`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ orderId })
    });
    return res.json();
  },

  async listPayouts(): Promise<Payout[]> {
    const res = await fetch(`${API_BASE}/security/payouts`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.data;
  },

  async listNeedsAttention(): Promise<{ lateOrders: Order[]; flaggedEvents: any[] }> {
    const res = await fetch(`${API_BASE}/security/needs-attention`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.data;
  }
};
