const { isValidCanadianPostalCode, normalizePostalCode, isFutureDate, isValidBudgetTier } = require('./logic');

function validateRecipient(values) {
  const errors = [];
  if (!values.name) {
    errors.push('Please add the recipient name.');
  }
  if (!values.relationship) {
    errors.push('Please add the relationship.');
  }
  if (!values.addressLine1) {
    errors.push('Please add the delivery address.');
  }
  if (!values.city) {
    errors.push('Please add the city.');
  }
  if (!values.province) {
    errors.push('Please add the province.');
  }
  if (!isValidCanadianPostalCode(values.postalCode)) {
    errors.push('Please use a valid Canadian postal code such as M5V 2T6.');
  }
  return { errors, normalized: { ...values, postalCode: normalizePostalCode(values.postalCode) } };
}

function validateMilestone(values) {
  const errors = [];
  if (!values.recipientId) {
    errors.push('Please select a recipient.');
  }
  if (!values.eventDate) {
    errors.push('Please add an event date.');
  } else if (!isFutureDate(values.eventDate)) {
    errors.push('Please choose a date in the future for a new protected date.');
  }
  if (!isValidBudgetTier(values.budgetTier)) {
    errors.push('Please choose a valid budget tier.');
  }
  return { errors };
}

module.exports = {
  validateRecipient,
  validateMilestone,
};
