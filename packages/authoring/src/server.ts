// The stage-authoring tool's local server: Vite serves the tool's pages, and
// three endpoints read and write the one content directory it was started on.
// Curator-only; it listens on localhost and is never deployed.
//   GET  /authoring/content       the Guess Vocabulary and what is already authored
//   GET  /authoring/model?noun=…  that noun's model file
//   POST /authoring/save          an authored object and its rendered assets (base64)
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { readAuthoringContent, saveAuthoredObject, type AuthoredObject } from './content-store.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

export interface SaveRequest {
  object: AuthoredObject;
  /** Base64 of the Reveal Stage 1-5 images. */
  images: string[];
  /** Base64 of the Reveal Stage 6 model. */
  model: string;
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(response: ServerResponse, status: number, value: unknown, type = 'application/json') {
  response.statusCode = status;
  response.setHeader('content-type', type);
  response.end(type === 'application/json' ? JSON.stringify(value) : (value as Buffer));
}

function contentEndpoints(contentDir: string): Plugin {
  return {
    name: 'objectle-authoring-content',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        try {
          if (request.method === 'GET' && url.pathname === '/authoring/content') {
            return send(response, 200, await readAuthoringContent(contentDir));
          }
          if (request.method === 'GET' && url.pathname === '/authoring/model') {
            const { guessVocabulary } = await readAuthoringContent(contentDir);
            const entry = guessVocabulary.find(({ name }) => name === url.searchParams.get('noun'));
            if (entry === undefined) return send(response, 404, { error: 'not a Guess Vocabulary noun' });
            // Only paths the Guess Vocabulary names, so nothing outside the content directory is served.
            return send(response, 200, await readFile(join(contentDir, entry.model)), 'model/gltf-binary');
          }
          if (request.method === 'POST' && url.pathname === '/authoring/save') {
            const { object, images, model } = JSON.parse(await body(request)) as SaveRequest;
            const problems = await saveAuthoredObject(contentDir, object, {
              images: images.map((image) => Buffer.from(image, 'base64')),
              model: Buffer.from(model, 'base64'),
            });
            return send(response, 200, { problems });
          }
        } catch (error) {
          return send(response, 500, { error: (error as Error).message });
        }
        next();
      });
    },
  };
}

/** Start the tool on `contentDir`; `port` 0 picks a free one. */
export async function startAuthoringServer(contentDir: string, port = 5174): Promise<{ url: string; server: ViteDevServer }> {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    clearScreen: false,
    plugins: [contentEndpoints(contentDir)],
    server: { host: 'localhost', port, strictPort: port !== 0 },
    // Pre-bundling would reload the page part-way through a headless render; every dependency is ESM already.
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const address = server.httpServer!.address();
  const actual = typeof address === 'object' && address !== null ? address.port : port;
  return { url: `http://localhost:${actual}/`, server };
}
