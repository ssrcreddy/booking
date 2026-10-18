import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookingError } from '../services';
import { askBookingAgent } from '../services/bookingAgentClient';

interface Props {
  /** Called after the assistant books a court, so the schedule can refresh. */
  onBooked: () => void;
}

interface Line {
  from: 'you' | 'assistant';
  text: string;
}

const GREETING: Line = {
  from: 'assistant',
  text: 'Tell me a day and time, like "tomorrow at 6pm", and I\'ll book a court for you.',
};

export function BookingAssistant({ onBooked }: Props) {
  const [lines, setLines] = useState<Line[]>([GREETING]);
  const [history, setHistory] = useState<unknown[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines, busy]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    setLines((l) => [...l, { from: 'you', text }]);
    setBusy(true);
    try {
      const turn = await askBookingAgent(history, text);
      setHistory(turn.history);
      setLines((l) => [...l, { from: 'assistant', text: turn.reply }]);
      if (turn.booked) onBooked();
    } catch (err) {
      setError(err instanceof BookingError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="assistant">
      <h2>Booking assistant</h2>
      <ol className="assistant-log" ref={logRef} aria-live="polite">
        {lines.map((line, i) => (
          <li key={i} className={line.from}>
            <span className="sr-only">{line.from === 'you' ? 'You: ' : 'Assistant: '}</span>
            {line.text}
          </li>
        ))}
        {busy && <li className="assistant pending">Checking courts…</li>}
      </ol>
      {error && <p className="form-error" role="alert">{error}</p>}
      <form className="assistant-form" onSubmit={send}>
        <input
          aria-label="Message the booking assistant"
          placeholder="e.g. Friday 7pm"
          value={input}
          maxLength={1000}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
