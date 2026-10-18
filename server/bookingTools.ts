import {
  BOOKING_WINDOW_DAYS,
  CLOSE_HOUR,
  CLUB_NAME,
  COURTS,
  HOURS,
  MAX_BOOKINGS_PER_USER_PER_DAY,
  OPEN_HOUR,
} from '../src/config.js';
import { addDays, formatHour } from '../src/dateUtils.js';

/**
 * Provider-neutral parts of the booking assistant: the instructions, the tool
 * definitions and the code that runs the tools. Every Data API call carries
 * the player's JWT, so the booking triggers and RLS in
 * db/migrations/001_bookings.sql apply exactly as they do for the UI.
 */

export const CLUB_TZ = 'America/New_York';

const COURT_LIST = COURTS.map((c) => `${c.id} = ${c.name}`).join(', ');

export const SYSTEM_PROMPT = `You are the booking assistant for ${CLUB_NAME}. You chat with one signed-in player and book tennis courts for them.

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

/** A tool as plain JSON Schema; each provider wraps it in its own format. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_availability',
    description:
      'List the free courts for each bookable hour on a date, plus the bookings the player already has that day. ' +
      'Hours that are fully booked or have already started are left out.',
    parameters: {
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
    parameters: {
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

/** An error with an HTTP status that ends the request (expired login, provider busy, ...). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A rule or conflict the player should hear about; becomes an error tool result. */
export class ToolError extends Error {}

export interface ClubNow {
  date: string;
  hour: number;
  label: string;
}

export function clubNow(now = new Date()): ClubNow {
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

/** Text every provider puts in front of the player's message. */
export function clubTimeNote(now: ClubNow): string {
  return `Current club time: ${now.label}`;
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

export function createDataApi(baseUrl: string, token: string) {
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

export type DataApi = ReturnType<typeof createDataApi>;

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

export interface ToolOutcome {
  /** JSON result, or the message to show the model when isError is set. */
  content: string;
  isError: boolean;
}

export interface ToolRunner {
  run(name: string, input: unknown): Promise<ToolOutcome>;
  /** Whether any book_court call succeeded during this turn. */
  readonly booked: boolean;
}

/** Runs tool calls for one player turn. Only an HttpError (e.g. expired login) is thrown. */
export function createToolRunner(api: DataApi, token: string, now: ClubNow): ToolRunner {
  let booked = false;
  return {
    get booked() {
      return booked;
    },
    async run(name, input) {
      try {
        const args = input as Record<string, unknown>;
        let result: unknown;
        if (name === 'get_availability') {
          result = await getAvailability(api, token, now, args as { date: string });
        } else if (name === 'book_court') {
          result = await bookCourt(api, now, args as { date: string; hour: number; court_id: string });
          booked = true;
        } else {
          throw new ToolError(`Unknown tool ${name}`);
        }
        return { content: JSON.stringify(result), isError: false };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (!(err instanceof ToolError)) console.error('Tool failed', name, err);
        const content = err instanceof ToolError ? err.message : 'The booking system had an unexpected error.';
        return { content, isError: true };
      }
    },
  };
}
