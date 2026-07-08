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
      .status { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #eef7f0; color: #2d6a3b; font-size: 0.85rem; }
      @media (max-width: 720px) { .hero, .grid.two, .grid.three { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="page">
      <nav class="nav">
        <a href="/">Home</a>
        <a href="/dashboard">Dashboard</a>
        <a href="/recipients/new">Add recipient</a>
        <a href="/milestones/new">Add milestone</a>
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
