const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'app-data.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    const initialState = {
      users: [
        {
          id: 'user-1',
          name: 'Mina Chen',
          email: 'mina@example.com',
          phone: '+14165550100',
          marketingEmailConsent: true,
          marketingSmsConsent: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'user-2',
          name: 'Jordan Alvarez',
          email: 'jordan@example.com',
          phone: '+14165550101',
          marketingEmailConsent: true,
          marketingSmsConsent: true,
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      recipients: [
        {
          id: 'recipient-1',
          userId: 'user-1',
          name: 'Alicia Chen',
          relationship: 'Sister',
          phone: '+14165550102',
          addressLine1: '20 King St W',
          addressLine2: '',
          city: 'Toronto',
          province: 'ON',
          postalCode: 'M5H 3T1',
          deliveryInstructions: 'Ring buzzer 2',
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-03T00:00:00.000Z',
        },
        {
          id: 'recipient-2',
          userId: 'user-1',
          name: 'Nadia Chen',
          relationship: 'Mom',
          phone: '+14165550103',
          addressLine1: '40 Leslie St',
          addressLine2: '',
          city: 'Toronto',
          province: 'ON',
          postalCode: 'M4M 3L2',
          deliveryInstructions: 'Leave at front desk',
          createdAt: '2026-01-06T00:00:00.000Z',
          updatedAt: '2026-01-06T00:00:00.000Z',
        },
      ],
      milestones: [
        {
          id: 'milestone-1',
          userId: 'user-1',
          recipientId: 'recipient-1',
          occasionType: 'birthday',
          occasionLabel: 'Alicia turns 30',
          eventDate: '2026-08-15',
          repeatsAnnually: true,
          budgetTier: 'premium',
          status: 'active',
          cardMessageTone: 'warm',
          stylePreferences: 'Soft pastel tones',
          allergiesOrAvoid: 'No lilies',
          hardNoPreferences: 'No sunflowers',
          reminderDaysBefore: 7,
          chargeDaysBefore: 5,
          createdAt: '2026-01-10T00:00:00.000Z',
          updatedAt: '2026-01-10T00:00:00.000Z',
        },
        {
          id: 'milestone-2',
          userId: 'user-1',
          recipientId: 'recipient-2',
          occasionType: 'anniversary',
          occasionLabel: 'Momiversary',
          eventDate: '2026-09-01',
          repeatsAnnually: true,
          budgetTier: 'signature',
          status: 'active',
          cardMessageTone: 'romantic',
          stylePreferences: 'Classic roses',
          allergiesOrAvoid: '',
          hardNoPreferences: '',
          reminderDaysBefore: 7,
          chargeDaysBefore: 5,
          createdAt: '2026-01-11T00:00:00.000Z',
          updatedAt: '2026-01-11T00:00:00.000Z',
        },
      ],
      orders: [
        {
          id: 'order-1',
          userId: 'user-1',
          recipientId: 'recipient-1',
          milestoneId: 'milestone-1',
          eventDate: '2026-08-15',
          plannedChargeDate: '2026-08-10',
          budgetTier: 'premium',
          estimatedCustomerPriceCents: 20700,
          deliveryFeeCents: 1200,
          status: 'scheduled',
          floristPartnerId: 'florist-1',
          internalNotes: 'Need seasonal arrangement',
          customerNotes: 'Please keep it elegant',
          generatedCardMessage: 'A thoughtful note for warm.',
          photoProofUrl: '',
          deliveredAt: null,
          supportMinutes: 15,
          refundAmountCents: null,
          createdAt: '2026-01-15T00:00:00.000Z',
          updatedAt: '2026-01-15T00:00:00.000Z',
        },
      ],
      floristPartners: [
        {
          id: 'florist-1',
          name: 'Bloom & Co.',
          contactName: 'Sasha',
          email: 'ops@bloomco.com',
          phone: '+14165550110',
          address: '22 Ossington Ave',
          city: 'Toronto',
          postalCode: 'M6J 2Y3',
          active: true,
          weekdayOnly: true,
          serviceZones: ['Downtown Toronto', 'Yorkville'],
          notes: 'Good for premium arrangements',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      serviceZones: [
        {
          id: 'zone-1',
          name: 'Downtown Toronto',
          prefixes: ['M5'],
          active: true,
          deliveryFeeCents: 1200,
          notes: 'Core downtown coverage',
        },
        {
          id: 'zone-2',
          name: 'Leslieville',
          prefixes: ['M4M', 'M4L'],
          active: true,
          deliveryFeeCents: 1400,
          notes: 'East end delivery',
        },
      ],
      paymentConsents: [
        {
          id: 'consent-1',
          userId: 'user-1',
          stripeCustomerId: '',
          stripePaymentMethodId: '',
          consentTextVersion: 'v1',
          consentTextSnapshot: 'By saving your card, you authorize The Flowerist...',
          consentedAt: '2026-01-10T00:00:00.000Z',
          ipAddress: '127.0.0.1',
          userAgent: 'demo',
          active: true,
        },
      ],
      orderEvents: [
        {
          id: 'event-1',
          orderId: 'order-1',
          type: 'status_change',
          message: 'Order scheduled for concierge review',
          actorType: 'system',
          createdAt: '2026-01-15T00:00:00.000Z',
        },
      ],
      feedback: [],
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(initialState, null, 2));
  }

  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveStore(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function getState() {
  return ensureStore();
}

function setState(nextState) {
  saveStore(nextState);
  return nextState;
}

module.exports = {
  getState,
  setState,
};
