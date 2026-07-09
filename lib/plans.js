const RELATIONSHIP_PLANS = {
  datekeeper: {
    key: 'datekeeper',
    name: 'Free Datekeeper',
    annualFeeCents: 0,
    protectedDateLimit: 3,
    description: 'Save important dates for free. We remind you before any order.',
    benefits: ['Up to 3 protected dates each year', 'Reminder before any charge', 'Pay per delivery'],
  },
  thoughtful: {
    key: 'thoughtful',
    name: 'Thoughtful Calendar',
    annualFeeCents: 4900,
    protectedDateLimit: 6,
    description: 'For partner, parents, and family moments that deserve care.',
    benefits: ['Up to 6 protected dates each year', 'Holiday reminders', 'Card-message help', 'Pay per delivery'],
  },
  signature: {
    key: 'signature',
    name: 'Signature Concierge',
    annualFeeCents: 9900,
    protectedDateLimit: 12,
    description: 'For people who want consistently thoughtful gestures.',
    benefits: ['Up to 12 protected dates each year', 'Priority holiday slots', 'Richer card-message help', 'Surprise & Delight eligibility'],
  },
};

const SURPRISE_MONTHLY_TIERS = {
  classic: { key: 'classic', name: 'Classic', monthlyPriceCents: 12500 },
  premium: { key: 'premium', name: 'Premium', monthlyPriceCents: 17500 },
  signature: { key: 'signature', name: 'Signature', monthlyPriceCents: 25000 },
};

function getRelationshipPlans() {
  return Object.values(RELATIONSHIP_PLANS).map((plan) => ({ ...plan, benefits: [...plan.benefits] }));
}

function getRelationshipPlan(key) {
  return RELATIONSHIP_PLANS[key] || RELATIONSHIP_PLANS.datekeeper;
}

function getSurpriseMonthlyTiers() {
  return Object.values(SURPRISE_MONTHLY_TIERS).map((tier) => ({ ...tier }));
}

function getSurpriseMonthlyTier(key) {
  return SURPRISE_MONTHLY_TIERS[key] || SURPRISE_MONTHLY_TIERS.classic;
}

function isSignaturePlan(membership) {
  return Boolean(membership && membership.status === 'active' && membership.planKey === 'signature');
}

module.exports = {
  RELATIONSHIP_PLANS,
  SURPRISE_MONTHLY_TIERS,
  getRelationshipPlans,
  getRelationshipPlan,
  getSurpriseMonthlyTiers,
  getSurpriseMonthlyTier,
  isSignaturePlan,
};
