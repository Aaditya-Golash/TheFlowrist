const { PRICING_TIERS, getPricingTier } = require('./pricing');

function calculatePlannedChargeDate(eventDate, chargeDaysBefore) {
  const parsedDate = new Date(`${eventDate}T12:00:00`);
  parsedDate.setDate(parsedDate.getDate() - Number(chargeDaysBefore));
  return parsedDate.toISOString().slice(0, 10);
}

function calculateReminderDate(eventDate, reminderDaysBefore) {
  const parsedDate = new Date(`${eventDate}T12:00:00`);
  parsedDate.setDate(parsedDate.getDate() - Number(reminderDaysBefore));
  return parsedDate.toISOString().slice(0, 10);
}

function generateNextYearlyOccurrence(eventDate) {
  const parsedDate = new Date(`${eventDate}T12:00:00`);
  parsedDate.setFullYear(parsedDate.getFullYear() + 1);
  return parsedDate.toISOString().slice(0, 10);
}

function normalizePostalCode(postalCode) {
  const trimmed = String(postalCode || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!trimmed) {
    return '';
  }

  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(trimmed)) {
    return `${trimmed.slice(0, 3)} ${trimmed.slice(3)}`;
  }

  return trimmed;
}

function formatPostalCode(postalCode) {
  return normalizePostalCode(postalCode);
}

function isValidCanadianPostalCode(postalCode) {
  const normalized = normalizePostalCode(postalCode);
  return /^[A-Z]\d[A-Z] \d[A-Z]\d$/.test(normalized);
}

function isFutureDate(dateValue) {
  const parsedDate = new Date(`${dateValue}T12:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsedDate >= today;
}

function isValidBudgetTier(budgetTier) {
  return Boolean(budgetTier && PRICING_TIERS[budgetTier]);
}

function getServiceZoneForPostalCode(serviceZones, postalCode) {
  const normalized = normalizePostalCode(postalCode);
  if (!normalized) {
    return null;
  }

  return serviceZones.find((zone) => zone.active && zone.prefixes.some((prefix) => normalized.startsWith(prefix))) || null;
}

function isPostalCodeInZone(postalCode, serviceZones) {
  return Boolean(getServiceZoneForPostalCode(serviceZones, postalCode));
}

function calculateEstimatedPrice(budgetTier, deliveryFeeCents) {
  return getPricingTier(budgetTier).customerPriceCents;
}

function createScheduledOrderFromMilestone(milestone, user, serviceZone) {
  const plannedChargeDate = calculatePlannedChargeDate(milestone.eventDate, milestone.chargeDaysBefore || 5);
  const deliveryFee = serviceZone?.deliveryFeeCents || 0;
  return {
    id: `order-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId: user.id,
    recipientId: milestone.recipientId,
    milestoneId: milestone.id,
    eventDate: milestone.eventDate,
    plannedChargeDate,
    budgetTier: milestone.budgetTier,
    estimatedCustomerPriceCents: calculateEstimatedPrice(milestone.budgetTier, deliveryFee),
    deliveryFeeCents: deliveryFee,
    status: 'scheduled',
    floristPartnerId: null,
    internalNotes: '',
    customerNotes: '',
    generatedCardMessage: milestone.cardMessageTone ? `A thoughtful note for ${milestone.cardMessageTone}.` : '',
    photoProofUrl: '',
    deliveredAt: null,
    supportMinutes: 0,
    refundAmountCents: null,
    stripePaymentIntentId: null,
    priceOverrideReason: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function getOrdersNeedingReminder(orders, milestones) {
  const milestonesById = new Map(milestones.map((milestone) => [milestone.id, milestone]));
  const today = new Date().toISOString().slice(0, 10);
  return orders.filter((order) => {
    if (order.status !== 'scheduled') {
      return false;
    }
    const milestone = milestonesById.get(order.milestoneId);
    const reminderDaysBefore = milestone?.reminderDaysBefore ?? 7;
    const reminderDate = calculateReminderDate(order.eventDate, reminderDaysBefore);
    return reminderDate <= today;
  });
}

function validateStatusTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    return true;
  }

  // issue_reported is reachable from scheduled/pre_charge_reminder_sent/pending_charge
  // so a failed or declined charge attempt has somewhere safe to land instead of
  // silently staying in a pre-charge state or being force-marked as charged/cancelled.
  const allowed = {
    scheduled: ['pre_charge_reminder_sent', 'pending_charge', 'issue_reported', 'cancelled'],
    pre_charge_reminder_sent: ['pending_charge', 'issue_reported', 'cancelled'],
    pending_charge: ['charged', 'issue_reported', 'cancelled'],
    charged: ['sent_to_florist', 'cancelled'],
    sent_to_florist: ['florist_accepted', 'cancelled'],
    florist_accepted: ['preparing', 'cancelled'],
    preparing: ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered', 'issue_reported', 'cancelled'],
    delivered: ['issue_reported', 'refunded'],
    issue_reported: ['refunded', 'cancelled'],
    refunded: [],
    cancelled: [],
  };

  return allowed[currentStatus] ? allowed[currentStatus].includes(nextStatus) : false;
}

module.exports = {
  PRICING_TIERS,
  calculatePlannedChargeDate,
  calculateReminderDate,
  generateNextYearlyOccurrence,
  normalizePostalCode,
  formatPostalCode,
  isValidCanadianPostalCode,
  isFutureDate,
  isValidBudgetTier,
  getServiceZoneForPostalCode,
  isPostalCodeInZone,
  calculateEstimatedPrice,
  createScheduledOrderFromMilestone,
  getOrdersNeedingReminder,
  validateStatusTransition,
};
