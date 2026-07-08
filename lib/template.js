function renderHtml(title, body, state = {}) {
  const escapedTitle = String(title).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/public/styles.css" />
  </head>
  <body>
    <div class="page-shell">
      <header class="site-header">
        <a class="brand-mark" href="/">TheFlowerist</a>
        <nav class="nav-links">
          <a href="/dashboard">Dashboard</a>
          <a href="/milestones/new">Add date</a>
          <a href="/account">Account</a>
          <a href="/admin">Admin</a>
          <form action="/logout" method="post"><button class="link-button" type="submit">Logout</button></form>
        </nav>
      </header>
      <main>
        ${body}
      </main>
      <p class="pilot-notice">TheFlowerist. Toronto private pilot. Concierge fulfilled, never automated.</p>
    </div>
  </body>
</html>`;
}

module.exports = {
  renderHtml,
};
