import { useEffect, useState } from 'react';
import { COURTS } from '../config';
import { formatDateLong, formatHour } from '../dateUtils';

export interface DialogRequest {
  mode: 'book' | 'cancel';
  courtId: string;
  date: string;
  hour: number;
}

interface Props {
  request: DialogRequest;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function BookingDialog({ request, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const court = COURTS.find((c) => c.id === request.courtId);
  const isBook = request.mode === 'book';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="dialog-title">{isBook ? 'Book this court?' : 'Cancel this booking?'}</h3>
        <dl>
          <dt>Court</dt>
          <dd>{court?.name}</dd>
          <dt>Date</dt>
          <dd>{formatDateLong(request.date)}</dd>
          <dt>Time</dt>
          <dd>
            {formatHour(request.hour)} – {formatHour(request.hour + 1)}
          </dd>
        </dl>
        <div className="dialog-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            {isBook ? 'Cancel' : 'Keep it'}
          </button>
          <button className={`btn ${isBook ? 'primary' : 'danger'}`} onClick={confirm} disabled={busy} autoFocus>
            {isBook ? 'Confirm booking' : 'Cancel booking'}
          </button>
        </div>
      </div>
    </div>
  );
}
