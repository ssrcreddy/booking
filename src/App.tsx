import { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthScreen } from './components/AuthScreen';
import { BookingDialog, type DialogRequest } from './components/BookingDialog';
import { CourtGrid } from './components/CourtGrid';
import { DatePicker } from './components/DatePicker';
import { MyBookings } from './components/MyBookings';
import { UserBar } from './components/UserBar';
import { CLUB_NAME } from './config';
import { toDateKey } from './dateUtils';
import { useBookings } from './hooks/useBookings';
import { neonConfigured } from './lib/neon';
import { BookingError, bookingService } from './services';
import type { Booking, User } from './types';

/** Current time, refreshed every minute so past slots grey out. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

type Toast = { kind: 'ok' | 'error'; text: string };

export default function App() {
  return (
    <AuthProvider>
      <div className="app">
        <header className="app-header">
          <h1>🎾 {CLUB_NAME}</h1>
          <UserBar />
        </header>
        <Gate />
      </div>
    </AuthProvider>
  );
}

function Gate() {
  const { user, loading } = useAuth();

  if (!neonConfigured) {
    return (
      <div className="auth-card">
        <h2>Neon isn't configured</h2>
        <p className="muted">
          Copy <code>.env.example</code> to <code>.env.local</code>, fill in your Neon Auth and Data API URLs,
          then restart <code>npm run dev</code>. See README.md for the full setup.
        </p>
      </div>
    );
  }
  if (loading) return <p className="hint">Loading…</p>;
  if (!user) return <AuthScreen />;
  return <Schedule user={user} />;
}

function Schedule({ user }: { user: User }) {
  const now = useNow();
  const today = toDateKey(now);
  const [date, setDate] = useState(today);
  const [dialog, setDialog] = useState<(DialogRequest & { bookingId?: string }) | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const { dayBookings, myBookings, loadError, refresh } = useBookings(date, today);

  // If the day rolls over, don't leave the user on a past date.
  useEffect(() => {
    if (date < today) setDate(today);
  }, [date, today]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const askCancel = (b: Booking) =>
    setDialog({ mode: 'cancel', courtId: b.courtId, date: b.date, hour: b.hour, bookingId: b.id });

  const closeDialog = useCallback(() => setDialog(null), []);

  const confirm = async () => {
    if (!dialog) return;
    try {
      if (dialog.mode === 'book') {
        await bookingService.create({ courtId: dialog.courtId, date: dialog.date, hour: dialog.hour });
        setToast({ kind: 'ok', text: 'Court booked. See you on court!' });
      } else if (dialog.bookingId) {
        await bookingService.cancel(dialog.bookingId);
        setToast({ kind: 'ok', text: 'Booking cancelled.' });
      }
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof BookingError ? err.message : 'Something went wrong. Please try again.',
      });
    }
    setDialog(null);
    await refresh();
  };

  return (
    <>
      {loadError && <p className="form-error banner" role="alert">{loadError}</p>}
      <main>
        <section className="schedule">
          <DatePicker today={today} value={date} onChange={setDate} />
          <div className="legend">
            <span><i className="swatch free" /> Free</span>
            <span><i className="swatch mine" /> Yours</span>
            <span><i className="swatch taken" /> Booked</span>
          </div>
          <CourtGrid
            date={date}
            now={now}
            bookings={dayBookings}
            userId={user.id}
            onSelectFree={(courtId, hour) => setDialog({ mode: 'book', courtId, date, hour })}
            onSelectMine={askCancel}
          />
        </section>

        <MyBookings bookings={myBookings} now={now} onCancel={askCancel} onGoTo={setDate} />
      </main>

      {dialog && <BookingDialog request={dialog} onConfirm={confirm} onClose={closeDialog} />}

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}
