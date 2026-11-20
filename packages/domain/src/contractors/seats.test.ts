import { describe, expect, it } from 'vitest';
import { seatsOf, seatsShort, type SeatUsage } from './seats';

const usage = (over: Partial<SeatUsage> = {}): SeatUsage => ({
  demo: false,
  status: 'active',
  seatsUsed: 58,
  seatsLimit: 60,
  ...over,
});

describe('места в пакете (прототип subSeats, seatOk)', () => {
  it('свободно — пакет минус активные, не меньше нуля', () => {
    expect(seatsOf(usage())).toEqual({ used: 58, limit: 60, free: 2 });
    expect(seatsOf(usage({ seatsUsed: 63 }))).toEqual({ used: 63, limit: 60, free: 0 });
  });

  it('у демо, без подписки и без ответа предела нет', () => {
    expect(seatsOf(usage({ demo: true, seatsLimit: null }))).toBeNull();
    expect(seatsOf(usage({ status: 'none', seatsLimit: 0, seatsUsed: 0 }))).toBeNull();
    expect(seatsOf(null)).toBeNull();
  });

  it('просроченная и ждущая подтверждения подписка — пакет действует', () => {
    expect(seatsOf(usage({ status: 'overdue' }))?.free).toBe(2);
    expect(seatsOf(usage({ status: 'pending' }))?.free).toBe(2);
  });

  it('не хватает мест — только когда новых больше свободных', () => {
    const s = seatsOf(usage());
    expect(seatsShort(s, 2)).toBe(false);
    expect(seatsShort(s, 3)).toBe(true);
    expect(seatsShort(s, 0)).toBe(false);
    expect(seatsShort(null, 500)).toBe(false);
    expect(seatsShort(seatsOf(usage({ seatsUsed: 60 })), 1)).toBe(true);
  });
});
