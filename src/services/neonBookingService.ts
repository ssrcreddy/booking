import { neon } from '../lib/neon';
import type { Booking, NewBooking } from '../types';
import { BookingError, type BookingService } from './bookingService';

interface BookingRow {
  id: string;
  court_id: string;
  date: string;
  hour: number;
  user_id: string;
  user_name: string;
  created_at: string;
}

interface PostgrestError {
  code?: string;
  message?: string;
}

const COLUMNS = 'id, court_id, date, hour, user_id, user_name, created_at';

function toBooking(r: BookingRow): Booking {
  return {
    id: r.id,
    courtId: r.court_id,
    date: r.date,
    hour: r.hour,
    userId: r.user_id,
    userName: r.user_name,
    createdAt: r.created_at,
  };
}

function toError(err: PostgrestError): Error {
  if (err.code === '23505') return new BookingError('Sorry, that slot was just taken.');
  // Messages raised by the booking triggers (see db/migrations/001_bookings.sql).
  if (err.code === 'P0001' && err.message) return new BookingError(err.message);
  if (err.code === '42501') return new BookingError('You are not allowed to do that.');
  console.error('Data API error', err);
  return new Error(err.message ?? 'Unexpected database error');
}

/** Bookings stored in Neon Postgres, accessed through the Data API under RLS. */
export class NeonBookingService implements BookingService {
  private async currentUserId(): Promise<string> {
    const { data } = await neon.auth.getSession();
    const id = data?.user?.id;
    if (!id) throw new BookingError('Please sign in again.');
    return id;
  }

  async listByDate(date: string): Promise<Booking[]> {
    const { data, error } = await neon.from('bookings').select(COLUMNS).eq('date', date);
    if (error) throw toError(error);
    return (data as BookingRow[]).map(toBooking);
  }

  async listMine(fromDate: string): Promise<Booking[]> {
    const userId = await this.currentUserId();
    const { data, error } = await neon
      .from('bookings')
      .select(COLUMNS)
      .eq('user_id', userId)
      .gte('date', fromDate)
      .order('date')
      .order('hour');
    if (error) throw toError(error);
    return (data as BookingRow[]).map(toBooking);
  }

  async create(b: NewBooking): Promise<Booking> {
    // user_id / user_name are set server-side from the JWT.
    const { data, error } = await neon
      .from('bookings')
      .insert({ court_id: b.courtId, date: b.date, hour: b.hour })
      .select(COLUMNS)
      .single();
    if (error) throw toError(error);
    return toBooking(data as BookingRow);
  }

  async cancel(id: string): Promise<void> {
    const { error } = await neon.from('bookings').delete().eq('id', id);
    if (error) throw toError(error);
  }
}
