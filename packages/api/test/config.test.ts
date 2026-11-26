import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.ts';

const env = {
  OBJECTLE_SIGNING_KEY: 'a-signing-key-from-the-secret-store',
  OBJECTLE_LAUNCH_DATE: '2027-03-01',
  OBJECTLE_CONTENT_DIR: '/content',
};

describe('Configuration', () => {
  test('takes the signing key and Launch Date from the environment', () => {
    const config = loadConfig(env);
    expect(config.signingKey).toBe(env.OBJECTLE_SIGNING_KEY);
    expect(config.launchDate).toBe('2027-03-01');
    expect(config.contentDir).toBe('/content');
  });

  test('refuses to start without a signing key', () => {
    const { OBJECTLE_SIGNING_KEY: _, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow(/OBJECTLE_SIGNING_KEY/);
  });

  test('refuses a signing key shorter than 32 characters', () => {
    expect(() => loadConfig({ ...env, OBJECTLE_SIGNING_KEY: 'short' })).toThrow(/OBJECTLE_SIGNING_KEY/);
  });

  test('refuses to start without a valid Launch Date', () => {
    const { OBJECTLE_LAUNCH_DATE: _, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow(/OBJECTLE_LAUNCH_DATE/);
    expect(() => loadConfig({ ...env, OBJECTLE_LAUNCH_DATE: '1 March 2027' })).toThrow(/OBJECTLE_LAUNCH_DATE/);
  });

  test.each(['2027-02-30', '2027-02-29', '2027-13-01', '2027-04-31', '2027-00-10'])(
    'refuses a Launch Date that is not a calendar date (%s)',
    (launchDate) => {
      expect(() => loadConfig({ ...env, OBJECTLE_LAUNCH_DATE: launchDate })).toThrow(/OBJECTLE_LAUNCH_DATE/);
    },
  );

  test('accepts a leap day as the Launch Date', () => {
    expect(loadConfig({ ...env, OBJECTLE_LAUNCH_DATE: '2028-02-29' }).launchDate).toBe('2028-02-29');
  });

  test('refuses to start without a content directory', () => {
    const { OBJECTLE_CONTENT_DIR: _, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow(/OBJECTLE_CONTENT_DIR/);
  });

  test('listens on PORT, 8080 by default, and serves the client from OBJECTLE_CLIENT_DIR if set', () => {
    expect(loadConfig(env)).toMatchObject({ port: 8080, clientDir: undefined });
    expect(loadConfig({ ...env, PORT: '3000', OBJECTLE_CLIENT_DIR: '/client' })).toMatchObject({
      port: 3000,
      clientDir: '/client',
    });
  });

  test.each(['', ' ', '8080.5', '80a', '0x50', '-1', '0', '65536', '1e3'])('refuses a PORT that is not a TCP port (%j)', (port) => {
    expect(() => loadConfig({ ...env, PORT: port })).toThrow(/PORT/);
  });

  test('resolves a relative client directory against the working directory', () => {
    expect(loadConfig({ ...env, OBJECTLE_CLIENT_DIR: 'packages/client/dist' }).clientDir).toBe(
      resolve('packages/client/dist'),
    );
  });
});
