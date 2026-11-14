/*
 * Сообщение бота с таблицами и кнопками (поток Т, задача Т1; пакет заказчика 13.11.2026; прототип
 * modules/tg-chat.js — `tgPlain`, `tgcMsg`, `tgPress`). Сообщение — не строка, а описание: заголовок,
 * текст, таблицы (у таблицы с названием — раскрывающийся раздел) и ряды кнопок под сообщением. Из
 * одного описания строятся оба вида: с таблицами (`botRichHtml`) и запасной простой текст
 * (`botPlainText`) — отдельно его никто не пишет. Кнопки под сообщением одинаковы в обоих видах.
 */

/** Кнопка под сообщением: действие (нажатие приходит боту), копирование текста или ссылка. */
export interface BotButton {
  text: string;
  /** Код действия из реестра нажатий; вместе с `arg` уходит в Telegram как данные кнопки. */
  action?: string;
  /** К чему относится действие: идентификатор записи. */
  arg?: string;
  /** Текст, который кнопка копирует (код подтверждения). */
  copy?: string;
  /** Адрес, который кнопка открывает. */
  url?: string;
  /** Кнопка уже нажата или отменена: показывается неактивной, нажатие — «Кнопка устарела». */
  off?: boolean;
}

export interface BotTable {
  /** С названием таблица — раскрывающийся раздел «Название · число строк». */
  title?: string;
  /** Раздел сразу раскрыт. */
  open?: boolean;
  head?: readonly string[];
  rows: readonly (readonly string[])[];
  foot?: readonly string[];
  /**
   * Номера числовых столбцов (с нуля): выравниваются вправо, а в простом тексте идут с названием столбца
   * («Сдать 6»), иначе число в строке непонятно (задача Т3; прототип v100 `tgPlain`).
   */
  numeric?: readonly number[];
  /** Сколько записей всего, когда в таблице показаны не все: счётчик раздела «Название · n». */
  n?: number;
}

/**
 * Бот ждёт ответ на это сообщение (поток Т, задача Т2; прототип v97 `m.ask`, `tgReply`): файл или текст.
 * Ответ получает обработчик действия `action` с записью `arg`. Просьба закрывается принятым ответом,
 * кнопкой «Отмена» или концом дня `day`; без дня она ждёт, пока не ответят, но только ответом именно на
 * это сообщение.
 */
export interface BotAsk {
  action: string;
  arg?: string;
  kind: 'file' | 'text';
  /** День по Бишкеку (`YYYY-MM-DD`), до конца которого бот ждёт ответ. */
  day?: string;
  /** Ответ принят или просьба отменена. */
  off?: boolean;
  /**
   * Сообщение и кнопка, нажатием которой просьба открыта: когда ответ принят, эта кнопка гаснет с новой
   * подписью — как после обычного нажатия.
   */
  src?: { messageId: number; action: string };
}

export interface BotMessage {
  heading?: string;
  sub?: string;
  text?: string;
  /** Код подтверждения в тексте: показывается моноширинным — в Telegram копируется нажатием. */
  code?: string;
  tables?: readonly BotTable[];
  buttons?: readonly (readonly BotButton[])[];
  ask?: BotAsk;
  /**
   * Свой простой текст вместо собранного из описания (задача Т3; прототип v100 `m.plain`): утреннее
   * напоминание в простом виде остаётся прежними строками, а не строками таблиц.
   */
  plain?: string;
  /**
   * Картинка сообщения (оформленная рассылка, задача Т6; прототип v103 `m.img`): номер файла в хранилище
   * платформы. Сообщение уходит картинкой с подписью — заголовок и текст; таблиц у него нет. Картинка
   * остаётся и в простом виде.
   */
  image?: string;
}

/** Номер картинки сообщения — UUID, который выдал сервер при загрузке. */
const IMAGE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Подпись к картинке в Telegram — не длиннее 1024 знаков. */
export const BOT_CAPTION_MAX = 1024;

