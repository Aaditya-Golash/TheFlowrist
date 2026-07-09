const { resolveAuthBackend } = require('./auth');
const { getSupabaseConfig, getSupabaseAuthConfig } = require('./supabase-env');

function isProductionEnv(env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production';
}

function checkStorageBackend(env) {
  const backend = String(env.STORAGE_BACKEND || 'json').toLowerCase();
  if (backend !== 'json' && backend !== 'supabase') {
    return { ok: false, backend, error: `Unsupported STORAGE_BACKEND: ${backend}` };
  }
  return { ok: true, backend };
}

function checkAuthBackend(env) {
  try {
    const backend = resolveAuthBackend(env);
    return { ok: true, backend };
  } catch (error) {
    return { ok: false, backend: String(env.AUTH_BACKEND || ''), error: error.message };
  }
}

function checkSupabaseStorageEnv(env, storageBackend) {
  if (storageBackend !== 'supabase') {
    return { ok: true, required: false };
  }
  const { hasRequiredConfig } = getSupabaseConfig(env);
  return {
    ok: hasRequiredConfig,
    required: true,
    error: hasRequiredConfig ? undefined : 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY fallback)',
  };
}

function checkSupabaseAuthEnv(env, authBackend) {
  if (authBackend !== 'supabase') {
    return { ok: true, required: false };
  }
  const { hasRequiredConfig } = getSupabaseAuthConfig(env);
  return {
    ok: hasRequiredConfig,
    required: true,
    error: hasRequiredConfig ? undefined : 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
  };
}

function checkRequiredInProduction(env, key) {
  const production = isProductionEnv(env);
  const present = Boolean(env[key]);
  return { ok: !production || present, requiredInProduction: production, present };
}

function checkStripeEnv(env) {
  const production = isProductionEnv(env);
  const present = Boolean(env.STRIPE_SECRET_KEY);
  return {
    ok: !production || present,
    requiredInProduction: production,
    present,
    error: production && !present ? 'STRIPE_SECRET_KEY is required in production for real payment capture' : undefined,
  };
}

function buildReadiness(env = process.env) {
  const storage = checkStorageBackend(env);
  const auth = checkAuthBackend(env);
  const checks = {
    storageBackend: storage,
    authBackend: auth,
    supabaseStorageEnv: checkSupabaseStorageEnv(env, storage.backend),
    supabaseAuthEnv: checkSupabaseAuthEnv(env, auth.backend),
    internalApiSecret: checkRequiredInProduction(env, 'INTERNAL_API_SECRET'),
    adminEmails: checkRequiredInProduction(env, 'ADMIN_EMAILS'),
    stripeEnv: checkStripeEnv(env),
  };
  const ready = Object.values(checks).every((check) => check.ok);
  return { ready, environment: env.NODE_ENV || 'development', checks };
}

function validateProductionEnvironment(env = process.env) {
  if (!isProductionEnv(env)) {
    return { ok: true, errors: [] };
  }

  const errors = [];
  ['STORAGE_BACKEND', 'AUTH_BACKEND', 'INTERNAL_API_SECRET', 'ADMIN_EMAILS', 'STRIPE_SECRET_KEY'].forEach((key) => {
    if (!env[key]) {
      errors.push(`${key} is required when NODE_ENV=production`);
    }
  });

  const storageBackend = String(env.STORAGE_BACKEND || '').toLowerCase();
  if (storageBackend === 'supabase') {
    const { hasRequiredConfig } = getSupabaseConfig(env);
    if (!hasRequiredConfig) {
      errors.push('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY fallback) are required when STORAGE_BACKEND=supabase in production');
    }
  }

  const authBackend = String(env.AUTH_BACKEND || '').toLowerCase();
  if (authBackend === 'supabase') {
    const { hasRequiredConfig: hasAuthConfig } = getSupabaseAuthConfig(env);
    if (!hasAuthConfig) {
      errors.push('SUPABASE_URL and SUPABASE_ANON_KEY are required when AUTH_BACKEND=supabase in production');
    }
    const { hasRequiredConfig: hasServiceRole } = getSupabaseConfig(env);
    if (!hasServiceRole) {
      errors.push('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY fallback) is required when AUTH_BACKEND=supabase in production');
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  buildReadiness,
  validateProductionEnvironment,
};
