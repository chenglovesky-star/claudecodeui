// server/config/validateConfig.js
// Startup configuration validation

const warnings = [];
const errors = [];

export function validateConfig() {
  // Required in production
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) {
      errors.push('JWT_SECRET must be set in production');
    }
  }

  // Warnings for development
  if (!process.env.JWT_SECRET) {
    warnings.push('JWT_SECRET not set, using insecure default');
  }

  if (!process.env.WORKSPACES_ROOT) {
    warnings.push('WORKSPACES_ROOT not set, defaulting to home directory');
  }

  if (!process.env.DATABASE_PATH) {
    warnings.push('DATABASE_PATH not set, using default location');
  }

  // Print results
  if (warnings.length > 0) {
    console.warn('[Config] Warnings:');
    warnings.forEach(w => console.warn(`  - ${w}`));
  }

  if (errors.length > 0) {
    console.error('[Config] FATAL configuration errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log('[Config] Configuration validated');
}
