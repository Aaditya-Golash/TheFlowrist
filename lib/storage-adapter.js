const fs = require('fs');
const path = require('path');
const { ensureDataFile, writeSeedData, resetData } = require('./seed');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'app-data.json');

function readStateFromDisk() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeStateToDisk(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  return state;
}

function createJsonStorageAdapter() {
  return {
    getState() {
      return readStateFromDisk();
    },
    saveState(nextState) {
      return writeStateToDisk(nextState);
    },
    listCustomers() {
      return this.getState().users || [];
    },
    getCustomerById(id) {
      return this.listCustomers().find((entry) => entry.id === id) || null;
    },
    createRecipient(recipient) {
      const state = this.getState();
      state.recipients.push(recipient);
      this.saveState(state);
      return recipient;
    },
    updateRecipient(recipientId, changes) {
      const state = this.getState();
      const recipient = state.recipients.find((entry) => entry.id === recipientId);
      if (!recipient) {
        return null;
      }
      Object.assign(recipient, changes, { updatedAt: new Date().toISOString() });
      this.saveState(state);
      return recipient;
    },
    createMilestone(milestone) {
      const state = this.getState();
      state.milestones.push(milestone);
      this.saveState(state);
      return milestone;
    },
    updateMilestone(milestoneId, changes) {
      const state = this.getState();
      const milestone = state.milestones.find((entry) => entry.id === milestoneId);
      if (!milestone) {
        return null;
      }
      Object.assign(milestone, changes, { updatedAt: new Date().toISOString() });
      this.saveState(state);
      return milestone;
    },
    listScheduledOrders() {
      return this.getState().orders || [];
    },
    getScheduledOrderById(id) {
      return this.listScheduledOrders().find((entry) => entry.id === id) || null;
    },
    createScheduledOrder(order) {
      const state = this.getState();
      state.orders.push(order);
      this.saveState(state);
      return order;
    },
    updateScheduledOrder(orderId, changes) {
      const state = this.getState();
      const order = state.orders.find((entry) => entry.id === orderId);
      if (!order) {
        return null;
      }
      Object.assign(order, changes, { updatedAt: new Date().toISOString() });
      this.saveState(state);
      return order;
    },
    createOrderEventLog(event) {
      const state = this.getState();
      state.orderEvents.push(event);
      this.saveState(state);
      return event;
    },
    listOrderEventLogs(orderId) {
      return (this.getState().orderEvents || []).filter((entry) => entry.orderId === orderId);
    },
    createPaymentConsent(consent) {
      const state = this.getState();
      state.paymentConsents.push(consent);
      this.saveState(state);
      return consent;
    },
    revokePaymentConsent(consentId) {
      const state = this.getState();
      const consent = state.paymentConsents.find((entry) => entry.id === consentId);
      if (!consent) {
        return null;
      }
      consent.active = false;
      consent.consentedAt = new Date().toISOString();
      this.saveState(state);
      return consent;
    },
    listFloristPartners() {
      return this.getState().floristPartners || [];
    },
    createFloristPartner(floristPartner) {
      const state = this.getState();
      state.floristPartners.push(floristPartner);
      this.saveState(state);
      return floristPartner;
    },
    updateFloristPartner(floristPartnerId, changes) {
      const state = this.getState();
      const floristPartner = state.floristPartners.find((entry) => entry.id === floristPartnerId);
      if (!floristPartner) {
        return null;
      }
      Object.assign(floristPartner, changes, { updatedAt: new Date().toISOString() });
      this.saveState(state);
      return floristPartner;
    },
    listServiceZones() {
      return this.getState().serviceZones || [];
    },
  };
}

const jsonStorageAdapter = createJsonStorageAdapter();

module.exports = {
  createJsonStorageAdapter,
  jsonStorageAdapter,
  writeSeedData,
  resetData,
  readStateFromDisk,
  writeStateToDisk,
};
