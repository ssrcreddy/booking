import { neon } from '../lib/neon';
import { BookingError } from './bookingService';

export interface AgentTurn {
  reply: string;
  /** Conversation so far, owned by the server; send it back unchanged. */
  history: unknown[];
  booked: boolean;
}

/** One turn with the booking assistant (server/bookingAgent.ts). It acts as the signed-in user. */
export async function askBookingAgent(history: unknown[], message: string): Promise<AgentTurn> {
  const { data } = await neon.auth.getSession();
  const token = data?.session?.token;
  if (!token) throw new BookingError('Please sign in again.');

  const res = await fetch('/api/booking-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ history, message }),
  });
  const body = (await res.json().catch(() => null)) as (AgentTurn & { error?: string }) | null;
  if (!res.ok || !body) throw new BookingError(body?.error ?? 'The booking assistant is unavailable right now.');
  return body;
}
