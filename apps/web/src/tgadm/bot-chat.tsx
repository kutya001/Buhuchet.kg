'use client';

import {
  botPlainText,
  findBotButton,
  pressBotButton,
  type BotButton,
  type BotMessage,
  type BotTable,
} from '@buhuchet/domain';
import { Icon, useToast } from '@buhuchet/ui';
import { Fragment, type ReactNode } from 'react';
import { useT } from '../l10n/provider';

/*
 * Макет чата бота (поток Т, задача Т1; прототип modules/tg-chat.js — `tgcHtml`, `tgcMsg`, `tgcTable`,
 * стили css/tg-chat.css): так сообщение бота с заголовком, таблицами и кнопками выглядит в Telegram —
 * в виде с таблицами и запасным простым текстом. Строится из того же описания `BotMessage`, что уходит
 * в Telegram. Здесь — только примеры Админки: настоящая переписка идёт в Telegram.
 */

/** Строка макета: метка дня, сообщение бота или скрытый ответ на нажатие («Видно только вам»). */
export type BotChatItem =
  | { kind: 'day'; text: string }
  /** `imageSrc` — адрес картинки для макета (у `message.image` — номер файла в хранилище). */
  | { kind: 'message'; message: BotMessage; at?: string; imageSrc?: string }
  | { kind: 'hidden'; text: string };

/** Что делает действие кнопки в макете: скрытый ответ и новая подпись нажатой кнопки. */
export type BotChatActions = Readonly<
  Record<string, (arg: string | null) => { reply?: string; done?: string; off?: readonly string[] }>
>;

/**
 * Нажатие кнопки-действия в макете — тем же правилом домена, что у бота (`pressBotButton`): кнопка
 * гаснет с новой подписью, скрытый ответ встаёт строкой «Видно только вам». Неизвестное действие и
 * погашенная кнопка список не меняют.
 */
export function pressChatButton(
  list: readonly BotChatItem[],
  index: number,
  button: BotButton,
  actions: BotChatActions,
): readonly BotChatItem[] {
  const item = list[index];
  if (!item || item.kind !== 'message' || !button.action || button.off) return list;
  const arg = button.arg ?? null;
  const run = Object.hasOwn(actions, button.action) ? actions[button.action] : undefined;
  if (!run || !findBotButton(item.message, button.action, arg)) return list;
  const result = run(arg);
  const next = list.map((x, i) =>
    i === index
      ? { ...item, message: pressBotButton(item.message, button.action!, arg, result) }
      : x,
  );
  return result.reply ? [...next, { kind: 'hidden', text: result.reply }] : next;
}

/** Текст с кодом подтверждения: код нажимается и копируется (в Telegram — моноширинный текст). */
function CodeText({
  text,
  code,
  title,
  onCopy,
}: {
  text: string;
  code?: string;
  title: string;
  onCopy: (code: string) => void;
}) {
  if (!code || !text.includes(code)) return <>{text}</>;
  const parts = text.split(code);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <button
              type="button"
              title={title}
              data-chat-code=""
              onClick={() => onCopy(code)}
              className="cursor-pointer rounded-[5px] border border-dashed border-line-strong bg-pane-alt px-[5px] font-mono font-bold tracking-[.04em] text-inherit hover:bg-sel"
            >
              {code}
            </button>
          ) : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

const CELL = 'border-b border-line py-1 pr-1.5 align-top';
const NUM = 'text-right whitespace-nowrap pr-0';

