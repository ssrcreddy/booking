import type { Booking, NewBooking } from '../types';

/**
 * Storage-agnostic booking API. The UI only talks to this interface.
 * The signed-in user is implied (from the auth session), never passed in.
 */
export interface BookingService {
  listByDate(date: string): Promise<Booking[]>;
  /** The current user's bookings from `fromDate` onwards. */
  listMine(fromDate: string): Promise<Booking[]>;
  create(booking: NewBooking): Promise<Booking>;
  cancel(id: string): Promise<void>;
}

export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingError';
  }
}
