import type { SubscriptionStatus } from '../subscriptions/subscriptions';

/*
 * Места в пакете (доработки 20.11.2026, блок 1, пункт 3; блок 3, пункт 1; прототип v152
 * modules/contractors.js — seatInfo, seatOk; core/subs.js — subSeats): место занимает каждый
 * контрагент, кроме «В архиве»; пакет заполнен — новый активный контрагент не добавляется ни формой
 * «Новый контрагент» (и «Из свидетельства и выписки»), ни загрузкой из Excel, ни «Вернуть из архива».
 */

/** То, что нужно правилу из «занято мест и памяти» (`orgUsage` базы). */
export interface SeatUsage {
  demo: boolean;
  status: SubscriptionStatus;
  seatsUsed: number;
  seatsLimit: number | null;
}

export interface Seats {
  used: number;
  limit: number;
  free: number;
}

/**
 * Места организации; null — предела нет. У демо-организации пакета нет (блок 4, пункт 8; прототип
 * `SUBS_DEMO`). Без подписки («Нет подписки») доступ организации закрыт целиком (блок 4, пункт 5) —
 * это проверяет вход, а не места: пакет 0 не должен прятать причину за «нет свободных мест».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-23
export function seatsOf(usage: SeatUsage | null): Seats | null {
  if (!usage || usage.demo || usage.seatsLimit === null || usage.status === 'none') return null;
  return {
    used: usage.seatsUsed,
    limit: usage.seatsLimit,
    free: Math.max(0, usage.seatsLimit - usage.seatsUsed),
  };
}

/** Не хватает мест на `need` новых активных контрагентов (прототип `seatOk(need)`). */
export const seatsShort = (seats: Seats | null, need: number): boolean =>
  seats !== null && need > 0 && seats.free < need;
