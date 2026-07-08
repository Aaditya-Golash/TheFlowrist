const { createClient } = require('@supabase/supabase-js');
const { validateSupabaseEnvironment } = require('./supabase-env');

function createSupabaseStore(env = process.env) {
  const { supabaseUrl, serviceRoleKey } = validateSupabaseEnvironment(env);

  let supabase = null;

  function getClient() {
    if (!supabase) {
      if (typeof globalThis.WebSocket === 'undefined') {
        globalThis.WebSocket = require('ws');
      }
      supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return supabase;
  }

  async function query(table, options = {}) {
    const client = getClient();
    let request = client.from(table).select(options.select || '*');
    if (options.order) {
      request = request.order(options.order.column, { ascending: options.order.ascending ?? true });
    }
    if (options.eq) {
      Object.entries(options.eq).forEach(([column, value]) => {
        request = request.eq(column, value);
      });
    }
    if (options.filter) {
      Object.entries(options.filter).forEach(([column, value]) => {
        request = request.filter(column, 'eq', value);
      });
    }
    if (options.limit) {
      request = request.limit(options.limit);
    }
    const { data, error } = await request;
    if (error) {
      throw error;
    }
    return data || [];
  }

  async function insert(table, row) {
    const client = getClient();
    const { data, error } = await client.from(table).insert(row).select('*');
    if (error) {
      throw error;
    }
    return data?.[0] || null;
  }

  async function upsert(table, row, conflictColumn = 'id') {
    const client = getClient();
    const { data, error } = await client.from(table).upsert(row, { onConflict: conflictColumn }).select('*');
    if (error) {
      throw error;
    }
    return data?.[0] || null;
  }

  async function update(table, id, changes) {
    const client = getClient();
    const { data, error } = await client.from(table).update(changes).eq('id', id).select('*');
    if (error) {
      throw error;
    }
    return data?.[0] || null;
  }

  return {
    async getState() {
      const [customers, recipients, milestones, orders, floristPartners, serviceZones, paymentConsents, orderEvents, feedback] = await Promise.all([
        query('customers'),
        query('recipients'),
        query('milestones'),
        query('scheduled_orders'),
        query('florist_partners'),
        query('service_zones'),
        query('payment_consents'),
        query('order_event_logs'),
        query('feedback'),
      ]);

      return {
        users: customers,
        recipients,
        milestones,
        orders,
        floristPartners,
        serviceZones,
        paymentConsents,
        orderEvents,
        feedback,
      };
    },
    async saveState(state) {
      throw new Error('saveState is not implemented for the Supabase backend; use the explicit CRUD methods instead');
    },
    async listCustomers() {
      return query('customers');
    },
    async getCustomerById(id) {
      const rows = await query('customers', { eq: { id } });
      return rows[0] || null;
    },
    async createRecipient(recipient) {
      return insert('recipients', recipient);
    },
    async updateRecipient(recipientId, changes) {
      return update('recipients', recipientId, changes);
    },
    async createMilestone(milestone) {
      return insert('milestones', milestone);
    },
    async updateMilestone(milestoneId, changes) {
      return update('milestones', milestoneId, changes);
    },
    async listScheduledOrders() {
      return query('scheduled_orders');
    },
    async getScheduledOrderById(id) {
      const rows = await query('scheduled_orders', { eq: { id } });
      return rows[0] || null;
    },
    async createScheduledOrder(order) {
      return insert('scheduled_orders', order);
    },
    async updateScheduledOrder(orderId, changes) {
      return update('scheduled_orders', orderId, changes);
    },
    async createOrderEventLog(event) {
      return insert('order_event_logs', event);
    },
    async listOrderEventLogs(orderId) {
      return query('order_event_logs', { eq: { order_id: orderId } });
    },
    async createPaymentConsent(consent) {
      return insert('payment_consents', consent);
    },
    async revokePaymentConsent(consentId) {
      return update('payment_consents', consentId, { active: false, consented_at: new Date().toISOString() });
    },
    async listFloristPartners() {
      return query('florist_partners');
    },
    async createFloristPartner(floristPartner) {
      return insert('florist_partners', floristPartner);
    },
    async updateFloristPartner(floristPartnerId, changes) {
      return update('florist_partners', floristPartnerId, changes);
    },
    async listServiceZones() {
      return query('service_zones');
    },
  };
}

module.exports = {
  createSupabaseStore,
};
