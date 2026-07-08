const PRICING_TIERS = {
  classic: {
    key: 'classic',
    name: 'Classic',
    customerPriceCents: 14500,
    arrangementValueCents: 11000,
    deliveryAllowanceCents: 2000,
    platformFeeCents: 1500,
    description: 'A thoughtful seasonal arrangement for everyday milestones.',
  },
  premium: {
    key: 'premium',
    name: 'Premium',
    customerPriceCents: 19500,
    arrangementValueCents: 15500,
    deliveryAllowanceCents: 2500,
    platformFeeCents: 1500,
    description: 'A fuller, more elevated arrangement for bigger moments.',
  },
  signature: {
    key: 'signature',
    name: 'Signature',
    customerPriceCents: 27500,
    arrangementValueCents: 22500,
    deliveryAllowanceCents: 2500,
    platformFeeCents: 2500,
    description: "Our most generous designer's-choice arrangement for dates that deserve extra presence.",
  },
};

function getPricingTiers() {
  return Object.values(PRICING_TIERS).map((tier) => ({ ...tier }));
}

function getPricingTier(key) {
  return PRICING_TIERS[key] || PRICING_TIERS.classic;
}

function formatMoney(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(0)}`;
}

function estimateStripeFeeCents(customerPriceCents) {
  return Math.round(Number(customerPriceCents || 0) * 0.029) + 30;
}

function estimatePlatformProfitCents(tierKey, rebateRate = 0.25) {
  const tier = getPricingTier(tierKey);
  const floristNetCents = Math.round(tier.arrangementValueCents * (1 - Number(rebateRate || 0)));
  return tier.customerPriceCents
    - floristNetCents
    - tier.deliveryAllowanceCents
    - tier.platformFeeCents
    - estimateStripeFeeCents(tier.customerPriceCents);
}

module.exports = {
  PRICING_TIERS,
  getPricingTiers,
  getPricingTier,
  formatMoney,
  estimateStripeFeeCents,
  estimatePlatformProfitCents,
};
