import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { BOOKING_ASSISTANT_ENABLED, BOOKING_ASSISTANT_PROVIDER, type AssistantProvider } from '../src/config.js';
import type { AgentProvider } from './agentProvider.js';
import { clubNow, createDataApi, createToolRunner, HttpError, ToolError } from './bookingTools.js';
import { createClaudeProvider } from './providers/claude.js';
import { createGeminiProvider } from './providers/gemini.js';
import { createOpenAIProvider } from './providers/openai.js';

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

/** What the browser holds between turns: the transcript, tagged with the provider that wrote it. */
interface StoredHistory {
  provider: AssistantProvider;
  data: unknown;
}

export interface AgentReply {
  reply: string;
  /** Send back unchanged next turn (opaque to the browser). */
  history: StoredHistory;
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
    if (!message || message.length > MAX_MESSAGE_CHARS) return json(400, { error: 'Invalid request.' });

    // null starts a new conversation. A transcript from another provider (the
    // admin switched BOOKING_ASSISTANT_PROVIDER) can't be continued.
    const stored = body.history as Partial<StoredHistory> | null | undefined;
    if (stored != null && stored.provider !== provider.name) {
      return json(409, { error: 'The assistant was updated. Reload the page to start a new conversation.' });
    }
    const history = provider.parseHistory(stored == null ? [] : stored.data);
    if (history === null) return json(400, { error: 'Invalid request.' });

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
      const reply: AgentReply = {
        reply: turn.reply,
        history: { provider: provider.name, data: turn.history },
        booked: tools.booked,
      };
      return json(200, reply);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error('Booking agent failed', err);
      return json(502, { error: 'The booking assistant is unavailable right now.' });
    }
  };
}

type Env = Record<string, string | undefined>;

/** The provider chosen in config, or null when its API key is missing. */
export function providerFromEnv(name: AssistantProvider, env: Env): AgentProvider | null {
  switch (name) {
    case 'claude':
      return env.ANTHROPIC_API_KEY ? createClaudeProvider(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })) : null;
    case 'openai':
      return env.OPENAI_API_KEY
        ? createOpenAIProvider(new OpenAI({ apiKey: env.OPENAI_API_KEY }), env.OPENAI_MODEL || undefined)
        : null;
    case 'gemini':
      return env.GEMINI_API_KEY
        ? createGeminiProvider(new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }), env.GEMINI_MODEL || undefined)
        : null;
  }
}

/** Builds the handler from environment variables (process.env on Vercel, loadEnv in Vite). */
export function bookingAgentHandlerFromEnv(env: Env) {
  return createBookingAgentHandler({
    dataApiUrl: env.VITE_NEON_DATA_API_URL ?? '',
    provider: providerFromEnv(BOOKING_ASSISTANT_PROVIDER, env),
  });
}
