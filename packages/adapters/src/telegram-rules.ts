/*
 * Правила Bot API для сообщения бота (пакет 14.11.2026, этап 3, поток Т: общая проверка всех сообщений
 * бота, старых и новых). Настоящий Telegram отвечает 400 на сообщение длиннее 4096 знаков, на неверную
 * разметку HTML, на данные кнопки длиннее 64 байт, на пустую подпись кнопки и т. п. Подставной бот тестов
 * проверяет каждое сообщение по этим правилам и ещё по одному своему: в тексте не осталось незаполненной
 * подстановки шаблона («{срок}»). Нарушения копятся (`takeFakeTelegramProblems`): тесты API проверяют
 * после каждого теста, что их нет, — так каждый тест, который шлёт сообщение, проверяет и его вид.
 */

import type { TelegramButton, TelegramSendOptions } from './telegram';

/** Предел текста сообщения и подписи картинки в Telegram, знаков (после разбора разметки). */
export const TELEGRAM_TEXT_MAX = 4096;
export const TELEGRAM_CAPTION_MAX = 1024;
/** Скрытый ответ на нажатие кнопки, знаков. */
export const TELEGRAM_CALLBACK_TEXT_MAX = 200;
/** Данные нажатия кнопки, байт (UTF-8). */
export const TELEGRAM_CALLBACK_DATA_MAX = 64;
/** Текст кнопки копирования, знаков. */
export const TELEGRAM_COPY_TEXT_MAX = 256;
/** Кнопок в ряду и всего под сообщением. */
export const TELEGRAM_ROW_BUTTONS_MAX = 8;
export const TELEGRAM_BUTTONS_MAX = 100;

/** Теги, которые Telegram принимает в `parse_mode: HTML`. */
const HTML_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'a',
  'tg-spoiler',
  'span',
  'blockquote',
  'tg-emoji',
]);

/** Незаполненная подстановка шаблона: «{срок}», «{n1}» (знаки разметки и пробелы внутри — не она). */
const PLACEHOLDER = /\{[\p{L}\p{N}_]+\}/u;

/** Текст не длиннее `max` знаков: лишнее — многоточием (для простого текста без разметки). */
export function clipTelegramText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  // Половину пары знаков (эмодзи) не оставлять.
  return `${/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut}…`;
}

/** Что не так с разметкой HTML по правилам Telegram; null — всё верно. Отдаёт и видимый текст. */
export function telegramHtmlProblem(html: string): { problem: string | null; visible: string } {
  const stack: string[] = [];
  let visible = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i]!;
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) return { problem: 'html_unclosed_tag', visible };
      const raw = html.slice(i + 1, end).trim();
      const closing = raw.startsWith('/');
      const name = (closing ? raw.slice(1) : raw).split(/\s/)[0]!.toLowerCase();
      if (!HTML_TAGS.has(name)) return { problem: `html_tag:${name}`, visible };
      if (closing) {
        if (stack.pop() !== name) return { problem: `html_nesting:${name}`, visible };
      } else {
        stack.push(name);
      }
      i = end + 1;
      continue;
    }
    if (ch === '&') {
      const m = /^&(lt|gt|amp|quot|#\d{1,7}|#x[0-9a-f]{1,6});/i.exec(html.slice(i));
      if (!m) return { problem: 'html_entity', visible };
      visible += 'x';
      i += m[0].length;
      continue;
    }
    if (ch === '>') return { problem: 'html_stray_gt', visible };
    visible += ch;
    i += 1;
  }
  if (stack.length) return { problem: `html_unclosed:${stack.at(-1)}`, visible };
  return { problem: null, visible };
}

function textProblems(
  text: string,
  { html = false, max = TELEGRAM_TEXT_MAX, required = true } = {},
): string[] {
  const problems: string[] = [];
  let visible = text;
  if (html) {
    const checked = telegramHtmlProblem(text);
    if (checked.problem) problems.push(checked.problem);
    visible = checked.visible;
  }
  if (required && !visible.trim()) problems.push('text_empty');
  if (visible.length > max) problems.push(`text_too_long:${visible.length}`);
  if (PLACEHOLDER.test(text)) problems.push(`placeholder:${PLACEHOLDER.exec(text)![0]}`);
  return problems;
}

/** Что не так с кнопками под сообщением; пустой список — всё верно. */
export function telegramKeyboardProblems(
  keyboard: readonly (readonly TelegramButton[])[],
): string[] {
  const problems: string[] = [];
  let total = 0;
  for (const row of keyboard) {
    if (row.length > TELEGRAM_ROW_BUTTONS_MAX) problems.push(`row_too_wide:${row.length}`);
    total += row.length;
    for (const b of row) {
      if (!b.text.trim()) problems.push('button_text_empty');
      if (PLACEHOLDER.test(b.text)) problems.push(`placeholder:${PLACEHOLDER.exec(b.text)![0]}`);
      const kinds = [b.data, b.copy, b.url].filter((v) => v !== undefined).length;
      if (kinds !== 1) problems.push(`button_kind:${b.text}`);
      if (b.data !== undefined) {
        const bytes = new TextEncoder().encode(b.data).byteLength;
        if (bytes < 1 || bytes > TELEGRAM_CALLBACK_DATA_MAX) problems.push(`button_data:${bytes}`);
      }
      if (b.copy !== undefined) {
        if (!b.copy || b.copy.length > TELEGRAM_COPY_TEXT_MAX) {
          problems.push(`button_copy:${b.copy.length}`);
        }
        if (PLACEHOLDER.test(b.copy)) problems.push(`placeholder:${PLACEHOLDER.exec(b.copy)![0]}`);
      }
      if (b.url !== undefined && !/^https:\/\/[^\s]+$/.test(b.url)) problems.push('button_url');
    }
  }
  if (total > TELEGRAM_BUTTONS_MAX) problems.push(`too_many_buttons:${total}`);
  return problems;
}

/** Что не так с сообщением `sendMessage` по правилам Telegram; пустой список — всё верно. */
export function telegramSendProblems(text: string, options: TelegramSendOptions = {}): string[] {
  const problems = textProblems(text, { html: options.html === true });
  if (options.rich !== undefined && PLACEHOLDER.test(options.rich)) {
    problems.push(`placeholder:${PLACEHOLDER.exec(options.rich)![0]}`);
  }
  if (options.keyboard) problems.push(...telegramKeyboardProblems(options.keyboard));
  for (const row of options.menu ?? []) {
    for (const label of row) if (!label.trim()) problems.push('menu_text_empty');
  }
  return problems;
}

/** Подпись картинки (`sendPhoto`): до 1024 знаков, может быть пустой. */
export function telegramCaptionProblems(caption: string, html: boolean): string[] {
  return textProblems(caption, { html, max: TELEGRAM_CAPTION_MAX, required: false });
}

/** Скрытый ответ на нажатие (`answerCallbackQuery`): до 200 знаков, без незаполненных подстановок. */
export function telegramCallbackTextProblems(text: string | undefined): string[] {
  if (text === undefined || text === '') return [];
  return textProblems(text, { max: TELEGRAM_CALLBACK_TEXT_MAX });
}
