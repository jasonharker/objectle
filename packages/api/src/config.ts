export interface Config {
  signingKey: string;
  launchDate: string;
  contentDir: string;
  clientDir: string | undefined;
  port: number;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

/** Read the API's configuration from the environment; the signing key is a secret, never a default. */
export function loadConfig(env: Env): Config {
  const signingKey = required(env, 'OBJECTLE_SIGNING_KEY');
  if (signingKey.length < 32) throw new Error('OBJECTLE_SIGNING_KEY must be at least 32 characters');

  const launchDate = required(env, 'OBJECTLE_LAUNCH_DATE');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(launchDate) || Number.isNaN(Date.parse(launchDate))) {
    throw new Error('OBJECTLE_LAUNCH_DATE must be a YYYY-MM-DD Pacific date');
  }

  return {
    signingKey,
    launchDate,
    contentDir: required(env, 'OBJECTLE_CONTENT_DIR'),
    clientDir: env.OBJECTLE_CLIENT_DIR || undefined,
    port: Number(env.PORT ?? 8080),
  };
}
