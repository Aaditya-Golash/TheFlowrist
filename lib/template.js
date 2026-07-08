const fs = require('fs');
const path = require('path');

function renderHtml(title, body, state = {}) {
  const escapedTitle = String(title).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedBody = body;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: Inter, Arial, sans-serif; margin: 0; background: #f7f4ef; color: #20312a; }
      a { color: #6f4b2f; }
      .page { max-width: 1120px; margin: 0 auto; padding: 24px; }
      .card { background: white; border-radius: 18px; padding: 24px; box-shadow: 0 10px 30px rgba(35, 40, 40, 0.06); margin-bottom: 20px; }
      .hero { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 24px; align-items: center; }
      .pill { display: inline-block; padding: 6px 12px; border-radius: 999px; background: #f4e6d8; color: #7b4b2a; font-size: 0.85rem; margin-bottom: 12px; }
      .btn { display: inline-block; padding: 10px 16px; border-radius: 999px; background: #20312a; color: white; text-decoration: none; margin-right: 8px; margin-top: 8px; }
      .btn.secondary { background: #f4e6d8; color: #7b4b2a; }
      .grid { display: grid; gap: 16px; }
      .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .muted { color: #6f7a74; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 10px 8px; border-bottom: 1px solid #ece7df; text-align: left; }
      form { display: grid; gap: 12px; }
      label { display: grid; gap: 6px; font-weight: 600; }
      input, select, textarea { padding: 10px; border: 1px solid #d8d0c6; border-radius: 10px; font: inherit; }
      .nav { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
      .nav a { text-decoration: none; }
      .status { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #eef7f0; color: #2d6a3b; font-size: 0.85rem; font-weight: 600; }
      .status-scheduled { background: #eef2ff; color: #3849b3; }
      .status-pending_charge, .status-pre_charge_reminder_sent { background: #fff6e6; color: #92660a; }
      .status-charged, .status-sent_to_florist, .status-florist_accepted, .status-preparing, .status-out_for_delivery { background: #eef7f0; color: #2d6a3b; }
      .status-delivered { background: #e7f6ee; color: #1f7a4d; }
      .status-issue_reported, .status-refunded { background: #fdecea; color: #b3261e; }
      .status-cancelled, .status-paused { background: #f1efe9; color: #6f7a74; }
      .section-lead { color: #6f7a74; margin-top: 4px; }
      .helper { display: block; font-weight: 400; color: #6f7a74; font-size: 0.85rem; margin-top: 4px; }
      .reassurance { background: #eef7f0; border: 1px solid #d5ebd9; border-radius: 14px; padding: 16px 18px; margin-bottom: 20px; }
      .reassurance h4 { margin: 0 0 8px; color: #1f4d30; }
      .reassurance ul { margin: 0; padding-left: 18px; }
      .reassurance li { color: #2d6a3b; font-weight: 600; margin-bottom: 6px; }
      .reassurance li:last-child { margin-bottom: 0; }
      .trust-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .trust-item { background: #fbf8f3; border: 1px solid #ece7df; border-radius: 14px; padding: 16px 18px; }
      .trust-item h4 { margin: 0 0 6px; font-size: 1rem; }
      .trust-item p { margin: 0; color: #6f7a74; font-size: 0.92rem; }
      .steps { display: grid; gap: 18px; counter-reset: step; padding: 0; margin: 0; list-style: none; }
      .steps li { display: flex; gap: 14px; align-items: flex-start; }
      .steps li::before { counter-increment: step; content: counter(step); flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%; background: #20312a; color: white; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 700; }
      .steps strong { display: block; margin-bottom: 2px; }
      .steps span { color: #6f7a74; font-size: 0.92rem; }
      .tier-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
      .tier-card { border: 1px solid #ece7df; border-radius: 16px; padding: 20px; text-align: center; }
      .tier-card h3 { margin: 0 0 4px; }
      .tier-card .price { font-size: 1.35rem; font-weight: 700; color: #20312a; margin: 6px 0; }
      .tier-card p { color: #6f7a74; font-size: 0.9rem; margin: 0; }
      .faq details { border-bottom: 1px solid #ece7df; padding: 14px 0; }
      .faq details:last-child { border-bottom: none; }
      .faq summary { cursor: pointer; font-weight: 600; }
      .faq summary::marker { color: #7b4b2a; }
      .faq p { color: #6f7a74; margin: 8px 0 0; }
      .stat-card .stat-number { font-size: 2rem; font-weight: 700; margin: 4px 0 0; }
      .milestone-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 14px 0; border-bottom: 1px solid #ece7df; flex-wrap: wrap; }
      .milestone-row:last-child { border-bottom: none; }
      .milestone-meta p { margin: 2px 0; font-size: 0.88rem; color: #6f7a74; }
      .milestone-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .milestone-actions form { display: inline-block; margin: 0; }
      .milestone-actions button { padding: 6px 12px; font-size: 0.82rem; }
      .summary-list { display: grid; gap: 8px; margin-bottom: 20px; }
      .summary-list p { margin: 0; }
      @media (max-width: 720px) { .hero, .grid.two, .grid.three { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="page">
      <nav class="nav">
        <a href="/">Home</a>
        <a href="/dashboard">Dashboard</a>
        <a href="/account">Account</a>
        <a href="/admin">Admin</a>
      </nav>
      ${escapedBody}
    </div>
  </body>
</html>`;
}

module.exports = {
  renderHtml,
};