/** Пределы Telegram: текст простого сообщения, данные и подпись кнопки, текст копирования, столбцы. */
export const BOT_TEXT_MAX = 4096;
export const BOT_RICH_MAX = 32768;
export const BOT_PRESS_DATA_MAX = 64;
export const BOT_BUTTON_TEXT_MAX = 64;
export const BOT_COPY_MAX = 256;
export const BOT_TABLE_COLUMNS_MAX = 20;
/** Строк в таблице сообщения — не больше (прототип v100 `TG_ROWS_MAX`); остальное — «ещё N — на сайте». */
export const BOT_TABLE_ROWS_MAX = 20;
/**
 * Название контрагента в ячейке таблицы — не длиннее (в прототипе не режется): название бывает до 300
 * знаков, а простой текст сообщения с 20 строками должен уместиться в `BOT_TEXT_MAX`.
 */
export const BOT_TABLE_NAME_MAX = 60;
/** Скрытый ответ на нажатие (ответ Telegram на нажатие кнопки) — не длиннее 200 знаков. */
export const BOT_HIDDEN_REPLY_MAX = 200;

/** Данные неактивной кнопки: действие с таким кодом в реестре не бывает. */
export const BOT_PRESS_OFF = 'off';

const ACTION_RE = /^[a-z][A-Za-z0-9]{0,15}$/;
const ARG_RE = /^[A-Za-z0-9_.-]{1,40}$/;

const filled = (cells: readonly string[]) => cells.filter((x) => x !== '' && x != null);

/**
 * Подпись кнопки и ячейка таблицы не длиннее предела: лишнее — многоточием (прототип `tgClip`). Длина —
 * как её считают Telegram и `botMessageProblem` (единицы UTF-16), знак из двух единиц (эмодзи) пополам
 * не режется.
 */
export function botClip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

/**
 * Запасной простой текст: строка таблицы — «• ячейка — ячейка», раздел — «Название · число записей»;
 * число в числовом столбце — с названием столбца («Сдать 6»). У сообщения со своим простым текстом
 * (`plain`) — он.
 */
export function botPlainText(m: BotMessage): string {
  if (m.plain !== undefined) return m.plain;
  const lines: string[] = [];
  if (m.heading) lines.push(m.heading);
  if (m.sub) lines.push(m.sub);
  if (m.text) lines.push(m.text);
  for (const t of m.tables ?? []) {
    const numeric = new Set(t.numeric ?? []);
    const cell = (x: string, i: number) =>
      numeric.has(i) && t.head?.[i] ? `${t.head[i]} ${x}` : x;
    if (t.title) lines.push(`${t.title} · ${t.n ?? t.rows.length}`);
    for (const row of t.rows) {
      lines.push(
        `• ${row.flatMap((x, i) => (x === '' || x == null ? [] : [cell(x, i)])).join(' — ')}`,
      );
    }
    if (t.foot) lines.push(filled(t.foot).join(' — '));
  }
  return lines.join('\n');
}

/** Текст для разметки HTML Telegram: только `&`, `<`, `>`. */
export function botEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Экранированный текст, в котором код подтверждения стоит моноширинным (копируется нажатием). */
function withCode(text: string, code: string | undefined): string {
  const html = botEscape(text);
  if (!code) return html;
  const mark = botEscape(code);
  return html.split(mark).join(`<code>${mark}</code>`);
}

function tableHtml(t: BotTable): string {
  const numeric = new Set(t.numeric ?? []);
  const align = (i: number) => (numeric.has(i) ? ' align="right"' : '');
  const row = (cells: readonly string[], tag: 'th' | 'td') =>
    `<tr>${cells.map((x, i) => `<${tag}${align(i)}>${botEscape(x)}</${tag}>`).join('')}</tr>`;
  const table =
    '<table bordered compact>' +
    (t.head ? row(t.head, 'th') : '') +
    t.rows.map((r) => row(r, 'td')).join('') +
    (t.foot
      ? `<tr>${t.foot.map((x, i) => `<td${align(i)}><b>${botEscape(x)}</b></td>`).join('')}</tr>`
      : '') +
    '</table>';
  return t.title
    ? `<details${t.open ? ' open' : ''}><summary>${botEscape(t.title)} · ${t.n ?? t.rows.length}</summary>${table}</details>`
    : table;
}

