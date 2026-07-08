// Placeholder Supabase adapter stub for future integration.
// TODO: implement Supabase-backed persistence and auth-aware queries.

function createSupabaseStore() {
  return {
    getState() {
      throw new Error('Supabase store not implemented yet');
    },
    saveState() {
      throw new Error('Supabase store not implemented yet');
    },
    listCustomers() {
      throw new Error('Supabase store not implemented yet');
    },
    getCustomerById() {
      throw new Error('Supabase store not implemented yet');
    },
    createRecipient() {
      throw new Error('Supabase store not implemented yet');
    },
    updateRecipient() {
      throw new Error('Supabase store not implemented yet');
    },
    createMilestone() {
      throw new Error('Supabase store not implemented yet');
    },
    updateMilestone() {
      throw new Error('Supabase store not implemented yet');
    },
    listScheduledOrders() {
      throw new Error('Supabase store not implemented yet');
    },
    getScheduledOrderById() {
      throw new Error('Supabase store not implemented yet');
    },
    createScheduledOrder() {
      throw new Error('Supabase store not implemented yet');
    },
    updateScheduledOrder() {
      throw new Error('Supabase store not implemented yet');
    },
    createOrderEventLog() {
      throw new Error('Supabase store not implemented yet');
    },
    listOrderEventLogs() {
      throw new Error('Supabase store not implemented yet');
    },
    createPaymentConsent() {
      throw new Error('Supabase store not implemented yet');
    },
    revokePaymentConsent() {
      throw new Error('Supabase store not implemented yet');
    },
    listFloristPartners() {
      throw new Error('Supabase store not implemented yet');
    },
    createFloristPartner() {
      throw new Error('Supabase store not implemented yet');
    },
    updateFloristPartner() {
      throw new Error('Supabase store not implemented yet');
    },
    listServiceZones() {
      throw new Error('Supabase store not implemented yet');
    },
  };
}

module.exports = {
  createSupabaseStore,
};
