import { buildApp, loadContent } from './app.ts';
import { loadConfig } from './config.ts';
import { postgresResultCounters } from './postgres-result-counters.ts';

const config = loadConfig(process.env);
const resultCounters = await postgresResultCounters(config.databaseUrl);
const app = buildApp({
  clock: () => new Date(),
  launchDate: config.launchDate,
  content: await loadContent(config.contentDir),
  signingKey: config.signingKey,
  resultCounters,
  clientDir: config.clientDir,
  logger: true,
});

app.addHook('onClose', () => resultCounters.close());
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close());
await app.listen({ host: '0.0.0.0', port: config.port });
