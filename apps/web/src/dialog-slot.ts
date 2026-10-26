/**
 * Окно, которое открывают заново: `n` меняется при каждом открытии (новый `key` — свежие поля),
 * `open: false` — окно закрывается с анимацией и остаётся до следующего открытия.
 */
export interface DialogSlot<T> {
  n: number;
  open: boolean;
  data: T;
}

/** Открыть окно в ячейке заново с новыми данными: `setSlot(openSlot(data))`. */
export const openSlot =
  <T>(data: T) =>
  (prev: DialogSlot<T> | null): DialogSlot<T> => ({ n: (prev?.n ?? 0) + 1, open: true, data });

/** Закрыть окно в ячейке: `setSlot(closeSlot)`. */
export const closeSlot = <T>(prev: DialogSlot<T> | null): DialogSlot<T> | null =>
  prev && { ...prev, open: false };
