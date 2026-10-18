// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../src/dateUtils';
import type { AgentProvider } from './agentProvider';
import { createBookingAgentHandler } from './bookingAgent';
import { clubNow, type ToolOutcome } from './bookingTools';

const DATA_API = 'https://ep-test.apirest.example/neondb/rest/v1';
// Unsigned JWT with sub "u1"; the server only decodes it to label "your" bookings.
const TOKEN = `x.${btoa(JSON.stringify({ sub: 'u1' }))}.y`;
const TOMORROW = addDays(clubNow().date, 1);

/** Stands in for an AI provider: calls the tools in a fixed order and reports what came back. */
function scriptedProvider(calls: { name: string; input: unknown }[]) {
  const outcomes: ToolOutcome[] = [];
  const provider: AgentProvider<string[]> = {
    parseHistory: (value) => (Array.isArray(value) ? (value as string[]) : null),
    async runTurn({ tools }, history, message) {
      for (const call of calls) outcomes.push(await tools.run(call.name, call.input));
      return { reply: 'done', history: [...history, message] };
    },
  };
  return { provider, outcomes };
}

function request(body: unknown, token: string | null = TOKEN) {
  return new Request('http://localhost/api/booking-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
}

/** Fake Data API: answers the token check, the availability query and the insert. */
function mockDataApi(insert: () => Response = () => Response.json([{ id: 'b1', court_id: 'c1', date: TOMORROW, hour: 18 }], { status: 201 })) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).slice(DATA_API.length + 1);
    if (path === 'bookings?select=id&limit=1') return Response.json([]);
    if (path.startsWith('bookings?select=court_id,hour,user_id')) {
      return Response.json([{ court_id: 'c1', hour: 9, user_id: 'u1' }]);
    }
    if (path.startsWith('bookings?select=id,court_id,date,hour') && init?.method === 'POST') return insert();
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('booking agent endpoint', () => {
  it('runs the tools with the player token and reports the booking', async () => {
    const fetchMock = mockDataApi();
    const { provider, outcomes } = scriptedProvider([
      { name: 'get_availability', input: { date: TOMORROW } },
      { name: 'book_court', input: { date: TOMORROW, hour: 18, court_id: 'c1' } },
    ]);

    const res = await createBookingAgentHandler({ dataApiUrl: DATA_API, provider })(
      request({ history: [], message: 'tomorrow 6pm' }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'done', history: ['tomorrow 6pm'], booked: true });

    const availability = JSON.parse(outcomes[0].content);
    expect(availability.free_slots.find((s: { hour: number }) => s.hour === 9).free_courts).toEqual(['c2', 'c3', 'c4']);
    expect(availability.your_bookings).toEqual([{ court: 'Court 1', time: '09:00' }]);
    expect(availability.bookings_left_today).toBe(1);
    expect(JSON.parse(outcomes[1].content)).toMatchObject({ booked: true, court: 'Court 1', time: '18:00-19:00' });

    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
    }
    const insert = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(insert?.[1]?.body))).toEqual({ court_id: 'c1', date: TOMORROW, hour: 18 });
  });

  it('passes database rule errors back to the model', async () => {
    mockDataApi(() => Response.json({ code: 'P0001', message: 'You can book at most 2 slots per day.' }, { status: 400 }));
    const { provider, outcomes } = scriptedProvider([
      { name: 'book_court', input: { date: TOMORROW, hour: 18, court_id: 'c1' } },
    ]);

    const res = await createBookingAgentHandler({ dataApiUrl: DATA_API, provider })(
      request({ history: [], message: 'tomorrow 6pm' }),
    );

    expect(outcomes).toEqual([{ content: 'You can book at most 2 slots per day.', isError: true }]);
    expect((await res.json()).booked).toBe(false);
  });

  it('rejects dates outside the booking window without calling the database', async () => {
    const fetchMock = mockDataApi();
    const tooFar = addDays(clubNow().date, 14);
    const { provider, outcomes } = scriptedProvider([{ name: 'get_availability', input: { date: tooFar } }]);

    await createBookingAgentHandler({ dataApiUrl: DATA_API, provider })(request({ history: [], message: 'x' }));

    expect(outcomes[0].isError).toBe(true);
    expect(outcomes[0].content).toContain('14 days');
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the token check
  });

  it('refuses requests without a valid login before running the model', async () => {
    const runTurn = vi.fn();
    const provider: AgentProvider = { parseHistory: (v) => v, runTurn };
    const handle = createBookingAgentHandler({ dataApiUrl: DATA_API, provider });

    expect((await handle(request({ history: [], message: 'hi' }, null))).status).toBe(401);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    expect((await handle(request({ history: [], message: 'hi' }))).status).toBe(401);
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('rejects history the provider does not recognise', async () => {
    mockDataApi();
    const { provider } = scriptedProvider([]);

    const res = await createBookingAgentHandler({ dataApiUrl: DATA_API, provider })(
      request({ history: 'not a transcript', message: 'hi' }),
    );

    expect(res.status).toBe(400);
  });

  it('reports a missing provider as not configured', async () => {
    const res = await createBookingAgentHandler({ dataApiUrl: DATA_API, provider: null })(
      request({ history: [], message: 'hi' }),
    );
    expect(res.status).toBe(500);
  });
});
