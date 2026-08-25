import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

// Loads apps/api/.env (if present) into process.env. Safe to call more than
// once; a no-op in production where real env vars are set directly (Docker,
// systemd, etc). Runs at import time so it's in effect before loadConfig().
// quiet: dotenv 17 otherwise prints a banner to stdout on every start, which
// is noise in the app's own (JSON) logs.
loadDotenv({ quiet: true });

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  appUrl: string;
  trackingSecret: string;
  webDist: string | null;
  bodyLimitBytes: number;
  version: string;
  sourceUrl: string;
  trustProxy: boolean | number | string;
}

const DEV_JWT_SECRET = "dev-insecure-secret-change-me";
const DEV_TRACKING_SECRET = "dev-insecure-tracking-secret";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// A production instance running on the built-in dev secrets is not merely
// untidy: anyone who has read this (open source) repo can forge an admin JWT
// or a valid unsubscribe signature. Refuse to start rather than come up
// silently insecure.
function requireSecret(name: string, devDefault: string): string {
  const value = process.env[name];
  if (!isProduction()) return value ?? devDefault;
  if (!value || value === devDefault) {
    throw new Error(
      `${name} must be set to a unique random value when NODE_ENV=production. ` +
        `Generate one with: openssl rand -hex 32`,
    );
  }
  return value;
}

// The admin UI is served by this process when a built copy of apps/web is
// present (the Docker image and the build-from-source install both put one
// there). In development the Vite dev server serves it instead, so an absent
// directory is not an error.
function resolveWebDist(): string | null {
  const configured = process.env.WEB_DIST;
  const candidate = configured
    ? path.resolve(configured)
    : path.resolve(fileURLToPath(import.meta.url), "../../../web/dist");
  if (existsSync(path.join(candidate, "index.html"))) return candidate;
  if (configured) {
    throw new Error(`WEB_DIST is set to ${candidate}, but no index.html exists there`);
  }
  return null;
}

// Fastify accepts a boolean, a hop count, or a comma-separated list of
// trusted addresses/CIDRs. Behind Dokploy/Traefik, Caddy or nginx this must be
// on, or every request looks like it came from the proxy.
function resolveTrustProxy(): boolean | number | string {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === "") return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export function loadConfig(): Config {
  const appUrl = isProduction()
    ? requireEnv("APP_URL")
    : requireEnv("APP_URL", "http://localhost:3000");

  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "0.0.0.0",
    databaseUrl: requireEnv("DATABASE_URL", "postgres://dripline:dripline@localhost:5432/dripline"),
    jwtSecret: requireSecret("JWT_SECRET", DEV_JWT_SECRET),
    appUrl,
    trackingSecret: requireSecret("TRACKING_SECRET", DEV_TRACKING_SECRET),
    webDist: resolveWebDist(),
    // CSV imports arrive as one JSON array of subscribers, which outgrows
    // Fastify's 1 MiB default at a few thousand rows. Any reverse proxy in
    // front needs a matching limit (see deploy/nginx.conf.example).
    bodyLimitBytes: Number(process.env.BODY_LIMIT_MB ?? 8) * 1024 * 1024,
    version: process.env.APP_VERSION ?? "dev",
    // AGPL-3.0 section 13: users interacting with this instance over a
    // network must be offered its corresponding source. An install running
    // modified code has to point this at where that source is published.
    sourceUrl: process.env.SOURCE_URL ?? "https://github.com/mh-rafi/Dripline",
    trustProxy: resolveTrustProxy(),
  };
}