/** Сообщение с таблицами и раскрывающимися разделами (HTML для sendRichMessage Bot API). */
export function botRichHtml(m: BotMessage): string {
  const parts: string[] = [];
  if (m.heading) parts.push(`<b>${botEscape(m.heading)}</b>`);
  if (m.sub) parts.push(`<i>${botEscape(m.sub)}</i>`);
  if (m.text) parts.push(withCode(m.text, m.code));
  const text = parts.join('\n');
  return text + (m.tables ?? []).map(tableHtml).join('');
}

/**
 * Есть ли в сообщении то, чего нет в простом тексте: выделенный заголовок, подзаголовок, таблицы
 * (прототип `tgcMsg` выделяет их в любом сообщении). Без них особый вид не нужен.
 */
export function botHasMarkup(m: BotMessage): boolean {
  return Boolean(m.heading || m.sub) || (m.tables ?? []).length > 0;
}

/** Данные кнопки-действия: «действие» или «действие:запись» — не длиннее 64 байт. */
export function botPressData(action: string, arg?: string): string {
  if (!ACTION_RE.test(action) || action === BOT_PRESS_OFF) {
    throw new Error(`Кнопка бота: неверный код действия «${action}»`);
  }
  if (arg === undefined || arg === '') return action;
  if (!ARG_RE.test(arg)) throw new Error(`Кнопка бота: неверный идентификатор «${arg}»`);
  return `${action}:${arg}`;
}

/** Разобрать данные нажатия; null — данные не наши (чужие, испорченные или неактивная кнопка). */
export function parseBotPress(data: string): { action: string; arg: string | null } | null {
  if (data.length > BOT_PRESS_DATA_MAX) return null;
  const at = data.indexOf(':');
  const action = at < 0 ? data : data.slice(0, at);
  const arg = at < 0 ? null : data.slice(at + 1);
  if (!ACTION_RE.test(action) || action === BOT_PRESS_OFF) return null;
  if (arg !== null && !ARG_RE.test(arg)) return null;
  return { action, arg };
}

/** Кнопка клавиатуры Telegram в виде, который понимает переходник (`@buhuchet/adapters`). */
export interface BotKeyboardButton {
  text: string;
  data?: string;
  copy?: string;
  url?: string;
  disabled?: boolean;
}

/** Ряды кнопок под сообщением. Неактивная кнопка остаётся на месте с данными «off». */
export function botKeyboard(m: BotMessage): BotKeyboardButton[][] {
  return (m.buttons ?? [])
    .map((row) =>
      row.map((b): BotKeyboardButton => {
        if (b.off) return { text: b.text, data: BOT_PRESS_OFF, disabled: true };
        if (b.copy !== undefined) return { text: b.text, copy: b.copy };
        if (b.url !== undefined) return { text: b.text, url: b.url };
        return { text: b.text, data: botPressData(b.action ?? '', b.arg) };
      }),
    )
    .filter((row) => row.length > 0);
}

const same = (b: BotButton, action: string, arg: string | null) =>
  b.action === action && (b.arg ?? null) === (arg || null);

/**
 * Активная кнопка сообщения с этим действием и записью. Нажатие принимается, только если такая кнопка
 * была в отправленном сообщении: данные нажатия сами по себе ничего не разрешают.
 */
export function findBotButton(m: BotMessage, action: string, arg: string | null): BotButton | null {
  for (const row of m.buttons ?? []) {
    for (const b of row) if (!b.off && same(b, action, arg)) return b;
  }
  return null;
}

/**
 * Сообщение после выполненного действия: нажатая кнопка становится неактивной (с новой подписью
 * `done`, если она задана), кнопки с действиями из `off` гаснут — действие их отменяет.
 */
