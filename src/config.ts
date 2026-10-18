import type { Court } from './types';

export const CLUB_NAME = 'Riverside Tennis Club';

export const COURTS: Court[] = [
  { id: 'c1', name: 'Court 1' },
  { id: 'c2', name: 'Court 2' },
  { id: 'c3', name: 'Court 3' },
  { id: 'c4', name: 'Court 4' },
];

/** First slot starts at OPEN_HOUR; last slot starts at CLOSE_HOUR - 1. */
export const OPEN_HOUR = 7;
export const CLOSE_HOUR = 21;

/** How many days ahead (including today) can be booked. */
export const BOOKING_WINDOW_DAYS = 14;

export const MAX_BOOKINGS_PER_USER_PER_DAY = 2;

/**
 * Admin switch for the Claude booking assistant. false hides the chat panel
 * and makes /api/booking-agent refuse requests. Restart or redeploy to apply.
 */
export const BOOKING_ASSISTANT_ENABLED = true;

export const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);
