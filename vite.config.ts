/// <reference types="vitest/config" />
/// <reference types="node" />
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createBookingAgentHandler } from './server/bookingAgent';

/** Serves the booking assistant at /api/booking-agent in `vite` and `vite preview`. */
function bookingAgentApi(env: Record<string, string>): Plugin {
  const handle = createBookingAgentHandler({
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
    dataApiUrl: env.VITE_NEON_DATA_API_URL ?? '',
  });

  const middleware: Connect.NextHandleFunction = async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
      }
      const response = await handle(
        new Request(`http://localhost${req.originalUrl ?? req.url ?? ''}`, {
          method: req.method,
          headers,
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        }),
      );
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await response.text());
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end();
    }
  };

  return {
    name: 'booking-agent-api',
    configureServer(server) {
      server.middlewares.use('/api/booking-agent', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/booking-agent', middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' prefix: load ANTHROPIC_API_KEY too. It stays server-side; only VITE_* reach the browser.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), bookingAgentApi(env)],
    server: { port: 5173 },
    test: { environment: 'jsdom' },
  };
});