export function pressBotButton(
  m: BotMessage,
  action: string,
  arg: string | null,
  result: { done?: string; off?: readonly string[] },
): BotMessage {
  if (result.done === undefined && !result.off?.length) return m;
  const buttons = (m.buttons ?? []).map((row) =>
    row.map((b): BotButton => {
      if (b.off) return b;
      if (same(b, action, arg) && result.done !== undefined) {
        return { ...b, text: result.done, off: true };
      }
      if (b.action !== undefined && result.off?.includes(b.action)) return { ...b, off: true };
      return b;
    }),
  );
  return { ...m, buttons };
}

/** Что не так с сообщением до отправки (ошибка разработки, а не пользователя); null — всё в порядке. */
export function botMessageProblem(m: BotMessage): string | null {
  if (!botPlainText(m).trim()) return 'пустое сообщение';
  if (m.code !== undefined && !(m.text ?? '').includes(m.code)) return 'кода нет в тексте';
  if (m.image !== undefined) {
    if (!IMAGE_RE.test(m.image)) return 'номер картинки';
    if ((m.tables ?? []).length) return 'у сообщения с картинкой нет таблиц';
    if (botPlainText(m).length > BOT_CAPTION_MAX) return 'подпись к картинке длиннее 1024 знаков';
  }
  for (const t of m.tables ?? []) {
    const width = Math.max(
      t.head?.length ?? 0,
      t.foot?.length ?? 0,
      ...t.rows.map((r) => r.length),
    );
    if (width > BOT_TABLE_COLUMNS_MAX) return 'в таблице больше 20 столбцов';
  }
  if (m.ask) {
    try {
      botPressData(m.ask.action, m.ask.arg);
    } catch {
      return 'просьба бота: действие или запись';
    }
  }
  for (const row of m.buttons ?? []) {
    for (const b of row) {
      if (!b.text.trim() || b.text.length > BOT_BUTTON_TEXT_MAX) return 'подпись кнопки';
      const kinds = [b.action, b.copy, b.url].filter((x) => x !== undefined).length;
      if (kinds !== 1) return 'у кнопки должно быть одно из: действие, копирование, ссылка';
      if (b.copy !== undefined && (b.copy.length < 1 || b.copy.length > BOT_COPY_MAX)) {
        return 'текст копирования';
      }
      // Ссылка — только https: адрес собирает код, и другой схемы (tg:, javascript:) в нём быть не должно.
      if (b.url !== undefined && !/^https:\/\/[^\s/]+/.test(b.url)) return 'адрес ссылки';
      if (b.action !== undefined) {
        try {
          const bytes = new TextEncoder().encode(botPressData(b.action, b.arg)).length;
          if (bytes > BOT_PRESS_DATA_MAX) {
            return 'данные кнопки длиннее 64 байт';
          }
        } catch {
          return 'данные кнопки';
        }
      }
    }
  }
  return null;
}

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const optional = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || ok(v);
const isString = (x: unknown) => typeof x === 'string';

