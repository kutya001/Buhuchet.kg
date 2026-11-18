'use client';

import { bishkekTime, fileSizeParts, formatMomentRu } from '@buhuchet/domain';
import {
  AdminTelegramMessage,
  type AdminTelegramLogRow,
  type AdminTelegramMessageBody,
  type AdminTelegramView,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Icon,
  KeyValues,
  linkButtonClass,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  Timeline,
  useToast,
  type KeyValueItem,
  type TimelineItem,
} from '@buhuchet/ui';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { api, apiFailure, ApiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { BUBBLE, ChatTable, SIDE } from './bot-chat';
import { errorOf, kindText, rowText, STATUS_PILL } from './tgadm-log-model';
import { retryRefusal } from './tgadm-menu';

export const journalMessageQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'tg-message', id],
    queryFn: async () => {
      const res = await api.api.admin.telegram.log[':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return AdminTelegramMessage.parse(await res.json());
    },
  });

const DASH = <span className="text-faint">—</span>;
/** Пузырь человека: справа, как своё сообщение в Telegram (прототип `.tgc-m.me`). */
const ME_SIDE = 'flex max-w-[min(440px,100%)] min-w-0 flex-col gap-1 self-end max-md:max-w-full';
const ME_BUBBLE =
  'min-w-0 rounded-[14px_14px_4px_14px] border border-line bg-sel px-[11px] py-2 text-[13.5px] leading-[1.45] [overflow-wrap:anywhere]';
const TIME = 'mt-0.5 block text-right text-[11px] text-faint';
const KEY =
  'flex min-w-0 flex-[1_1_0] items-center justify-center gap-[5px] rounded-lg border border-line bg-btn px-2 py-[7px] text-center text-[12.5px] font-semibold text-ink max-md:flex-[1_1_40%]';

export function JournalStatusPill({
  t,
  status,
}: {
  t: Translate;
  status: AdminTelegramLogRow['status'];
}) {
  const pill = STATUS_PILL[status];
  return (
    <Pill tone={pill.tone} {...(pill.icon ? { icon: pill.icon } : {})}>
      {t(`tgadm.st.${status}`)}
    </Pill>
  );
}

