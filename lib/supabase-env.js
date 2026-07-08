function getSupabaseConfig(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '';
  return {
    supabaseUrl,
    serviceRoleKey,
    hasRequiredConfig: Boolean(supabaseUrl && serviceRoleKey),
  };
}

function validateSupabaseEnvironment(env = process.env) {
  const { supabaseUrl, serviceRoleKey, hasRequiredConfig } = getSupabaseConfig(env);
  if (!hasRequiredConfig) {
    throw new Error('Supabase storage backend requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY fallback)');
  }
  return { supabaseUrl, serviceRoleKey };
}

module.exports = {
  getSupabaseConfig,
  validateSupabaseEnvironment,
};
