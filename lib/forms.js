function renderFormError(errors) {
  return `<section class="card"><h3>We need a few details before we can save this yet.</h3>${errors.map((error) => `<p class="muted">${error}</p>`).join('')}</section>`;
}

module.exports = {
  renderFormError,
};
