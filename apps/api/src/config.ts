import { config as loadDotenv } from "dotenv";

// Loads apps/api/.env (if present) into process.env. Safe to call more than
// once; a no-op in production where real env vars are set directly (Docker,
// systemd, etc). Runs at import time so it's in effect before loadConfig().
// quiet: dotenv 17 otherwise prints a banner to stdout on every start, which
// is noise in the app's own (JSON) logs.
loadDotenv({ quiet: true });

export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  appUrl: string;
  trackingSecret: string;
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: requireEnv("DATABASE_URL", "postgres://dripline:dripline@localhost:5432/dripline"),
    jwtSecret: requireEnv("JWT_SECRET", "dev-insecure-secret-change-me"),
    appUrl: requireEnv("APP_URL", "http://localhost:3000"),
    trackingSecret: requireEnv("TRACKING_SECRET", "dev-insecure-tracking-secret"),
  };
}
