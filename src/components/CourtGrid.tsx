import { COURTS, HOURS } from '../config';
import { formatHour, slotStart } from '../dateUtils';
import type { Booking } from '../types';

interface Props {
  date: string;
  now: Date;
  bookings: Booking[];
  userId: string;
  onSelectFree: (courtId: string, hour: number) => void;
  onSelectMine: (booking: Booking) => void;
}

export function CourtGrid({ date, now, bookings, userId, onSelectFree, onSelectMine }: Props) {
  const byKey = new Map(bookings.map((b) => [`${b.courtId}:${b.hour}`, b]));

  return (
    <div className="grid-wrap">
      <table className="court-grid">
        <thead>
          <tr>
            <th className="time-col">Time</th>
            {COURTS.map((c) => (
              <th key={c.id}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((hour) => {
            const past = slotStart(date, hour) <= now;
            return (
              <tr key={hour}>
                <th className="time-col">{formatHour(hour)}</th>
                {COURTS.map((court) => {
                  const booking = byKey.get(`${court.id}:${hour}`);
                  const mine = booking && booking.userId === userId;
                  let cls = 'free';
                  let label = 'Free';
                  if (booking) {
                    cls = mine ? 'mine' : 'taken';
                    label = mine ? 'Your booking' : booking.userName;
                  }
                  if (past) cls += ' past';
                  const clickable = !past && (!booking || mine);
                  return (
                    <td key={court.id}>
                      <button
                        className={`slot ${cls}`}
                        disabled={!clickable}
                        title={`${court.name}, ${formatHour(hour)} – ${label}`}
                        onClick={() =>
                          booking ? onSelectMine(booking) : onSelectFree(court.id, hour)
                        }
                      >
                        {past && !booking ? '—' : label}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
