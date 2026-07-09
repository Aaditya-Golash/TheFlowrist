let stripeClient = null;

function validateStripeEnvironment(env = process.env) {
  const secretKey = env.STRIPE_SECRET_KEY || '';
  if (!secretKey) {
    throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is required');
  }
  return { secretKey };
}

function getStripeClient(env = process.env) {
  if (stripeClient) {
    return stripeClient;
  }
  const { secretKey } = validateStripeEnvironment(env);
  const Stripe = require('stripe');
  stripeClient = new Stripe(secretKey, { apiVersion: '2024-06-20' });
  return stripeClient;
}

function setStripeClient(client) {
  stripeClient = client;
  return stripeClient;
}

function resetStripeClient() {
  stripeClient = null;
}

module.exports = {
  validateStripeEnvironment,
  getStripeClient,
  setStripeClient,
  resetStripeClient,
};
