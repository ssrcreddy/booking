import { BOOKING_ASSISTANT_ENABLED } from '../src/config.js';
import type { AgentProvider } from './agentProvider.js';
import { clubNow, createDataApi, createToolRunner, HttpError, ToolError } from './bookingTools.js';
import { createClaudeProvider } from './providers/claude.js';

/**
 * HTTP endpoint for the chat booking assistant. Runs server-side because it
 * holds the AI provider's API key; the model loop itself lives in
 * server/providers/, and the tools in bookingTools.ts.
 */

export interface BookingAgentConfig {
  dataApiUrl: string;
  /** null when the provider's API key is missing. */
  provider: AgentProvider | null;
}

export interface AgentReply {
  reply: string;
  /** Full transcript to send back next turn (opaque to the browser). */
  history: unknown;
  booked: boolean;
}

const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY_BYTES = 400_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST { history, message } with `Authorization: Bearer <Neon Auth JWT>`.
 * Web-standard Request/Response, so it can run in the Vite dev server or any
 * serverless runtime.
 */
export function createBookingAgentHandler(config: BookingAgentConfig) {
  const { provider } = config;

  return async function handle(request: Request): Promise<Response> {
    if (!BOOKING_ASSISTANT_ENABLED) return json(403, { error: 'The booking assistant is turned off.' });
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    if (!provider || !config.dataApiUrl) {
      return json(500, { error: "The booking assistant isn't configured." });
    }

    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return json(401, { error: 'Please sign in again.' });

    const raw = await request.text();
    if (raw.length > MAX_HISTORY_BYTES) return json(413, { error: 'This conversation is too long. Reload to start a new one.' });
    let body: { history?: unknown; message?: unknown };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return json(400, { error: 'Invalid request.' });
    }
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const history = provider.parseHistory(body.history ?? []);
    if (!message || message.length > MAX_MESSAGE_CHARS || history === null) {
      return json(400, { error: 'Invalid request.' });
    }

    const api = createDataApi(config.dataApiUrl, token);
    try {
      // Check the token with Neon before spending anything on the model.
      await api('bookings?select=id&limit=1');
    } catch (err) {
      if (err instanceof HttpError || err instanceof ToolError) return json(401, { error: 'Please sign in again.' });
      console.error('Data API check failed', err);
      return json(502, { error: 'Could not reach the booking system.' });
    }

    const now = clubNow();
    const tools = createToolRunner(api, token, now);
    try {
      const turn = await provider.runTurn({ now, tools }, history, message);
      const reply: AgentReply = { ...turn, booked: tools.booked };
      return json(200, reply);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error('Booking agent failed', err);
      return json(502, { error: 'The booking assistant is unavailable right now.' });
    }
  };
}

/** Builds the handler from environment variables (process.env on Vercel, loadEnv in Vite). */
export function bookingAgentHandlerFromEnv(env: Record<string, string | undefined>) {
  return createBookingAgentHandler({
    dataApiUrl: env.VITE_NEON_DATA_API_URL ?? '',
    provider: env.ANTHROPIC_API_KEY ? createClaudeProvider(env.ANTHROPIC_API_KEY) : null,
  });
}