/** Таблица сообщения; у таблицы с названием — раскрывающийся раздел «Название · число строк». */
function ChatTable({ table }: { table: BotTable }) {
  const numeric = new Set(table.numeric ?? []);
  const num = (i: number) => (numeric.has(i) ? ` ${NUM}` : '');
  const body = (
    <table className="mt-1 mb-0.5 w-full border-collapse text-[12.5px]">
      {table.head ? (
        <thead>
          <tr>
            {table.head.map((x, i) => (
              <th
                key={i}
                className={`border-b border-line py-[3px] pr-1.5 text-left text-[11.5px] font-semibold text-muted${num(i)}`}
              >
                {x}
              </th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r} className="[&:last-child>td]:border-b-0">
            {row.map((x, i) => (
              <td key={i} className={`${CELL}${num(i)}`}>
                {x}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {table.foot ? (
        <tfoot>
          <tr>
            {table.foot.map((x, i) => (
              <td key={i} className={`border-t border-line-strong py-1 pr-1.5 font-bold${num(i)}`}>
                {x}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
  if (!table.title) return body;
  return (
    <details
      open={table.open}
      className="group mt-1.5 border-t border-line pt-[5px] first-of-type:border-t-0 first-of-type:pt-0"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold [&::-webkit-details-marker]:hidden">
        {table.title}
        <span className="rounded-full bg-pane-alt px-[7px] text-[11.5px] font-semibold text-muted">
          {table.rows.length}
        </span>
        <span
          aria-hidden="true"
          className="ml-auto text-muted transition-transform duration-150 group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      {body}
    </details>
  );
}

// Отступы между частями сообщения — как `.tgc-b p+p`, `p+.tgc-t`, `.tgc-t+p`, `details+p` прототипа.
const BUBBLE =
  'min-w-0 rounded-[14px_14px_14px_4px] border border-line bg-raised px-[11px] py-2 text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] [&_details+p]:mt-1.5 [&_p+p]:mt-1.5 [&_p+table]:mt-1.5 [&_table+p]:mt-1.5';
const SIDE = 'flex max-w-[min(440px,100%)] min-w-0 flex-col gap-1 self-start max-md:max-w-full';

/**
 * Окно чата: шапка «Buhuchet.kg · бот», сообщения и кнопки под ними. `plain` — запасной простой текст
 * (кнопки остаются). Копирование кода и текста кнопки — в буфер обмена; нажатие кнопки-действия —
 * `onPress` (макет сам решает, что ответить).
 */
export function BotChat({
  who,
  list,
  plain,
  onPress,
}: {
  who: string;
  list: readonly BotChatItem[];
  plain: boolean;
  onPress: (index: number, button: BotButton) => void;
}) {
  const t = useT();
  const toast = useToast();
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('tgadm.chat.code_copied'), { icon: 'copy' });
    } catch {
      // Буфер обмена недоступен (нет разрешения): код виден, его можно выделить.
    }
  };
  const press = (index: number, button: BotButton) => {
    if (button.copy) return void copy(button.copy);
    if (button.url) return toast(t('tgadm.chat.open_url', { url: button.url }), { icon: 'link' });
    if (button.action) onPress(index, button);
  };

  const body = (m: BotMessage): ReactNode => {
    const code = (text: string) => (
      <CodeText
        text={text}
        code={m.code}
        title={t('tgadm.chat.copy_title')}
        onCopy={(c) => void copy(c)}
      />
    );
    if (plain) return <p className="m-0 whitespace-pre-wrap">{code(botPlainText(m))}</p>;
    return (
      <>
        {m.heading ? <p className="m-0 mb-0.5 font-bold whitespace-pre-wrap">{m.heading}</p> : null}
        {m.sub ? (
          <p className="m-0 mb-1 text-[12.5px] whitespace-pre-wrap text-muted">{m.sub}</p>
        ) : null}
        {m.text ? <p className="m-0 whitespace-pre-wrap">{code(m.text)}</p> : null}
        {(m.tables ?? []).map((table, i) => (
          <ChatTable key={i} table={table} />
        ))}
      </>
    );
  };

  return (
    <div
      data-bot-chat=""
      className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-line bg-pane-alt p-3"
    >
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-info-btn text-[12px] font-bold text-on-accent">
          B
        </span>
        <b className="text-ink">{who}</b>
        <span>{t('tgadm.chat.bot')}</span>
      </div>
      {list.map((item, index) => {
        if (item.kind === 'day') {
          return (
            <span
              key={index}
              className="self-center rounded-full border border-line bg-pane px-2.5 py-px text-[11.5px] text-muted"
            >
              {item.text}
            </span>
          );
        }
        if (item.kind === 'hidden') {
          return (
            <div
              key={index}
              role="status"
              data-chat-hidden=""
              className="max-w-[min(440px,100%)] self-start rounded-xl border border-dashed border-line-strong bg-pane px-[11px] py-[7px] text-[12.5px] leading-[1.4] max-md:max-w-full"
            >
              <b className="mb-0.5 flex items-center gap-[5px] text-[11px] font-semibold text-muted">
                <Icon name="eyeoff" size="sm" />
                {t('tgadm.chat.hidden')}
              </b>
              {item.text}
            </div>
          );
        }
        const m = item.message;
        return (
          <div key={index} className={SIDE} data-chat-message="">
            <div className={BUBBLE}>
              {item.imageSrc ? (
                // Картинка рассылки (задача Т6) — над подписью, как в Telegram.
                <img
                  src={item.imageSrc}
                  alt=""
                  data-chat-image=""
                  className="-mx-[11px] -mt-2 mb-1.5 block max-h-[260px] w-[calc(100%+22px)] max-w-none rounded-t-[13px] object-cover"
                />
              ) : null}
              {body(m)}
              {item.at ? (
                <span className="mt-0.5 block text-right text-[11px] text-faint">{item.at}</span>
              ) : null}
            </div>
            {(m.buttons ?? []).length ? (
              <div className="flex flex-col gap-1">
                {(m.buttons ?? []).map((row, r) => (
                  <div key={r} className="flex gap-1 max-md:flex-wrap">
                    {row.map((b, c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={b.off}
                        onClick={() => press(index, b)}
                        className="flex min-w-0 flex-[1_1_0] cursor-pointer items-center justify-center gap-[5px] rounded-lg border border-line bg-btn px-2 py-[7px] text-center text-[12.5px] font-semibold text-ink hover:bg-btn-hover disabled:cursor-default disabled:bg-pane-alt disabled:opacity-55 max-md:flex-[1_1_40%]"
                      >
                        {b.copy ? (
                          <Icon name="copy" size="sm" />
                        ) : b.url ? (
                          <Icon name="link" size="sm" />
                        ) : b.action ? (
                          <Icon name="check" size="sm" />
                        ) : null}
                        <span>{b.text}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
