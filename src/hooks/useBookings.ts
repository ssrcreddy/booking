import { useCallback, useEffect, useState } from 'react';
import { bookingService } from '../services';
import type { Booking } from '../types';

const POLL_MS = 30_000;

/** Bookings for the selected date plus the current user's upcoming bookings. */
export function useBookings(date: string, today: string) {
  const [dayBookings, setDayBookings] = useState<Booking[]>([]);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [day, mine] = await Promise.all([
        bookingService.listByDate(date),
        bookingService.listMine(today),
      ]);
      setDayBookings(day);
      setMyBookings(mine);
      setLoadError('');
    } catch (err) {
      console.error(err);
      setLoadError('Could not load bookings. Check your connection and try again.');
    }
  }, [date, today]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Pick up bookings made by other people / devices.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(id);
    };
  }, [refresh]);

  return { dayBookings, myBookings, loadError, refresh };
}
