import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../types';
import { LocalBookingService } from './localBookingService';

// Fixed "now": 2026-10-05 10:30 local time
const NOW = new Date(2026, 9, 5, 10, 30);
const TODAY = '2026-10-05';
const TOMORROW = '2026-10-06';

const ALICE: User = { id: 'u-alice', name: 'Alice', email: 'alice@example.com' };
const BOB: User = { id: 'u-bob', name: 'Bob', email: 'bob@example.com' };

let current: User | null = ALICE;
function makeService() {
  return new LocalBookingService(() => current, window.localStorage, () => NOW);
}

describe('LocalBookingService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    current = ALICE;
  });

  it('creates and lists a booking', async () => {
    const svc = makeService();
    const b = await svc.create({ courtId: 'c1', date: TOMORROW, hour: 9 });
    expect(b.userId).toBe(ALICE.id);
    expect(b.userName).toBe('Alice');
    expect(await svc.listByDate(TOMORROW)).toHaveLength(1);
    expect(await svc.listMine(TODAY)).toHaveLength(1);
  });

  it('requires a signed-in user', async () => {
    current = null;
    await expect(makeService().create({ courtId: 'c1', date: TOMORROW, hour: 9 })).rejects.toThrow(/signed in/);
  });

  it('rejects a double booking of the same slot', async () => {
    const svc = makeService();
    await svc.create({ courtId: 'c1', date: TOMORROW, hour: 9 });
    current = BOB;
    await expect(svc.create({ courtId: 'c1', date: TOMORROW, hour: 9 })).rejects.toThrow(/taken/);
  });

  it('allows the same hour on a different court', async () => {
    const svc = makeService();
    await svc.create({ courtId: 'c1', date: TOMORROW, hour: 9 });
    current = BOB;
    await expect(svc.create({ courtId: 'c2', date: TOMORROW, hour: 9 })).resolves.toBeTruthy();
  });

  it('rejects slots that already started', async () => {
    const svc = makeService();
    await expect(svc.create({ courtId: 'c1', date: TODAY, hour: 10 })).rejects.toThrow(/already started/);
    await expect(svc.create({ courtId: 'c1', date: TODAY, hour: 11 })).resolves.toBeTruthy();
  });

  it('rejects dates beyond the booking window', async () => {
    const svc = makeService();
    await expect(svc.create({ courtId: 'c1', date: '2026-10-19', hour: 9 })).rejects.toThrow(/in advance/);
    await expect(svc.create({ courtId: 'c1', date: '2026-10-18', hour: 9 })).resolves.toBeTruthy();
  });

  it('rejects hours outside opening times', async () => {
    const svc = makeService();
    await expect(svc.create({ courtId: 'c1', date: TOMORROW, hour: 21 })).rejects.toThrow(/opening hours/);
  });

  it('caps bookings per user per day', async () => {
    const svc = makeService();
    await svc.create({ courtId: 'c1', date: TOMORROW, hour: 9 });
    await svc.create({ courtId: 'c1', date: TOMORROW, hour: 10 });
    await expect(svc.create({ courtId: 'c2', date: TOMORROW, hour: 11 })).rejects.toThrow(/at most 2/);
  });

  it('only lets the owner cancel', async () => {
    const svc = makeService();
    const b = await svc.create({ courtId: 'c1', date: TOMORROW, hour: 9 });
    current = BOB;
    await expect(svc.cancel(b.id)).rejects.toThrow(/own bookings/);
    current = ALICE;
    await svc.cancel(b.id);
    expect(await svc.listByDate(TOMORROW)).toHaveLength(0);
  });
});
