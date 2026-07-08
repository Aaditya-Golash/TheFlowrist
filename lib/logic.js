const PRICING_TIERS = {
  classic: 14500,
  premium: 19500,
  signature: 27500,
};

function calculatePlannedChargeDate(eventDate, chargeDaysBefore) {
  const parsedDate = new Date(`${eventDate}T12:00:00`);
  parsedDate.setDate(parsedDate.getDate() - Number(chargeDaysBefore));
  return parsedDate.toISOString().slice(0, 10);
}

function generateNextYearlyOccurrence(eventDate) {
  const parsedDate = new Date(`${eventDate}T12:00:00`);
  parsedDate.setFullYear(parsedDate.getFullYear() + 1);
  return parsedDate.toISOString().slice(0, 10);
}

function normalizePostalCode(postalCode) {
  return String(postalCode || '').trim().toUpperCase();
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
  const basePrice = PRICING_TIERS[budgetTier] || PRICING_TIERS.classic;
  return Number(basePrice) + Number(deliveryFeeCents || 0);
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function validateStatusTransition(currentStatus, nextStatus) {
  const allowed = {
    scheduled: ['pre_charge_reminder_sent', 'pending_charge', 'cancelled'],
    pre_charge_reminder_sent: ['pending_charge', 'cancelled'],
    pending_charge: ['charged', 'cancelled'],
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
  generateNextYearlyOccurrence,
  getServiceZoneForPostalCode,
  isPostalCodeInZone,
  calculateEstimatedPrice,
  createScheduledOrderFromMilestone,
  validateStatusTransition,
};
