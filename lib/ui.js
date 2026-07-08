function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStatusLabel(status) {
  return String(status || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusBadge(status) {
  return `<span class="badge status-${escapeHtml(status)}">${escapeHtml(formatStatusLabel(status))}</span>`;
}

function card({ eyebrow = '', title = '', body = '', actions = '' } = {}) {
  return `
    <div class="card">
      ${eyebrow ? `<div class="hero-kicker">${escapeHtml(eyebrow)}</div>` : ''}
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      ${body}
      ${actions}
    </div>`;
}

function trustNote({ title, body }) {
  return `
    <div class="trust-note">
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(body)}</p>
    </div>`;
}

function fieldHint(text) {
  return `<span class="field-hint">${escapeHtml(text)}</span>`;
}

function tierCard({ name, price, description, meta = '' }) {
  return `
    <div class="tier-card">
      <h3>${escapeHtml(name)}</h3>
      <p class="price">From ${escapeHtml(price)}</p>
      <p>${escapeHtml(description)}</p>
      ${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}
    </div>`;
}

function emptyState({ title, body, actionHtml = '' }) {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(body)}</p>
      ${actionHtml}
    </div>`;
}

function notice(kind, text) {
  const className = kind === 'error' ? 'notice-error' : 'notice-success';
  return `<div class="notice ${className}">${escapeHtml(text)}</div>`;
}

module.exports = {
  escapeHtml,
  formatStatusLabel,
  statusBadge,
  card,
  trustNote,
  fieldHint,
  tierCard,
  emptyState,
  notice,
};
