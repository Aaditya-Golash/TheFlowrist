function belongsToCustomer(record, customerId) {
  return Boolean(record) && record.userId === customerId;
}

async function assertCustomerOwnsRecipient(adapter, customerId, recipientId) {
  const recipient = await adapter.getRecipientById(recipientId);
  return belongsToCustomer(recipient, customerId);
}

async function assertCustomerOwnsMilestone(adapter, customerId, milestoneId) {
  const milestone = await adapter.getMilestoneById(milestoneId);
  return belongsToCustomer(milestone, customerId);
}

async function assertCustomerOwnsOrder(adapter, customerId, orderId) {
  const order = await adapter.getScheduledOrderById(orderId);
  return belongsToCustomer(order, customerId);
}

module.exports = {
  belongsToCustomer,
  assertCustomerOwnsRecipient,
  assertCustomerOwnsMilestone,
  assertCustomerOwnsOrder,
};
