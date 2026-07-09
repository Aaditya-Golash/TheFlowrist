const { formatMoney } = require('./pricing');

function buildReminderEmail({ order, milestone, recipient, customer, baseUrl }) {
  const occasion = milestone?.occasionLabel || milestone?.occasionType || 'their milestone';
  const recipientName = recipient?.name || 'your recipient';
  const tierName = String(order.budgetTier || 'classic').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const amount = formatMoney(order.estimatedCustomerPriceCents);
  const dashboardUrl = `${baseUrl}/dashboard`;
  const subject = `Reminder: your ${tierName} flowers for ${recipientName} will be charged soon`;
  const text = [
    `Hi ${customer?.name || 'there'},`,
    '',
    `This is a reminder that we're preparing ${occasion} flowers for ${recipientName}.`,
    `Tier: ${tierName}`,
    `Amount: ${amount}`,
    `Planned charge date: ${order.plannedChargeDate}`,
    '',
    `If everything looks right, you don't need to do anything.`,
    `To pause or cancel before the charge, visit: ${dashboardUrl}`,
    '',
    '— TheFlowerist',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtmlBasic(customer?.name || 'there')},</p>
    <p>This is a reminder that we're preparing <strong>${escapeHtmlBasic(occasion)}</strong> flowers for <strong>${escapeHtmlBasic(recipientName)}</strong>.</p>
    <ul>
      <li>Tier: ${escapeHtmlBasic(tierName)}</li>
      <li>Amount: ${escapeHtmlBasic(amount)}</li>
      <li>Planned charge date: ${escapeHtmlBasic(order.plannedChargeDate)}</li>
    </ul>
    <p>If everything looks right, you don't need to do anything.</p>
    <p><a href="${dashboardUrl}">Pause or cancel before the charge</a></p>
    <p>&mdash; TheFlowerist</p>`;
  return { subject, text, html };
}

function escapeHtmlBasic(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendReminderEmail({ to, subject, html, text }, env = process.env, { fetchImpl = fetch } = {}) {
  const apiKey = env.RESEND_API_KEY || '';
  if (!apiKey) {
    throw new Error('Reminder email requires RESEND_API_KEY');
  }
  const fromAddress = env.REMINDER_FROM_EMAIL || 'reminders@theflowerist.example';
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from: fromAddress, to, subject, html, text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend API error (${response.status}): ${body || 'no response body'}`);
  }
  return response.json();
}

module.exports = {
  buildReminderEmail,
  sendReminderEmail,
};
