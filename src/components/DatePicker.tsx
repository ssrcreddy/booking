import { BOOKING_WINDOW_DAYS } from '../config';
import { addDays, daysBetween, formatDateLong } from '../dateUtils';

interface Props {
  today: string;
  value: string;
  onChange: (date: string) => void;
}

export function DatePicker({ today, value, onChange }: Props) {
  const offset = daysBetween(today, value);
  const days = Array.from({ length: BOOKING_WINDOW_DAYS }, (_, i) => addDays(today, i));

  return (
    <div className="date-picker">
      <div className="date-nav">
        <button
          className="btn"
          onClick={() => onChange(addDays(value, -1))}
          disabled={offset <= 0}
          aria-label="Previous day"
        >
          ‹
        </button>
        <h2>{offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : formatDateLong(value)}</h2>
        <button
          className="btn"
          onClick={() => onChange(addDays(value, 1))}
          disabled={offset >= BOOKING_WINDOW_DAYS - 1}
          aria-label="Next day"
        >
          ›
        </button>
      </div>
      <div className="day-strip" role="tablist">
        {days.map((d) => {
          const date = new Date(d + 'T00:00');
          return (
            <button
              key={d}
              role="tab"
              aria-selected={d === value}
              className={`day-chip${d === value ? ' selected' : ''}`}
              onClick={() => onChange(d)}
            >
              <span className="dow">{date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="dom">{date.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
