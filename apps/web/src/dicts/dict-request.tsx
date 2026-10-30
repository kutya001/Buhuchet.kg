'use client';

import {
  bishkekDate,
  DICT_REQUEST_COMMENT_MAX,
  DICT_REQUEST_DICTS,
  DICT_REQUEST_WHAT_MAX,
  formatDateRu,
  type DictRequestDict,
  type DictRequestStatus,
  type StatusTone,
} from '@buhuchet/domain';
import type { DictRequest } from '@buhuchet/shared';
import {
  buttonClass,
  EmptyState,
  Field,
  FormGrid,
  inputClass,
  KeyValues,
  MiniTable,
  Modal,
  StatusPill,
  useToast,
  type IconName,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { dictRequestsQuery } from './dicts-data';

/** Название справочника в «Попросить добавить» и «Моих запросах». */
const dictTitle = (t: Translate, dict: DictRequestDict) => t(`dicts.platform.dict.${dict}`);

/**
 * «Попросить добавить» (прототип modules/dicts.js `requestDlg`): справочник (по умолчанию «Виды
 * отчётов»), «Что добавить» — обязательно, комментарий. Запрос уходит администратору платформы со
 * статусом «Новый»; после отправки — уведомление «Запрос отправлен администратору платформы» со ссылкой
 * «Мои запросы».
 */
function DictRequestDialog({
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
  const [dict, setDict] = useState<DictRequestDict>('types');
  const [what, setWhat] = useState('');
  const [comment, setComment] = useState('');
  const [whatError, setWhatError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const value = what.trim();
    // Только пробелы и невидимые символы — не текст (как проверяет сервер).
    if (!/[^\s\p{Cf}]/u.test(value)) {
      setWhatError(t('dicts.req.what_required'));
      return document.getElementById(`${id}-what`)?.focus();
    }
    setBusy(true);
    const res = await callApi(() =>
      api.api['dict-requests'].$post({ json: { dict, what: value, comment: comment.trim() } }),
    );
    setBusy(false);
    if (!res.ok) {
      // Предел запросов организации за час — под полем «Что добавить» (прототип `reqHour`).
      if (res.error.code === 'dict_request_rate') return setWhatError(errorText(res.error));
      return toast(errorText(res.error), { bad: true, icon: 'alert' });
    }
    void client.invalidateQueries({ queryKey: dictRequestsQuery.queryKey });
    onClose();
    toast(t('dicts.req.sent'), {
      icon: 'send',
      action: { label: t('dicts.req.mine'), run: onMine },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('dicts.req.title')}
      sub={t('dicts.req.sub')}
      dirty={what.trim() !== '' || comment.trim() !== ''}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy}
            onClick={() => void send()}
          >
            {t('dicts.req.send')}
          </button>
        </>
      }
    >
      <FormGrid>
        <Field id={`${id}-dict`} label={t('dicts.req.dict')}>
          {(control) => (
            <select
              {...control}
              className={`${inputClass()} cursor-pointer`}
              value={dict}
              onChange={(e) => setDict(e.target.value as DictRequestDict)}
            >
              {DICT_REQUEST_DICTS.map((d) => (
                <option key={d} value={d}>
                  {dictTitle(t, d)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={`${id}-what`} label={t('dicts.req.what')} required error={whatError}>
          {(control) => (
            <input
              {...control}
              type="text"
              className={inputClass()}
              value={what}
              maxLength={DICT_REQUEST_WHAT_MAX}
              placeholder={t('dicts.req.what_ph')}
              onChange={(e) => {
                setWhat(e.target.value);
                setWhatError(undefined);
              }}
            />
          )}
        </Field>
        <Field id={`${id}-comment`} label={t('dicts.req.comment')} full>
          {(control) => (
            <textarea
              {...control}
              className={`${inputClass({ multiline: true })} min-h-[60px]`}
              value={comment}
              maxLength={DICT_REQUEST_COMMENT_MAX}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </Modal>
  );
}

/** Метка статуса — как у запросов в Админке (прототип admin/platform-dicts.js, вкладка «Запросы»). */
const STATUS_LOOK: Record<DictRequestStatus, { tone: StatusTone; icon: IconName }> = {
  new: { tone: 'yellow', icon: 'circle' },
  added: { tone: 'green', icon: 'check' },
  rejected: { tone: 'faint', icon: 'ban' },
};

const dash = <span className="text-faint">—</span>;
const dateOf = (r: DictRequest) => formatDateRu(bishkekDate(new Date(r.createdAt)));

function statusPill(t: Translate, r: DictRequest) {
  return (
    <StatusPill {...STATUS_LOOK[r.status]} label={t(`dicts.req.status.${r.status}`)} size="sm" />
  );
}

/** Строка «Моих запросов» — столбцы прототипа v59 (`reqCols`): дата, справочник, что просили, комментарий, кто отправил, статус, ответ. */
function requestRow(r: DictRequest, t: Translate) {
  return {
    key: r.id,
    cells: {
      at: dateOf(r),
      dict: dictTitle(t, r.dict),
      what: <b className="font-semibold">{r.what}</b>,
      comment: r.comment || dash,
      by: r.createdBy ?? '',
      status: statusPill(t, r),
      answer: r.answer || dash,
    },
  };
}

/** Запрос целиком, только просмотр (прототип v59 `reqViewDlg`): длинный ответ читается полностью. */
function RequestView({
  open,
  onClose,
  request: r,
}: {
  open: boolean;
  onClose: () => void;
  request: DictRequest;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      title={r.what}
      sub={`${r.orgName} · ${dictTitle(t, r.dict)} · ${dateOf(r)}`}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <KeyValues
        items={[
          { id: 'status', label: t('dicts.req.col.status'), value: statusPill(t, r) },
          { id: 'by', label: t('dicts.req.col.by'), value: r.createdBy ?? '' },
          { id: 'comment', label: t('dicts.req.col.comment'), value: r.comment || '—', wide: true },
          {
            id: 'answer',
            label: t('dicts.req.col.answer'),
            value: r.answer || t('dicts.req.view.no_answer'),
            wide: true,
          },
        ]}
      />
    </Modal>
  );
}

// ОТКЛОНЕНИЕ: docs/deviations.md#46 — решение А: в прототипе своих запросов организация не видит.
/**
 * «Мои запросы» (решение заказчика 27.10.2026, docs/deviations.md п. 46; прототип v59 `myReqDlg`):
 * запросы организации администратору платформы, сначала новые — что просили, статус («Новый»,
 * «Добавлено», «Отклонено») и ответ администратора; строка открывает запрос целиком.
 */
function MyRequestsWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const requests = useQuery(dictRequestsQuery);
  const [viewing, setViewing] = useState<DialogSlot<DictRequest> | null>(null);
  const columns = [
    { key: 'at', label: t('dicts.req.col.at') },
    { key: 'dict', label: t('dicts.req.col.dict') },
    { key: 'what', label: t('dicts.req.col.what') },
    { key: 'comment', label: t('dicts.req.col.comment') },
    { key: 'by', label: t('dicts.req.col.by') },
    { key: 'status', label: t('dicts.req.col.status') },
    { key: 'answer', label: t('dicts.req.col.answer') },
  ];
  const items = requests.data?.items;
  let body: ReactNode;
  if (requests.isError) {
    body = (
      <EmptyState
        icon="alert"
        title={t('grid.load_error')}
        text={t('grid.load_error_text')}
        actions={[
          {
            id: 'retry',
            label: t('grid.retry'),
            icon: 'refresh',
            onClick: () => void requests.refetch(),
          },
        ]}
      />
    );
  } else if (!items) {
    body = <div className="h-24" aria-busy="true" />;
  } else if (items.length === 0) {
    body = <EmptyState icon="send" title={t('dicts.req.empty')} text={t('dicts.req.empty_text')} />;
  } else {
    body = (
      <MiniTable
        columns={columns}
        rows={items.map((r) => requestRow(r, t))}
        empty={t('dicts.req.empty')}
        label={t('dicts.req.mine')}
        onOpen={(key) => {
          const r = items.find((x) => x.id === key);
          if (r) setViewing(openSlot(r));
        }}
      />
    );
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={t('dicts.req.mine')}
      sub={t('dicts.req.mine_sub')}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <div data-dict-requests="">{body}</div>
      {viewing ? (
        <RequestView
          key={`view-${viewing.n}`}
          open={viewing.open}
          onClose={() => setViewing(closeSlot)}
          request={viewing.data}
        />
      ) : null}
    </Modal>
  );
}

/** Окно «Попросить добавить»: открыть заново — пустая форма; `onMine` — ссылка «Мои запросы» в уведомлении. */
export function useDictRequest(onMine: () => void): { open: () => void; dialog: ReactNode } {
  const [slot, setSlot] = useState<DialogSlot<null> | null>(null);
  return {
    open: () => setSlot(openSlot(null)),
    dialog: slot ? (
      <DictRequestDialog
        key={`request-${slot.n}`}
        open={slot.open}
        onClose={() => setSlot(closeSlot)}
        onMine={onMine}
      />
    ) : null,
  };
}

/** Окно «Мои запросы». */
export function useMyRequests(): { open: () => void; dialog: ReactNode } {
  const [slot, setSlot] = useState<DialogSlot<null> | null>(null);
  return {
    open: () => setSlot(openSlot(null)),
    dialog: slot ? (
      <MyRequestsWindow
        key={`requests-${slot.n}`}
        open={slot.open}
        onClose={() => setSlot(closeSlot)}
      />
    ) : null,
  };
}
