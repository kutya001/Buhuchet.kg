'use client';

import { ContractorSeats, NoSeatsDetails } from '@buhuchet/shared';
import { buttonClass, Icon, Modal, Note, useToast } from '@buhuchet/ui';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiFailure, ApiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { orgSubQuery } from '../org/sub-data';
import { useSubDialogs } from '../org/sub-dialogs';

/*
 * Места в пакете (доработки 20.11.2026, блок 3, пункт 1; этап 1, П8; прототип v152 seatOk, seatDlg,
 * seatGrow): пакет заполнен — вместо формы «Новый контрагент», «Из свидетельства и выписки» и
 * «Вернуть из архива» окно «В пакете нет свободных мест». У владельца — «Расширить пакет»: окно оплаты
 * экрана «Подписка» (поток И, этап 1, П7: `useSubDialogs`) поверх формы или загрузки из Excel, как
 * `seatGrow` → `subPayDlg('grow')` прототипа, — введённое остаётся; у сотрудника — «Обратитесь к
 * владельцу организации». Правило держит сервер (`no_seats`), экран только спрашивает заранее, чтобы
 * человек не заполнял форму зря.
 */

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
  const sub = useSubDialogs();
  const toast = useToast();
  const errorText = useErrorText();

  /**
   * «Расширить пакет»: окно «В пакете нет свободных мест» закрывается, окно оплаты открывается по
   * свежему экрану «Подписка» (чек уже на проверке — «Дождитесь проверки…», как у кнопки на экране).
   * Места после чека — свежие при следующей проверке (`seatsQuery` всегда спрашивается заново).
   */
  const grow = async () => {
    close();
    try {
      sub.pay(await client.fetchQuery({ ...orgSubQuery, staleTime: 0 }), 'grow');
    } catch (e) {
      toast(errorText(e instanceof ApiFailure ? e.error : { code: 'unknown', message: '' }), {
        bad: true,
        icon: 'alert',
      });
    }
  };

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
            <SeatGrowButton className={buttonClass('cta')} icon onGrow={() => void grow()} />
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

  return {
    ask,
    fromError,
    grow,
    node: (
      <>
        {node}
        {sub.node}
      </>
    ),
  };
}

/** «Расширить пакет» в окне «Нет мест» и в строке мест загрузки из Excel (`useSeatGuard().grow`). */
export function SeatGrowButton({
  className,
  icon = false,
  onGrow,
}: {
  className: string;
  icon?: boolean;
  onGrow: () => void;
}) {
  const t = useT();
  return (
    <button type="button" data-seat-grow="" className={className} onClick={onGrow}>
      {icon ? <Icon name="plus" size="sm" /> : null}
      {t('cp.seat.grow')}
    </button>
  );
}
