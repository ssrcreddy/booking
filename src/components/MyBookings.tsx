import { COURTS } from '../config';
import { formatDateLong, formatHour, slotStart } from '../dateUtils';
import type { Booking } from '../types';

interface Props {
  bookings: Booking[];
  now: Date;
  onCancel: (booking: Booking) => void;
  onGoTo: (date: string) => void;
}

export function MyBookings({ bookings, now, onCancel, onGoTo }: Props) {
  const upcoming = bookings.filter((b) => slotStart(b.date, b.hour + 1) > now);

  return (
    <section className="my-bookings">
      <h2>My bookings</h2>
      {upcoming.length === 0 ? (
        <p className="muted">No upcoming bookings. Pick a free slot to book a court.</p>
      ) : (
        <ul>
          {upcoming.map((b) => {
            const started = slotStart(b.date, b.hour) <= now;
            return (
              <li key={b.id}>
                <button className="btn link booking-link" onClick={() => onGoTo(b.date)}>
                  <strong>{COURTS.find((c) => c.id === b.courtId)?.name}</strong>
                  <span>
                    {formatDateLong(b.date)} · {formatHour(b.hour)}–{formatHour(b.hour + 1)}
                  </span>
                </button>
                {started ? (
                  <span className="badge">In progress</span>
                ) : (
                  <button className="btn small" onClick={() => onCancel(b)}>
                    Cancel
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
