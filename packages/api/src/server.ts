import { buildApp, loadContent } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig(process.env);
const app = buildApp({
  clock: () => new Date(),
  launchDate: config.launchDate,
  content: await loadContent(config.contentDir),
  signingKey: config.signingKey,
  clientDir: config.clientDir,
  logger: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close());
await app.listen({ host: '0.0.0.0', port: config.port });