/** Сообщение, прочитанное из базы (jsonb): null — запись не похожа на сообщение бота. */
export function asBotMessage(value: unknown): BotMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  if (![m.heading, m.sub, m.text, m.code, m.plain, m.image].every((x) => optional(x, isString))) {
    return null;
  }
  const tablesOk = optional(
    m.tables,
    (ts) =>
      Array.isArray(ts) &&
      ts.every((t: unknown) => {
        if (!t || typeof t !== 'object') return false;
        const x = t as Record<string, unknown>;
        return (
          optional(x.title, isString) &&
          optional(x.head, isStrings) &&
          optional(x.foot, isStrings) &&
          optional(x.n, (n) => Number.isSafeInteger(n) && (n as number) >= 0) &&
          Array.isArray(x.rows) &&
          x.rows.every(isStrings)
        );
      }),
  );
  const buttonsOk = optional(
    m.buttons,
    (rows) =>
      Array.isArray(rows) &&
      rows.every(
        (row: unknown) =>
          Array.isArray(row) &&
          row.every((b: unknown) => {
            if (!b || typeof b !== 'object') return false;
            const x = b as Record<string, unknown>;
            return (
              typeof x.text === 'string' &&
              [x.action, x.arg, x.copy, x.url].every((y) => optional(y, isString))
            );
          }),
      ),
  );
  const askOk = optional(m.ask, (ask) => {
    if (!ask || typeof ask !== 'object' || Array.isArray(ask)) return false;
    const x = ask as Record<string, unknown>;
    const src = x.src as Record<string, unknown> | undefined;
    return (
      typeof x.action === 'string' &&
      (x.kind === 'file' || x.kind === 'text') &&
      [x.arg, x.day].every((y) => optional(y, isString)) &&
      optional(x.off, (y) => typeof y === 'boolean') &&
      optional(
        src,
        (y) =>
          !!y &&
          typeof y === 'object' &&
          Number.isSafeInteger((y as { messageId?: unknown }).messageId) &&
          typeof (y as { action?: unknown }).action === 'string',
      )
    );
  });
  return tablesOk && buttonsOk && askOk ? (value as BotMessage) : null;
}

/** Действие кнопки «Отмена» под просьбой бота: бот перестаёт ждать ответ, запись не меняется. */
export const BOT_ASK_CANCEL = 'askCancel';

/** Бот всё ещё ждёт ответ на это сообщение (`today` — сегодня по Бишкеку). */
export function botAskLive(m: BotMessage, today: string): boolean {
  return !!m.ask && !m.ask.off && (m.ask.day === undefined || m.ask.day === today);
}

/** Та же просьба (то же действие с той же записью) уже открыта этим сообщением. */
export function sameBotAsk(m: BotMessage, action: string, arg: string | null): boolean {
  return !!m.ask && m.ask.action === action && (m.ask.arg ?? null) === (arg || null);
}

/** Сообщение после ответа или отмены: бот больше не ждёт, кнопка «Отмена» гаснет. */
export function closeBotAsk(m: BotMessage): BotMessage {
  if (!m.ask) return m;
  const buttons = (m.buttons ?? []).map((row) =>
    row.map((b): BotButton => (b.action === BOT_ASK_CANCEL ? { ...b, off: true } : b)),
  );
  return { ...m, ask: { ...m.ask, off: true }, ...(m.buttons ? { buttons } : {}) };
}

/** Просьба бота прислать файл или текст ответом на сообщение; под ней — кнопка «Отмена». */
export function askBotMessage(text: string, ask: BotAsk, cancelLabel: string): BotMessage {
  return { text, ask, buttons: [[{ text: cancelLabel, action: BOT_ASK_CANCEL }]] };
}

/**
 * Сообщение с кодом подтверждения (пакет заказчика 13.11.2026: код копируется одним нажатием): код в
 * тексте моноширинный — в чате копируется нажатием, под сообщением — кнопка «Скопировать код».
 */
export function codeBotMessage(text: string, code: string, copyLabel: string): BotMessage {
  return { text, code, buttons: [[{ text: copyLabel, copy: code }]] };
}

/**
 * «Проверить бота» (прототип `tgTestMsg`): сообщение с таблицей и кнопкой — человек видит, как его
 * приложение Telegram показывает новый вид сообщений. Текст и подпись кнопки — шаблоны `tgTest` и
 * `tgBtnTest`, состав таблицы задаёт продукт.
 */
export const BOT_TEST_ACTION = 'test';

export function botTestMessage(text: string, buttonLabel: string): BotMessage {
  return {
    heading: 'Проверка бота',
    text,
    tables: [
      {
        head: ['Что проверяем', 'Как должно быть'],
        rows: [
          ['Таблица', 'столбцами, как здесь'],
          ['Кнопки', 'под сообщением'],
          ['Скрытый ответ', 'после нажатия кнопки'],
        ],
      },
    ],
    buttons: [[{ text: buttonLabel, action: BOT_TEST_ACTION }]],
  };
}
