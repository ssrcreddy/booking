import Anthropic from '@anthropic-ai/sdk';
import {
  BOOKING_ASSISTANT_ENABLED,
  BOOKING_WINDOW_DAYS,
  CLOSE_HOUR,
  CLUB_NAME,
  COURTS,
  HOURS,
  MAX_BOOKINGS_PER_USER_PER_DAY,
  OPEN_HOUR,
} from '../src/config';
import { addDays, formatHour } from '../src/dateUtils';

/**
 * Chat booking assistant. Runs server-side because it holds the Anthropic API
 * key. It never talks to the database with its own credentials: every Data API
 * call carries the player's JWT, so the booking triggers and RLS in
 * db/migrations/001_bookings.sql apply exactly as they do for the UI.
 */

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

export interface BookingAgentConfig {
  anthropicApiKey: string;
  dataApiUrl: string;
}

export interface AgentReply {
  reply: string;
  /** Full transcript to send back next turn (opaque to the browser). */
  history: MessageParam[];
  booked: boolean;
}

const MODEL = 'claude-opus-5-5';
const CLUB_TZ = 'America/New_York';
const MAX_STEPS = 8;
const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY_MESSAGES = 120;
const MAX_HISTORY_BYTES = 400_000;

const COURT_LIST = COURTS.map((c) => `${c.id} = ${c.name}`).join(', ');

const SYSTEM_PROMPT = `You are the booking assistant for ${CLUB_NAME}. You chat with one signed-in player and book tennis courts for them.

Club rules (the database enforces them too):
- Courts: ${COURT_LIST}.
- One-hour slots starting ${formatHour(OPEN_HOUR)} through ${formatHour(CLOSE_HOUR - 1)}, in club time (${CLUB_TZ}).
- Bookings open ${BOOKING_WINDOW_DAYS} days ahead, counting today. Slots that have already started can't be booked.
- At most ${MAX_BOOKINGS_PER_USER_PER_DAY} bookings per player per day.

How to help:
- Each player message starts with the current club date and time. Resolve words like "tomorrow", "Friday" or "6pm" against it. If the date or the time is missing or genuinely ambiguous, ask one short question instead of guessing.
- Always call get_availability for the date before booking.
- When the requested hour has a free court, book it straight away with book_court: asking for a time is the player's go-ahead. Use the court they named if it's free, otherwise the lowest-numbered free court.
- When no court is free at that hour, don't book anything else on your own. Offer the nearest free hour or two on the same day and wait for the player to confirm.
- After a booking succeeds, confirm it in one or two sentences with the court, the weekday and date, and the time range. If a booking fails, pass on the reason the tool gave.
- You can only check availability and book. For cancelling or anything else, point the player to the schedule on this page.
Write short plain-text replies without markdown.`;

const TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: 'get_availability',
    description:
      'List the free courts for each bookable hour on a date, plus the bookings the player already has that day. ' +
      'Hours that are fully booked or have already started are left out.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Club-time date, YYYY-MM-DD.' },
      },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_court',
    description: 'Book one court for one hour for the signed-in player. Returns the booking or the reason it failed.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Club-time date, YYYY-MM-DD.' },
        hour: {
          type: 'integer',
          description: `Start hour in 24-hour club time, ${OPEN_HOUR}-${CLOSE_HOUR - 1}. 18 means 18:00-19:00.`,
        },
        court_id: { type: 'string', enum: COURTS.map((c) => c.id) },
      },
      required: ['date', 'hour', 'court_id'],
      additionalProperties: false,
    },
  },
];

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A rule or conflict the player should hear about; becomes an error tool result. */
class ToolError extends Error {}

interface ClubNow {
  date: string;
  hour: number;
  label: string;
}

function clubNow(now = new Date()): ClubNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: CLUB_TZ,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, hour: Number(parts.hour), label: `${parts.weekday} ${date} ${parts.hour}:${parts.minute}` };
}

function weekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** The JWT subject. Only used to label "your" bookings; the database checks identity itself. */
function jwtSubject(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload)) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

function courtName(id: string): string {
  return COURTS.find((c) => c.id === id)?.name ?? id;
}

function checkDate(date: string, now: ClubNow): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ToolError('Date must be YYYY-MM-DD.');
  if (date < now.date) throw new ToolError('That date is in the past.');
  const last = addDays(now.date, BOOKING_WINDOW_DAYS - 1);
  if (date > last) throw new ToolError(`Bookings open ${BOOKING_WINDOW_DAYS} days in advance; the latest bookable date is ${last}.`);
}

interface BookingRow {
  id: string;
  court_id: string;
  date: string;
  hour: number;
  user_id: string;
}

interface PostgrestError {
  code?: string;
  message?: string;
}

/** Same mapping as NeonBookingService.toError, for the raw Data API. */
function dataApiError(status: number, err: PostgrestError | null): Error {
  if (status === 401) return new HttpError(401, 'Please sign in again.');
  if (err?.code === '23505') return new ToolError('Sorry, that slot was just taken.');
  if (err?.code === 'P0001' && err.message) return new ToolError(err.message);
  if (err?.code === '42501') return new ToolError('You are not allowed to do that.');
  console.error('Data API error', status, err);
  return new Error(err?.message ?? `Data API returned ${status}`);
}

