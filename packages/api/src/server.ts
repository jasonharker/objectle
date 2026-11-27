import { buildApp, buildMetricsApp, loadContent } from './app.ts';
import { loadConfig } from './config.ts';
import { postgresResultCounters } from './postgres-result-counters.ts';
import { puzzleNumberAt } from './puzzle-clock.ts';

const config = loadConfig(process.env);
const resultCounters = await postgresResultCounters(config.databaseUrl);
const clock = () => new Date();
const content = await loadContent(config.contentDir, {
  activePuzzleNumber: puzzleNumberAt(new Date(), config.launchDate),
});
const app = buildApp({
  clock,
  launchDate: config.launchDate,
  content,
  signingKey: config.signingKey,
  resultCounters,
  clientDir: config.clientDir,
  logger: true,
});
const metrics = buildMetricsApp({ clock, launchDate: config.launchDate, content });

app.addHook('onClose', () => resultCounters.close());
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void Promise.all([app.close(), metrics.close()]));
await metrics.listen({ host: '0.0.0.0', port: config.metricsPort });
await app.listen({ host: '0.0.0.0', port: config.port });
