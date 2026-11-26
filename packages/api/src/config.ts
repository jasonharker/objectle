import { resolve } from 'node:path';

export interface Config {
  signingKey: string;
  launchDate: string;
  contentDir: string;
  /** Postgres connection string for the Result counters, which every replica shares. */
  databaseUrl: string;
  clientDir: string | undefined;
  port: number;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

/** A YYYY-MM-DD date that exists: it survives a round trip through Date, which rolls 02-30 over to 03-02. */
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Read the API's configuration from the environment; the signing key is a
 * secret, never a default. OBJECTLE_DATABASE_URL (a postgres:// connection
 * string, carrying a credential) is required: Result counters kept in memory
 * would differ per replica.
 */
export function loadConfig(env: Env): Config {
  const signingKey = required(env, 'OBJECTLE_SIGNING_KEY');
  if (signingKey.length < 32) throw new Error('OBJECTLE_SIGNING_KEY must be at least 32 characters');

  const launchDate = required(env, 'OBJECTLE_LAUNCH_DATE');
  if (!isCalendarDate(launchDate)) throw new Error('OBJECTLE_LAUNCH_DATE must be a YYYY-MM-DD Pacific date');

  const port = env.PORT ?? '8080';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PORT must be a TCP port number, 1-65535');
  }

  return {
    signingKey,
    launchDate,
    contentDir: required(env, 'OBJECTLE_CONTENT_DIR'),
    databaseUrl: required(env, 'OBJECTLE_DATABASE_URL'),
    clientDir: env.OBJECTLE_CLIENT_DIR ? resolve(env.OBJECTLE_CLIENT_DIR) : undefined,
    port: Number(port),
  };
}
