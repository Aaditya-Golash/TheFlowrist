const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
require('dotenv').config();
const { createRouter } = require('./lib/routes');

const port = Number(process.env.PORT || 3000);
const env = process.env.NODE_ENV || 'development';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

const STATIC_ROOT = path.join(__dirname, 'public');
const STATIC_CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Only ever serves files that resolve inside STATIC_ROOT, under /public/,
// read-only, GET-only — a minimal safe static file handler for the design
// system CSS, not a general-purpose file server.
function tryServeStatic(req, res) {
  if (req.method !== 'GET') {
    return false;
  }
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!requestUrl.pathname.startsWith('/public/')) {
    return false;
  }
  const relativePath = requestUrl.pathname.slice('/public/'.length);
  const resolvedPath = path.normalize(path.join(STATIC_ROOT, relativePath));
  if (resolvedPath !== STATIC_ROOT && !resolvedPath.startsWith(STATIC_ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    return false;
  }
  const ext = path.extname(resolvedPath).toLowerCase();
  const contentType = STATIC_CONTENT_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });
  res.end(fs.readFileSync(resolvedPath));
  return true;
}

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

    if (tryServeStatic(req, res)) {
      return;
    }

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
