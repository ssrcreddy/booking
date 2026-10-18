/// <reference types="node" />
// Vercel Function: serves the booking assistant at /api/booking-agent in production.
// Locally the same handler is mounted by the Vite plugin in vite.config.ts.
// Relative imports carry .js extensions because Vercel runs this file as Node ESM.
import { bookingAgentHandlerFromEnv } from '../server/bookingAgent.js';

const handle = bookingAgentHandlerFromEnv(process.env);

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
