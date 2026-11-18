'use client';

import { formatMomentRu } from '@buhuchet/domain';
import type { AdminRunCard, AdminRunRow } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Hint,
  Icon,
  KeyValues,
  linkButtonClass,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  Timeline,
  useWindow,
  type KeyValueItem,
  type TimelineItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { ApiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useCopyText } from '../kb/video/video-copy';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { tabHref } from '../shell/modules';
import { requestJournalMessage } from '../tgadm/tgadm-log-store';
import { runCardQuery } from './runs-data';
import { attemptStamp, durationText, momentWithSeconds, RUN_PILL, tryText } from './runs-model';

const DASH = <span className="text-faint">—</span>;
const NUM = 'tabular-nums';

export function RunStatusPill({ t, status }: { t: Translate; status: AdminRunRow['status'] }) {
  return (
    <Pill tone={RUN_PILL[status].tone} icon={RUN_PILL[status].icon}>
      {t(`runs.st.${status}`)}
    </Pill>
  );
}

/** Сообщение о сбое администраторам: ссылка закрывает окно и открывает журнал «Телеграм» с сообщением. */
function AlertNote({ alert }: { alert: NonNullable<AdminRunCard['alert']> }) {
  const t = useT();
  const router = useRouter();
  const { leave } = useWindow();
  return (
    <Note tone="bad" icon="tg">
      {t('runs.card.alert', { at: formatMomentRu(new Date(alert.at)) })}{' '}
      <button
        type="button"
        data-run-alert=""
        className={linkButtonClass()}
        onClick={() => {
          // Переход из открытого окна — с заменой записи истории: «Назад» не вернёт к окну запуска.
          leave();
          requestJournalMessage(alert.id, alert.at);
          router.replace(tabHref('tg', 'log'));
        }}
      >
        {t('runs.card.alert_open')}
      </button>
    </Note>
  );
}

function RunBody({
  card,
  onOpen,
  onCopy,
}: {
  card: AdminRunCard;
  onOpen: (id: string) => void;
  onCopy: (text: string) => void;
}) {
  const t = useT();
  const r = card.run;
  const info: KeyValueItem[] = [
    {
      id: 'job',
      label: t('runs.col.title'),
      value: (
        <>
          {r.title}
          <Hint>
            <span className={MONO_CLASS}>{r.job}</span>
          </Hint>
        </>
      ),
    },
    { id: 'every', label: t('runs.col.every'), value: card.every ?? DASH },
    {
      id: 'slot',
      label: t('runs.col.slot'),
      value: <span className={NUM}>{formatMomentRu(new Date(r.slot))}</span>,
    },
    {
      id: 'start',
      label: t('runs.col.start'),
      value: <span className={NUM}>{formatMomentRu(new Date(r.startedAt))}</span>,
    },
    {
      id: 'end',
      label: t('runs.col.end'),
      value: r.finishedAt ? (
        <span className={NUM}>{momentWithSeconds(r.finishedAt)}</span>
      ) : (
        t('runs.card.running')
      ),
    },
    { id: 'dur', label: t('runs.col.dur'), value: durationText(t, r.ms) || DASH },
    { id: 'try', label: t('runs.col.tr'), value: tryText(t, r.attempt) },
    { id: 'done', label: t('runs.col.done'), value: r.doneText ?? DASH },
  ];
  const attempts: TimelineItem[] = card.attempts.map((x) => ({
    id: x.id,
    ...attemptStamp(x.startedAt),
    text: (
      <>
        <button
          type="button"
          data-run-attempt={x.id}
          className={linkButtonClass()}
          onClick={() => onOpen(x.id)}
        >
          {t('runs.card.attempt', { try: tryText(t, x.attempt) })}
        </button>
        {' · '}
        <RunStatusPill t={t} status={x.status} />
        {x.error ? (
          <>
            <br />
            <span className={`${MONO_CLASS} text-[12px] text-muted`}>{x.error}</span>
          </>
        ) : null}
      </>
    ),
    who: '',
  }));
  return (
    <>
      <Box>
        <KeyValues items={info} />
      </Box>
      {r.error ? (
        <Box title={t('runs.card.error')}>
          <pre
            data-run-error=""
            className={`${MONO_CLASS} m-0 rounded-lg bg-danger-bg px-2.5 py-2 text-[12.5px] [overflow-wrap:anywhere] whitespace-pre-wrap`}
          >
            {r.error}
          </pre>
          <div className="flex">
            <button
              type="button"
              className={buttonClass('default', 'sm')}
              onClick={() => onCopy(r.error ?? '')}
            >
              <Icon name="copy" size="sm" />
              {t('runs.card.copy')}
            </button>
          </div>
        </Box>
      ) : null}
      {attempts.length ? (
        <Box title={t('runs.card.attempts')}>
          <Timeline items={attempts} label={t('runs.card.attempts')} />
          <Hint>{t('runs.card.attempts_hint')}</Hint>
        </Box>
      ) : null}
      {card.alert ? <AlertNote alert={card.alert} /> : null}
    </>
  );
}

/**
 * Окно «Запуск» (прототип v132 admin/runs.js `runDlg`): всё о попытке запуска, текст ошибки с
 * «Скопировать», другие попытки того же запуска и сообщение о сбое администраторам. Только просмотр.
 */
function RunCard({
  id,
  open,
  onClose,
  onOpen,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const query = useQuery(runCardQuery(id));
  const copier = useCopyText();
  const card = query.data;
  const r = card?.run;
  const missing = query.error instanceof ApiFailure && query.error.status === 404;
  let sub: ReactNode;
  if (r) {
    sub = (
      <>
        <RunStatusPill t={t} status={r.status} /> · {formatMomentRu(new Date(r.startedAt))} ·{' '}
        {t('runs.card.sub', { try: tryText(t, r.attempt) })}
      </>
    );
  }
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        kind="card"
        size="mid"
        title={r?.title ?? t('runs.menu.open')}
        sub={sub}
        footer={
          <>
            <div className="flex-1" />
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('btn.close')}
            </button>
          </>
        }
      >
        <div data-run-card={id} className="flex min-w-0 flex-col gap-2.5">
          {query.isError ? (
            <Note tone="bad">
              {missing
                ? t('runs.card.missing')
                : query.error instanceof ApiFailure
                  ? errorText(query.error.error)
                  : t('err.unknown')}
            </Note>
          ) : null}
          {card ? (
            <RunBody
              card={card}
              onOpen={onOpen}
              onCopy={(text) => void copier.copy(text, t('runs.card.copied'))}
            />
          ) : null}
        </div>
      </Modal>
      {copier.node}
    </>
  );
}

/** Окно «Запуск» для экрана: `open(id)` открывает его заново (другая попытка заменяет открытую). */
export function useRunCard() {
  const [slot, setSlot] = useState<DialogSlot<string> | null>(null);
  const open = useCallback((id: string) => setSlot(openSlot(id)), []);
  const close = useCallback(() => setSlot(closeSlot), []);
  const node = slot ? (
    <RunCard key={`run-${slot.n}`} id={slot.data} open={slot.open} onClose={close} onOpen={open} />
  ) : null;
  return { open, node };
}
