import {
  BOOKING_WINDOW_DAYS,
  CLOSE_HOUR,
  COURTS,
  MAX_BOOKINGS_PER_USER_PER_DAY,
  OPEN_HOUR,
} from '../config';
import { daysBetween, slotStart, toDateKey } from '../dateUtils';
import type { Booking, NewBooking, User } from '../types';
import { BookingError, type BookingService } from './bookingService';

const STORAGE_KEY = 'court-booking:bookings';

/**
 * In-browser implementation of the booking rules. Not used by the app any
 * more (see NeonBookingService); kept as a fake for tests and offline demos.
 */
export class LocalBookingService implements BookingService {
  constructor(
    private getUser: () => User | null,
    private storage: Storage = window.localStorage,
    private now: () => Date = () => new Date(),
  ) {}

  private requireUser(): User {
    const user = this.getUser();
    if (!user) throw new BookingError('You must be signed in to book.');
    return user;
  }

  private readAll(): Booking[] {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Booking[]) : [];
    } catch {
      return [];
    }
  }

  private writeAll(bookings: Booking[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(bookings));
  }

  async listByDate(date: string): Promise<Booking[]> {
    return this.readAll().filter((b) => b.date === date);
  }

  async listMine(fromDate: string): Promise<Booking[]> {
    const user = this.requireUser();
    return this.readAll()
      .filter((b) => b.userId === user.id && b.date >= fromDate)
      .sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
  }

  async create(input: NewBooking): Promise<Booking> {
    const user = this.requireUser();
    if (!COURTS.some((c) => c.id === input.courtId)) throw new BookingError('Unknown court.');
    if (!Number.isInteger(input.hour) || input.hour < OPEN_HOUR || input.hour >= CLOSE_HOUR) {
      throw new BookingError('That time is outside club opening hours.');
    }

    const now = this.now();
    if (slotStart(input.date, input.hour) <= now) {
      throw new BookingError('That slot has already started.');
    }
    if (daysBetween(toDateKey(now), input.date) >= BOOKING_WINDOW_DAYS) {
      throw new BookingError(`Bookings open ${BOOKING_WINDOW_DAYS} days in advance.`);
    }

    const all = this.readAll();
    if (all.some((b) => b.courtId === input.courtId && b.date === input.date && b.hour === input.hour)) {
      throw new BookingError('Sorry, that slot was just taken.');
    }
    const sameDay = all.filter((b) => b.date === input.date && b.userId === user.id);
    if (sameDay.length >= MAX_BOOKINGS_PER_USER_PER_DAY) {
      throw new BookingError(`You can book at most ${MAX_BOOKINGS_PER_USER_PER_DAY} slots per day.`);
    }

    const booking: Booking = {
      ...input,
      userId: user.id,
      userName: user.name || user.email,
      id: crypto.randomUUID(),
      createdAt: now.toISOString(),
    };
    this.writeAll([...all, booking]);
    return booking;
  }

  async cancel(id: string): Promise<void> {
    const user = this.requireUser();
    const all = this.readAll();
    const booking = all.find((b) => b.id === id);
    if (!booking) return;
    if (booking.userId !== user.id) {
      throw new BookingError('You can only cancel your own bookings.');
    }
    this.writeAll(all.filter((b) => b.id !== id));
  }
}