function createDataApi(baseUrl: string, token: string) {
  return async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw dataApiError(res.status, body as PostgrestError | null);
    return body as T;
  };
}

type DataApi = ReturnType<typeof createDataApi>;

async function getAvailability(api: DataApi, token: string, now: ClubNow, input: { date: string }) {
  checkDate(input.date, now);
  const rows = await api<BookingRow[]>(`bookings?select=court_id,hour,user_id&date=eq.${input.date}`);
  const me = jwtSubject(token);
  const taken = new Set(rows.map((r) => `${r.court_id}:${r.hour}`));
  const mine = rows.filter((r) => r.user_id === me);

  const freeSlots = HOURS.filter((h) => input.date > now.date || h > now.hour)
    .map((h) => ({
      hour: h,
      time: `${formatHour(h)}-${formatHour(h + 1)}`,
      free_courts: COURTS.filter((c) => !taken.has(`${c.id}:${h}`)).map((c) => c.id),
    }))
    .filter((s) => s.free_courts.length > 0);

  return {
    date: input.date,
    weekday: weekday(input.date),
    free_slots: freeSlots,
    your_bookings: mine.map((r) => ({ court: courtName(r.court_id), time: formatHour(r.hour) })),
    bookings_left_today: Math.max(0, MAX_BOOKINGS_PER_USER_PER_DAY - mine.length),
  };
}

async function bookCourt(api: DataApi, now: ClubNow, input: { date: string; hour: number; court_id: string }) {
  checkDate(input.date, now);
  if (!HOURS.includes(input.hour)) {
    throw new ToolError(`Slots start between ${formatHour(OPEN_HOUR)} and ${formatHour(CLOSE_HOUR - 1)}.`);
  }
  // user_id / user_name are set by the insert trigger from the JWT.
  const [row] = await api<BookingRow[]>('bookings?select=id,court_id,date,hour', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ court_id: input.court_id, date: input.date, hour: input.hour }),
  });
  return {
    booked: true,
    booking_id: row.id,
    court: courtName(row.court_id),
    weekday: weekday(row.date),
    date: row.date,
    time: `${formatHour(row.hour)}-${formatHour(row.hour + 1)}`,
  };
}

function isHistory(value: unknown): value is MessageParam[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_HISTORY_MESSAGES &&
    value.every(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        ((m as MessageParam).role === 'user' || (m as MessageParam).role === 'assistant'),
    )
  );
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function runAgent(
  client: Anthropic,
  api: DataApi,
  token: string,
  history: MessageParam[],
  message: string,
): Promise<AgentReply> {
  const now = clubNow();
  const messages: MessageParam[] = [
    ...history,
    {
      role: 'user',
      content: [
        { type: 'text', text: `Current club time: ${now.label}` },
        { type: 'text', text: message },
      ],
    },
  ];
  let booked = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === 'refusal') {
      // Drop the refused turn so the conversation can carry on.
      return { reply: "Sorry, I can't help with that. I can check availability and book courts.", history, booked };
    }

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const reply = response.content
        .flatMap((b) => (b.type === 'text' ? [b.text] : []))
        .join('\n')
        .trim();
      return { reply: reply || 'Sorry, something went wrong. Please try again.', history: messages, booked };
    }

    const results: ToolResult[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      try {
        const input = block.input as Record<string, unknown>;
        let result: unknown;
        if (block.name === 'get_availability') {
          result = await getAvailability(api, token, now, input as { date: string });
        } else if (block.name === 'book_court') {
          result = await bookCourt(api, now, input as { date: string; hour: number; court_id: string });
          booked = true;
        } else {
          throw new ToolError(`Unknown tool ${block.name}`);
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        const text = err instanceof ToolError ? err.message : 'The booking system had an unexpected error.';
        if (!(err instanceof ToolError)) console.error('Tool failed', block.name, err);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: text, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  return { reply: 'Sorry, that took too many steps. Please try again with a date and time.', history: messages, booked };
}

/**
 * POST { history, message } with `Authorization: Bearer <Neon Auth JWT>`.
 * Web-standard Request/Response, so it can run in the Vite dev server or any
 * serverless runtime.
 */
export function createBookingAgentHandler(config: BookingAgentConfig) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  return async function handle(request: Request): Promise<Response> {
    if (!BOOKING_ASSISTANT_ENABLED) return json(403, { error: 'The booking assistant is turned off.' });
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    if (!config.anthropicApiKey || !config.dataApiUrl) {
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
    const history = body.history ?? [];
    if (!message || message.length > MAX_MESSAGE_CHARS || !isHistory(history)) {
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

    try {
      return json(200, await runAgent(client, api, token, history, message));
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      if (err instanceof Anthropic.RateLimitError) {
        return json(503, { error: 'The assistant is busy right now. Please try again in a moment.' });
      }
      if (err instanceof Anthropic.BadRequestError) {
        console.error('Claude rejected the request', err.message);
        return json(400, { error: 'Something went wrong with this conversation. Reload to start a new one.' });
      }
      console.error('Booking agent failed', err);
      return json(502, { error: 'The booking assistant is unavailable right now.' });
    }
  };
}
