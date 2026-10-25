import { bishkekDate, type IsoDate } from '@buhuchet/domain';

/** Источник времени. Всё, что зависит от «сейчас», получает Clock параметром. */
export interface Clock {
  now(): Date;
  /** Сегодняшняя дата по Бишкеку. */
  today(): IsoDate;
}

export const systemClock: Clock = {
  now: () => new Date(),
  today: () => bishkekDate(new Date()),
};

export interface FixedClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

/** Часы, стоящие на месте: тесты, демо-стенд (в прототипе демо-дата — 18.10.2026). */
export function fixedClock(iso: string): FixedClock {
  let current = new Date(iso);
  if (Number.isNaN(current.getTime())) throw new RangeError(`Не дата и время: ${iso}`);
  return {
    now: () => new Date(current.getTime()),
    today: () => bishkekDate(current),
    set(next) {
      current = new Date(next);
    },
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
  };
}

/** Часы по настройкам: `FIXED_NOW` задан — фиксированные, иначе системные. */
export function clockFromConfig(config: { FIXED_NOW?: string | undefined }): Clock {
  return config.FIXED_NOW ? fixedClock(config.FIXED_NOW) : systemClock;
}
