const path = require('path');

process.env.STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'json';
process.env.AUTH_BACKEND = process.env.AUTH_BACKEND || 'pilot';
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'admin@example.com';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const port = Number(process.env.PORT || 3000);
const app = require(path.join(__dirname, '..', 'server.js'));
app.listen(port, () => {
  console.log(`Preview server listening on port ${port}`);
});
