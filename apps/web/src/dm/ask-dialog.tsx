'use client';

import { DICT_REQUEST_COMMENT_MAX, DICT_REQUEST_WHAT_MAX } from '@buhuchet/domain';
import { buttonClass, Field, FormGrid, inputClass, Modal, useToast } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useMyRequests } from '../dicts/dict-request';
import { dictRequestsQuery } from '../dicts/dicts-data';
import { useErrorText, useT } from '../l10n/provider';

/**
 * «Попросить шаблон» (доработки 20.11.2026: Витрина данных, блок 3, пункт 4; прототип v155 `dmAskDlg`):
 * запрос как «Попросить добавить» «Справочников» — справочник «Витрина данных», «Какого отчёта не
 * хватает» обязательно и «Какие столбцы и за какой период». Запрос уходит администратору платформы,
 * ответ — в «Мои запросы».
 */
function AskDialog({
  open,
  onClose,
  onMine,
}: {
  open: boolean;
  onClose: () => void;
  onMine: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const [what, setWhat] = useState('');
  const [cols, setCols] = useState('');
  const [whatError, setWhatError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const value = what.trim();
    // Только пробелы и невидимые знаки — не текст (как проверяет сервер).
    if (!/[^\s\p{Cf}]/u.test(value)) {
      setWhatError(t('dm.ask.what_req'));
      return document.getElementById(`${id}-what`)?.focus();
    }
    setBusy(true);
    const res = await callApi(() =>
      api.api['dict-requests'].$post({
        json: { dict: 'dm', what: value, comment: cols.trim() },
      }),
    );
    setBusy(false);
    if (!res.ok) {
      // Предел запросов организации за час — под полем (прототип `reqHour`).
      if (res.error.code === 'dict_request_rate') return setWhatError(errorText(res.error));
      return toast(errorText(res.error), { bad: true, icon: 'alert' });
    }
    void client.invalidateQueries({ queryKey: dictRequestsQuery.queryKey });
    onClose();
    toast(t('dm.ask.sent'), {
      icon: 'send',
      action: { label: t('dicts.req.mine'), run: onMine },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('dm.ask.title')}
      sub={t('dm.ask.sub')}
      dirty={what.trim() !== '' || cols.trim() !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy}
            data-dm-ask-send=""
            onClick={() => void send()}
          >
            {t('dm.ask.send')}
          </button>
        </>
      }
    >
      <div data-dm-ask="">
        <FormGrid>
          <Field id={`${id}-what`} label={t('dm.ask.what')} required error={whatError} full>
            {(control) => (
              <input
                {...control}
                type="text"
                className={inputClass()}
                value={what}
                maxLength={DICT_REQUEST_WHAT_MAX}
                placeholder={t('dm.ask.what_ph')}
                onChange={(e) => {
                  setWhat(e.target.value);
                  setWhatError(undefined);
                }}
              />
            )}
          </Field>
          <Field id={`${id}-cols`} label={t('dm.ask.cols')} full>
            {(control) => (
              <textarea
                {...control}
                className={`${inputClass({ multiline: true })} min-h-[70px]`}
                value={cols}
                maxLength={DICT_REQUEST_COMMENT_MAX}
                placeholder={t('dm.ask.cols_ph')}
                onChange={(e) => setCols(e.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      </div>
    </Modal>
  );
}

/** Окно «Попросить шаблон» и «Мои запросы» после отправки: `open()` и окна — в разметку экрана. */
export function useDmAsk(): { open: () => void; dialog: ReactNode } {
  const [slot, setSlot] = useState<DialogSlot<null> | null>(null);
  const mine = useMyRequests();
  return {
    open: () => setSlot(openSlot(null)),
    dialog: (
      <>
        {slot ? (
          <AskDialog
            key={`dm-ask-${slot.n}`}
            open={slot.open}
            onClose={() => setSlot(closeSlot)}
            onMine={mine.open}
          />
        ) : null}
        {mine.dialog}
      </>
    ),
  };
}
