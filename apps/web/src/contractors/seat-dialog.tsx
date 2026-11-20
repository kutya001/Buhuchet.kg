'use client';

import { ContractorSeats, NoSeatsDetails } from '@buhuchet/shared';
import { buttonClass, Icon, Modal, Note, useWindow } from '@buhuchet/ui';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, apiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';

/*
 * Места в пакете (доработки 20.11.2026, блок 3, пункт 1; этап 1, П8; прототип v152 seatOk, seatDlg,
 * seatGrow): пакет заполнен — вместо формы «Новый контрагент», «Из свидетельства и выписки» и
 * «Вернуть из архива» окно «В пакете нет свободных мест». У владельца — «Расширить пакет»: экран
 * «Подписка» «Моей организации» сразу с окном расширения (`?pay=grow`, экран потока И); у сотрудника —
 * «Обратитесь к владельцу организации». Правило держит сервер (`no_seats`), экран только спрашивает
 * заранее, чтобы человек не заполнял форму зря.
 */

/** Экран «Подписка» с окном «Расширить пакет» (поток И, этап 1, П7: параметр `pay`). */
export const SEAT_GROW_HREF = '/app/org/sub?pay=grow';

/** Места в пакете сейчас — всегда свежие: спрашиваются перед формой. */
export const seatsQuery = queryOptions({
  queryKey: ['contractors', 'seats'],
  queryFn: async () => {
    const res = await api.api.contractors.seats.$get();
    if (!res.ok) throw await apiFailure(res);
    return ContractorSeats.parse(await res.json());
  },
  staleTime: 0,
});

type SeatWindow = Pick<NoSeatsDetails, 'used' | 'limit' | 'owner'>;

export function useSeatGuard() {
  const t = useT();
  const client = useQueryClient();
  const [slot, setSlot] = useState<DialogSlot<SeatWindow> | null>(null);
  const close = () => setSlot(closeSlot);

  /**
   * Хватает ли мест на `need` новых активных контрагентов: нет — окно и `false`. Не удалось спросить —
   * `true`: сервер всё равно откажет при сохранении, а окно покажет `fromError`.
   */
  const ask = async (need = 1): Promise<boolean> => {
    const now = await client.fetchQuery(seatsQuery).catch(() => null);
    if (!now?.seats || now.seats.free >= need) return true;
    setSlot(openSlot({ used: now.seats.used, limit: now.seats.limit, owner: now.owner }));
    return false;
  };

  /** Ответ сервера «нет свободных мест» — окно и `true`; другая ошибка — `false`. */
  const fromError = (error: { code: string; details?: unknown }): boolean => {
    if (error.code !== 'no_seats') return false;
    const d = NoSeatsDetails.safeParse(error.details);
    if (!d.success) return false;
    setSlot(openSlot({ used: d.data.used, limit: d.data.limit, owner: d.data.owner }));
    void client.invalidateQueries({ queryKey: seatsQuery.queryKey });
    return true;
  };

  const node = slot ? (
    <Modal
      key={`seats-${slot.n}`}
      open={slot.open}
      onClose={close}
      title={t('cp.seat.title')}
      kind="message"
      noMax
      footer={
        slot.data.owner ? (
          <>
            <button type="button" className={buttonClass('ghost')} onClick={close}>
              {t('btn.close')}
            </button>
            <SeatGrowButton className={buttonClass('cta')} icon />
          </>
        ) : (
          <button type="button" data-seat-ok="" className={buttonClass('cta')} onClick={close}>
            {t('cp.seat.ok')}
          </button>
        )
      }
    >
      <div data-seat-full="" className="flex flex-col gap-3">
        <p className="m-0 leading-[1.55] text-muted">
          {`${t('err.no_seats', { used: slot.data.used, limit: slot.data.limit })}.`}
        </p>
        {slot.data.owner ? null : <Note>{t('cp.seat.ask_owner')}</Note>}
      </div>
    </Modal>
  ) : null;

  return { ask, fromError, node };
}

/**
 * «Расширить пакет» внутри окна: окно закрывается перед переходом с заменой записи истории — «Назад» не
 * вернёт к нему. Окна под ним (форма, загрузка) уходят вместе с экраном контрагентов.
 */
export function SeatGrowButton({ className, icon = false }: { className: string; icon?: boolean }) {
  const t = useT();
  const router = useRouter();
  const { leave } = useWindow();
  return (
    <button
      type="button"
      data-seat-grow=""
      className={className}
      onClick={() => {
        leave();
        router.replace(SEAT_GROW_HREF);
      }}
    >
      {icon ? <Icon name="plus" size="sm" /> : null}
      {t('cp.seat.grow')}
    </button>
  );
}
