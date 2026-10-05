import type { BookingService } from './bookingService';
import { NeonBookingService } from './neonBookingService';

export const bookingService: BookingService = new NeonBookingService();

export { BookingError } from './bookingService';
export type { BookingService } from './bookingService';
