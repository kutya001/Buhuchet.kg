import { z } from 'zod';

/*
 * Места в пакете (доработки 20.11.2026, блок 3, пункт 1; прототип v152 seatInfo, seatDlg): сколько
 * занято и сколько свободно; `owner` — спрашивает владелец: у него «Расширить пакет», у сотрудника —
 * «Обратитесь к владельцу организации». `seats: null` — предела нет (демо-организация, нет подписки).
 */
export const SeatCounts = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  free: z.number().int().nonnegative(),
});
export type SeatCounts = z.infer<typeof SeatCounts>;

export const ContractorSeats = z.object({
  seats: SeatCounts.nullable(),
  owner: z.boolean(),
});
export type ContractorSeats = z.infer<typeof ContractorSeats>;

/** Подробности отказа 409 `no_seats` (как в ответе сервера). */
export const NoSeatsDetails = SeatCounts.extend({
  need: z.number().int().positive(),
  owner: z.boolean(),
});
export type NoSeatsDetails = z.infer<typeof NoSeatsDetails>;