/** Сообщение бота, как его видит человек: заголовок, текст, таблицы и кнопки; нажатая кнопка отмечена. */
function BotBubble({
  t,
  view,
  text,
  at,
}: {
  t: Translate;
  view: AdminTelegramView | null;
  text: string;
  at: string;
}) {
  const buttons = view?.buttons ?? [];
  return (
    <div className={SIDE} data-chat-message="">
      <div className={BUBBLE}>
        {view ? (
          <>
            {view.heading ? (
              <p className="m-0 mb-0.5 font-bold whitespace-pre-wrap">{view.heading}</p>
            ) : null}
            {view.sub ? (
              <p className="m-0 mb-1 text-[12.5px] whitespace-pre-wrap text-muted">{view.sub}</p>
            ) : null}
            {view.text ? <p className="m-0 whitespace-pre-wrap">{view.text}</p> : null}
            {(view.tables ?? []).map((table, i) => (
              <ChatTable key={i} table={table} />
            ))}
          </>
        ) : (
          <p className="m-0 whitespace-pre-wrap">{text}</p>
        )}
        <span className={TIME}>{at}</span>
      </div>
      {buttons.length ? (
        <div className="flex flex-col gap-1">
          {buttons.map((row, r) => (
            <div key={r} className="flex gap-1 max-md:flex-wrap">
              {row.map((b, c) => (
                <span
                  key={c}
                  data-chat-key=""
                  data-pressed={b.pressed ? '' : undefined}
                  title={b.pressed ? t('tgadm.msg.pressed') : undefined}
                  className={`${KEY}${b.pressed ? ' border-accent bg-sel' : b.off ? ' bg-pane-alt opacity-55' : ''}`}
                >
                  {b.pressed ? (
                    <Icon name="check" size="sm" />
                  ) : b.kind === 'copy' ? (
                    <Icon name="copy" size="sm" />
                  ) : b.kind === 'url' ? (
                    <Icon name="link" size="sm" />
                  ) : null}
                  <span>{b.text}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Что прислал человек: нажатие («Нажата кнопка «…»»), файл с подписью или текст. */
function MeBubble({ t, m }: { t: Translate; m: AdminTelegramMessageBody }) {
  const at = bishkekTime(new Date(m.at));
  let body: ReactNode;
  if (m.kind === 'in_press') {
    body = m.button ? t('tgadm.txt.press', { name: m.button }) : t('tgadm.txt.press_any');
  } else if (m.file) {
    const size = m.file.size === null ? null : fileSizeParts(m.file.size);
    body = (
      <>
        <span data-no-gloss="" className="flex items-center gap-1.5 font-semibold">
          <Icon name="file" size="sm" />
          {m.file.name ?? t('tgadm.txt.photo')}
          {size ? (
            <span className="font-normal text-muted">
              {t(`files.size.${size.unit}`, { n: size.value })}
            </span>
          ) : null}
        </span>
        {m.fullText ? <span className="mt-1 block whitespace-pre-wrap">{m.fullText}</span> : null}
      </>
    );
  } else {
    body = <span className="whitespace-pre-wrap">{m.fullText ?? kindText(t, m.kind)}</span>;
  }
  return (
    <div className={ME_SIDE} data-chat-me="">
      <div className={ME_BUBBLE}>
        {body}
        <span className={TIME}>{at}</span>
      </div>
    </div>
  );
}

/** Вид чата (прототип `tgcHtml` в `.tgl-view`): сообщение бота и под ним — что прислал человек. */
function ChatView({ t, data }: { t: Translate; data: AdminTelegramMessage }) {
  const m = data.message;
  const incoming = m.dir === 'in';
  const bot = incoming ? data.bot : m;
  const group = m.chatKind === 'group';
  const showBot = bot && !bot.hide && (bot.view || bot.fullText || bot.text);
  const showMe = incoming && !m.hide;
  if (!showBot && !showMe) return null;
  return (
    <div
      data-tg-chat=""
      className="flex max-w-[460px] min-w-0 flex-col gap-2 rounded-[10px] border border-line bg-pane-alt p-3"
    >
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-info-btn text-[12px] font-bold text-on-accent">
          B
        </span>
        <b className="min-w-0 text-ink [overflow-wrap:anywhere]">
          {group ? m.recipient : 'Buhuchet.kg'}
        </b>
        <span>{t(group ? 'tgadm.msg.group' : 'tgadm.chat.bot')}</span>
      </div>
      {showBot ? (
        <BotBubble
          t={t}
          view={bot.view}
          text={bot.fullText ?? bot.text ?? ''}
          at={bishkekTime(new Date(bot.at))}
        />
      ) : null}
      {showMe ? <MeBubble t={t} m={m} /> : null}
    </div>
  );
}

export interface JournalMessageHandlers {
  /** Открыть другое сообщение журнала (соседнее или связанное). */
  onOpen: (id: string) => void;
  /** «Вся переписка» чата этого сообщения. */
  onChat: (row: AdminTelegramLogRow) => void;
  onRetry: (row: AdminTelegramLogRow) => void;
  onAccount: (userId: string) => void;
  onOrg: (orgId: string) => void;
}

function MessageBody({
  data,
  onClose,
  onOpen,
  onAccount,
  onOrg,
}: { data: AdminTelegramMessage; onClose: () => void } & Pick<
  JournalMessageHandlers,
  'onOpen' | 'onAccount' | 'onOrg'
>) {
  const t = useT();
  const m = data.message;
  const incoming = m.dir === 'in';
  const error = errorOf(t, m);
  const info: KeyValueItem[] = [
    {
      id: 'who',
      label: t('tgadm.msg.me'),
      value: m.userId ? (
        <button
          type="button"
          data-tg-who=""
          className={linkButtonClass()}
          onClick={() => {
            const id = m.userId;
            onClose();
            if (id) onAccount(id);
          }}
        >
          {m.recipient}
        </button>
      ) : (
        m.recipient
      ),
    },
    {
      id: 'org',
      label: t('tgadm.col.org'),
      value: m.orgId ? (
        <button
          type="button"
          data-tg-org=""
          className={linkButtonClass()}
          onClick={() => {
            const id = m.orgId;
            onClose();
            if (id) onOrg(id);
          }}
        >
          {m.orgName}
        </button>
      ) : (
        (m.orgName ?? t('tgadm.org.platform'))
      ),
    },
    { id: 'ct', label: t('tgadm.col.ct'), value: t(`tgadm.ct.${m.chatKind}`) },
    ...(incoming ? [] : [{ id: 'tries', label: t('tgadm.col.tries'), value: String(m.tries) }]),
    {
      id: 'err',
      label: t('tgadm.col.err'),
      value: error ? <span className={MONO_CLASS}>{error}</span> : DASH,
    },
  ];
  const link = (y: AdminTelegramMessageBody, lead: string): TimelineItem => {
    const at = formatMomentRu(new Date(y.at));
    return {
      id: y.id,
      date: at.slice(0, 10),
      time: at.slice(11),
      text: (
        <>
          {lead ? `${lead} ` : ''}
          {y.dir === 'in' ? '← ' : '→ '}
          <button
            type="button"
            data-tg-related={y.id}
            className={linkButtonClass()}
            onClick={() => onOpen(y.id)}
          >
            {kindText(t, y.kind)}
          </button>
        </>
      ),
      who: rowText(t, y).slice(0, 90),
    };
  };
  const related = [
    ...(incoming && data.bot ? [link(data.bot, t('tgadm.msg.rel_bot'))] : []),
    ...data.replies.map((y) => link(y, '')),
  ];
  return (
    <>
      {m.hide ? (
        <Note icon="eyeoff">
          {t(incoming ? 'tgadm.msg.hidden' : 'tgadm.msg.hidden_out', {
            why: t(`tgadm.hide.${m.hide}`),
          })}
        </Note>
      ) : null}
      <ChatView t={t} data={data} />
      {!incoming && m.view?.image ? <Note icon="image">{t('tgadm.msg.image')}</Note> : null}
      <Box>
        <KeyValues items={info} />
      </Box>
      {related.length ? (
        <Box title={t('tgadm.msg.related')}>
          <Timeline items={related} label={t('tgadm.msg.related')} />
        </Box>
      ) : null}
    </>
  );
}

/**
 * Окно «Сообщение» журнала «Телеграм» (решение заказчика 17.11.2026; прототип v132 admin/tg-log.js
 * `tgMsgDlg`): сообщение в виде чата — отправленное, как его видит человек (таблицы, кнопки, нажатая
 * отмечена), полученное — пузырём человека под сообщением бота, к которому оно относится; собеседник и
 * организация — ссылки на их карточки; связанные сообщения; «Раньше» и «Позже» — соседние сообщения того
 * же чата. У кода и одноразовой ссылки текста нет: в журнал они не пишутся.
 */
function JournalMessage({
  id,
  open,
  onClose,
  onOpen,
  onChat,
  onRetry,
  onAccount,
  onOrg,
}: { id: string; open: boolean; onClose: () => void } & JournalMessageHandlers) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const query = useQuery(journalMessageQuery(id));
  const data = query.data;
  const m = data?.message;
  const missing = query.error instanceof ApiFailure && query.error.status === 404;
  const refusal = m ? retryRefusal(t, m) : '';
  let sub: ReactNode;
  if (m) {
    sub = (
      <>
        {t(m.dir === 'in' ? 'tgadm.msg.in' : 'tgadm.msg.out')} · {formatMomentRu(new Date(m.at))} ·{' '}
        <JournalStatusPill t={t} status={m.status} />
      </>
    );
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={m ? kindText(t, m.kind) : t('tgadm.menu.open')}
      sub={sub}
      footer={
        <>
          <button
            type="button"
            data-tg-prev=""
            className={buttonClass()}
            disabled={!data?.prevId}
            onClick={() => data?.prevId && onOpen(data.prevId)}
          >
            <Icon name="left" size="sm" />
            {t('tgadm.msg.prev')}
          </button>
          <button
            type="button"
            data-tg-next=""
            className={buttonClass()}
            disabled={!data?.nextId}
            onClick={() => data?.nextId && onOpen(data.nextId)}
          >
            {t('tgadm.msg.next')}
            <Icon name="right" size="sm" />
          </button>
          <button
            type="button"
            data-tg-all=""
            className={buttonClass('ghost')}
            disabled={!m}
            onClick={() => {
              if (!m) return;
              onClose();
              onChat(m);
            }}
          >
            <Icon name="chat" size="sm" />
            {t('tgadm.menu.chat')}
          </button>
          <div className="flex-1" />
          {m && m.dir === 'out' ? (
            <button
              type="button"
              data-tg-retry=""
              className={`${buttonClass()}${refusal ? ' opacity-55' : ''}`}
              aria-disabled={refusal ? true : undefined}
              title={refusal || undefined}
              onClick={() => {
                if (refusal) return toast(refusal, { icon: 'lock', bad: true });
                onClose();
                onRetry(m);
              }}
            >
              <Icon name="refresh" size="sm" />
              {t('tgadm.retry')}
            </button>
          ) : null}
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.close')}
          </button>
        </>
      }
    >
      <div data-tg-message={id} className="flex min-w-0 flex-col gap-2.5">
        {query.isError ? (
          <Note tone="bad">
            {missing
              ? t('tgadm.msg.missing')
              : query.error instanceof ApiFailure
                ? errorText(query.error.error)
                : t('err.unknown')}
          </Note>
        ) : null}
        {data ? (
          <MessageBody
            data={data}
            onClose={onClose}
            onOpen={onOpen}
            onAccount={onAccount}
            onOrg={onOrg}
          />
        ) : null}
      </div>
    </Modal>
  );
}

/** Окно «Сообщение» для экрана: `open(id)` открывает его заново (другое сообщение заменяет открытое). */
export function useJournalMessage(handlers: Omit<JournalMessageHandlers, 'onOpen'>) {
  const [slot, setSlot] = useState<DialogSlot<string> | null>(null);
  const open = useCallback((id: string) => setSlot(openSlot(id)), []);
  const close = useCallback(() => setSlot(closeSlot), []);
  const node = slot ? (
    <JournalMessage
      key={`tg-message-${slot.n}`}
      id={slot.data}
      open={slot.open}
      onClose={close}
      onOpen={open}
      {...handlers}
    />
  ) : null;
  return { open, node };
}
