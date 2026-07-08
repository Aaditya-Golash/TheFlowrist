const http = require('http');
require('dotenv').config();
const { createRouter } = require('./lib/routes');

const port = Number(process.env.PORT || 3000);
const env = process.env.NODE_ENV || 'development';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

function createApp() {
  const router = createRouter();
  return http.createServer((req, res) => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=()');

    router(req, res);
  });
}

if (require.main === module) {
  const { validateProductionEnvironment } = require('./lib/env-check');
  const productionCheck = validateProductionEnvironment(process.env);
  if (!productionCheck.ok) {
    console.error('Refusing to start: NODE_ENV=production is missing required configuration.');
    productionCheck.errors.forEach((message) => console.error(`- ${message}`));
    process.exit(1);
  }

  const server = createApp();
  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

module.exports = createApp();
