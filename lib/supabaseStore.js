const { createClient } = require('@supabase/supabase-js');
const { validateSupabaseEnvironment } = require('./supabase-env');
const { ensureWebSocketShim } = require('./ws-shim');

const CUSTOMER_FIELDS = {
  id: 'id',
  name: 'name',
  email: 'email',
  phone: 'phone',
  marketingEmailConsent: 'marketing_email_consent',
  marketingSmsConsent: 'marketing_sms_consent',
  authUserId: 'auth_user_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const RECIPIENT_FIELDS = {
  id: 'id',
  userId: 'customer_id',
  name: 'name',
  relationship: 'relationship',
  phone: 'phone',
  addressLine1: 'address_line_1',
  addressLine2: 'address_line_2',
  city: 'city',
  province: 'province',
  postalCode: 'postal_code',
  deliveryInstructions: 'delivery_instructions',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const MILESTONE_FIELDS = {
  id: 'id',
  userId: 'customer_id',
  recipientId: 'recipient_id',
  occasionType: 'occasion_type',
  occasionLabel: 'occasion_label',
  eventDate: 'event_date',
  repeatsAnnually: 'repeats_annually',
  budgetTier: 'budget_tier',
  status: 'status',
  cardMessageTone: 'card_message_tone',
  stylePreferences: 'style_preferences',
  allergiesOrAvoid: 'allergies_or_avoid',
  hardNoPreferences: 'hard_no_preferences',
  reminderDaysBefore: 'reminder_days_before',
  chargeDaysBefore: 'charge_days_before',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const ORDER_FIELDS = {
  id: 'id',
  userId: 'customer_id',
  recipientId: 'recipient_id',
  milestoneId: 'milestone_id',
  eventDate: 'event_date',
  plannedChargeDate: 'planned_charge_date',
  budgetTier: 'budget_tier',
  estimatedCustomerPriceCents: 'estimated_customer_price_cents',
  deliveryFeeCents: 'delivery_fee_cents',
  status: 'status',
  floristPartnerId: 'florist_partner_id',
  internalNotes: 'internal_notes',
  customerNotes: 'customer_notes',
  generatedCardMessage: 'generated_card_message',
  photoProofUrl: 'photo_proof_url',
  deliveredAt: 'delivered_at',
  supportMinutes: 'support_minutes',
  refundAmountCents: 'refund_amount_cents',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const FLORIST_FIELDS = {
  id: 'id',
  name: 'name',
  contactName: 'contact_name',
  email: 'email',
  phone: 'phone',
  address: 'address',
  city: 'city',
  postalCode: 'postal_code',
  active: 'active',
  weekdayOnly: 'weekday_only',
  serviceZones: 'service_zones',
  notes: 'notes',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const ZONE_FIELDS = {
  id: 'id',
  name: 'name',
  prefixes: 'prefixes',
  active: 'active',
  deliveryFeeCents: 'delivery_fee_cents',
  notes: 'notes',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const CONSENT_FIELDS = {
  id: 'id',
  userId: 'customer_id',
  stripeCustomerId: 'stripe_customer_id',
  stripePaymentMethodId: 'stripe_payment_method_id',
  consentTextVersion: 'consent_text_version',
  consentTextSnapshot: 'consent_text_snapshot',
  consentedAt: 'consented_at',
  ipAddress: 'ip_address',
  userAgent: 'user_agent',
  active: 'active',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const EVENT_FIELDS = {
  id: 'id',
  orderId: 'order_id',
  type: 'type',
  message: 'message',
  actorType: 'actor_type',
  createdAt: 'created_at',
};

const FEEDBACK_FIELDS = {
  id: 'id',
  orderId: 'order_id',
  rating: 'rating',
  comments: 'comments',
  createdAt: 'created_at',
};

function toCamel(row, fieldMap) {
  if (!row) {
    return null;
  }
  const result = {};
  Object.entries(fieldMap).forEach(([camelKey, snakeKey]) => {
    result[camelKey] = row[snakeKey] !== undefined ? row[snakeKey] : null;
  });
  return result;
}

function toSnake(entity, fieldMap) {
  const result = {};
  Object.entries(fieldMap).forEach(([camelKey, snakeKey]) => {
    if (entity[camelKey] !== undefined) {
      result[snakeKey] = entity[camelKey];
    }
  });
  return result;
}

function createSupabaseStore(env = process.env) {
  const { supabaseUrl, serviceRoleKey } = validateSupabaseEnvironment(env);

  let supabase = null;

  function getClient() {
    if (!supabase) {
      ensureWebSocketShim();
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
        users: customers.map((row) => toCamel(row, CUSTOMER_FIELDS)),
        recipients: recipients.map((row) => toCamel(row, RECIPIENT_FIELDS)),
        milestones: milestones.map((row) => toCamel(row, MILESTONE_FIELDS)),
        orders: orders.map((row) => toCamel(row, ORDER_FIELDS)),
        floristPartners: floristPartners.map((row) => toCamel(row, FLORIST_FIELDS)),
        serviceZones: serviceZones.map((row) => toCamel(row, ZONE_FIELDS)),
        paymentConsents: paymentConsents.map((row) => toCamel(row, CONSENT_FIELDS)),
        orderEvents: orderEvents.map((row) => toCamel(row, EVENT_FIELDS)),
        feedback: feedback.map((row) => toCamel(row, FEEDBACK_FIELDS)),
      };
    },
    async saveState() {
      throw new Error('saveState is not implemented for the Supabase backend; use the explicit CRUD methods instead');
    },
    async listCustomers() {
      const rows = await query('customers');
      return rows.map((row) => toCamel(row, CUSTOMER_FIELDS));
    },
    async getCustomerById(id) {
      const rows = await query('customers', { eq: { id } });
      return toCamel(rows[0], CUSTOMER_FIELDS);
    },
    async createCustomer(customer) {
      const row = await insert('customers', toSnake(customer, CUSTOMER_FIELDS));
      return toCamel(row, CUSTOMER_FIELDS);
    },
    async updateCustomer(customerId, changes) {
      const row = await update('customers', customerId, toSnake({ ...changes, updatedAt: new Date().toISOString() }, CUSTOMER_FIELDS));
      return toCamel(row, CUSTOMER_FIELDS);
    },
    async listRecipients() {
      const rows = await query('recipients');
      return rows.map((row) => toCamel(row, RECIPIENT_FIELDS));
    },
    async getRecipientById(id) {
      const rows = await query('recipients', { eq: { id } });
      return toCamel(rows[0], RECIPIENT_FIELDS);
    },
    async createRecipient(recipient) {
      const row = await insert('recipients', toSnake(recipient, RECIPIENT_FIELDS));
      return toCamel(row, RECIPIENT_FIELDS);
    },
    async updateRecipient(recipientId, changes) {
      const row = await update('recipients', recipientId, toSnake({ ...changes, updatedAt: new Date().toISOString() }, RECIPIENT_FIELDS));
      return toCamel(row, RECIPIENT_FIELDS);
    },
    async listMilestones() {
      const rows = await query('milestones');
      return rows.map((row) => toCamel(row, MILESTONE_FIELDS));
    },
    async getMilestoneById(id) {
      const rows = await query('milestones', { eq: { id } });
      return toCamel(rows[0], MILESTONE_FIELDS);
    },
    async createMilestone(milestone) {
      const row = await insert('milestones', toSnake(milestone, MILESTONE_FIELDS));
      return toCamel(row, MILESTONE_FIELDS);
    },
    async updateMilestone(milestoneId, changes) {
      const row = await update('milestones', milestoneId, toSnake({ ...changes, updatedAt: new Date().toISOString() }, MILESTONE_FIELDS));
      return toCamel(row, MILESTONE_FIELDS);
    },
    async listScheduledOrders() {
      const rows = await query('scheduled_orders');
      return rows.map((row) => toCamel(row, ORDER_FIELDS));
    },
    async getScheduledOrderById(id) {
      const rows = await query('scheduled_orders', { eq: { id } });
      return toCamel(rows[0], ORDER_FIELDS);
    },
    async createScheduledOrder(order) {
      const row = await insert('scheduled_orders', toSnake(order, ORDER_FIELDS));
      return toCamel(row, ORDER_FIELDS);
    },
    async updateScheduledOrder(orderId, changes) {
      const row = await update('scheduled_orders', orderId, toSnake({ ...changes, updatedAt: new Date().toISOString() }, ORDER_FIELDS));
      return toCamel(row, ORDER_FIELDS);
    },
    async createOrderEventLog(event) {
      const row = await insert('order_event_logs', toSnake(event, EVENT_FIELDS));
      return toCamel(row, EVENT_FIELDS);
    },
    async listOrderEventLogs(orderId) {
      const rows = await query('order_event_logs', { eq: { order_id: orderId } });
      return rows.map((row) => toCamel(row, EVENT_FIELDS));
    },
    async listPaymentConsents() {
      const rows = await query('payment_consents');
      return rows.map((row) => toCamel(row, CONSENT_FIELDS));
    },
    async createPaymentConsent(consent) {
      const row = await insert('payment_consents', toSnake(consent, CONSENT_FIELDS));
      return toCamel(row, CONSENT_FIELDS);
    },
    async revokePaymentConsent(consentId) {
      const row = await update('payment_consents', consentId, { active: false, consented_at: new Date().toISOString() });
      return toCamel(row, CONSENT_FIELDS);
    },
    async listFloristPartners() {
      const rows = await query('florist_partners');
      return rows.map((row) => toCamel(row, FLORIST_FIELDS));
    },
    async createFloristPartner(floristPartner) {
      const row = await insert('florist_partners', toSnake(floristPartner, FLORIST_FIELDS));
      return toCamel(row, FLORIST_FIELDS);
    },
    async updateFloristPartner(floristPartnerId, changes) {
      const row = await update('florist_partners', floristPartnerId, toSnake({ ...changes, updatedAt: new Date().toISOString() }, FLORIST_FIELDS));
      return toCamel(row, FLORIST_FIELDS);
    },
    async listServiceZones() {
      const rows = await query('service_zones');
      return rows.map((row) => toCamel(row, ZONE_FIELDS));
    },
  };
}

module.exports = {
  createSupabaseStore,
};
