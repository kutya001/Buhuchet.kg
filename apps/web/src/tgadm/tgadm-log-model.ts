import {
  JOURNAL_DAYS,
  journalKindKey,
  type GridViewSettings,
  type JournalStatus,
  type ListFilterValue,
  type ListSort,
  type UiTextKey,
} from '@buhuchet/domain';
import type { AdminTelegramLogRow } from '@buhuchet/shared';
import type { IconName, Pill } from '@buhuchet/ui';
import type { ComponentProps } from 'react';
import type { Translate } from '../l10n/translate';
import type { JournalView } from './tgadm-log-store';

type PillTone = NonNullable<ComponentProps<typeof Pill>['tone']>;

/** Статус строки: цвет и значок (прототип `TG_PILL`); «Получено» — без значка. */
export const STATUS_PILL: Readonly<Record<JournalStatus, { tone: PillTone; icon?: IconName }>> = {
  sent: { tone: 'ok', icon: 'check' },
  pending: { tone: 'warn', icon: 'hourglass' },
  error: { tone: 'bad', icon: 'alert' },
  new: { tone: 'plain' },
  done: { tone: 'ok', icon: 'check' },
  unknown: { tone: 'warn', icon: 'help' },
};

type Row = Pick<AdminTelegramLogRow, 'kind' | 'hide' | 'text' | 'error'>;

/** «Тип сообщения» по словарю: у отправок — `telegram.kind.*`, у остального — `tgadm.kind.*`. */
export function kindText(t: Translate, kind: string): string {
  return t(journalKindKey(kind) as UiTextKey);
}

/** «Ошибка» строки: ответ Telegram или подпись кода итога из словаря. */
export function errorOf(t: Translate, row: Pick<Row, 'error'>): string {
  if (!row.error) return '';
  return row.error === 'recipient_unlinked' ? t('tgadm.err.unlinked') : row.error;
}

/** «Текст» строки одной строкой: у кода и одноразовой ссылки — «Текст скрыт: …» (прототип `tgTxt`). */
export function rowText(t: Translate, row: Pick<Row, 'hide' | 'text'>): string {
  return row.hide ? t(`tgadm.hide.${row.hide}`) : (row.text ?? '');
}

type Filters = Record<string, ListFilterValue>;

/**
 * Плашка над журналом (прототип `renderTgLog`): «В очереди» и «Ошибки отправки» — отправленные с этим
 * статусом за весь срок хранения; «Отправлено сегодня» и «Получено сегодня» — направление и «Сегодня»
 * без фильтров. «Вся переписка» при этом снимается.
 */
export function plateChoice(plate: 'q' | 'e' | 's' | 'r'): {
  view: JournalView;
  filters: Filters;
} {
  if (plate === 'q' || plate === 'e') {
    return {
      view: { dir: 'out', per: JOURNAL_DAYS, chat: null },
      filters: { st: { type: 'enum', vals: [plate === 'e' ? 'error' : 'pending'] } },
    };
  }
  return { view: { dir: plate === 's' ? 'out' : 'in', per: 1, chat: null }, filters: {} };
}

/** «Вся переписка» (прототип `tgChatAll`): один чат, все направления, весь срок хранения. */
export function chatChoice(rowId: string): JournalView {
  return { dir: 'all', per: JOURNAL_DAYS, chat: rowId };
}

/** Параметры журнала сверх общих: направление, период и чат. */
export function journalExtra(view: JournalView): Record<string, string> {
  return {
    days: String(view.per),
    ...(view.dir === 'all' ? {} : { dir: view.dir }),
    ...(view.chat ? { chat: view.chat } : {}),
  };
}

/** Переписка одного чата читается от старых к новым (прототип: `g.sort = {key: 'at', dir: 1}`). */
export const CHAT_SORT: ListSort = { key: 'at', dir: 'asc' };

/**
 * Настройки вида на экране: в «Всей переписке» — порядок от старых к новым, сохранённый вид журнала при
 * этом не меняется.
 */
export function shownSettings(settings: GridViewSettings, chat: boolean): GridViewSettings {
  return chat ? { ...settings, sort: CHAT_SORT } : settings;
}

/**
 * Что сохранить из правки вида, сделанной в «Всей переписке»: порядок переписки в сохранённый вид не
 * попадает — остаётся прежний; другой порядок, выбранный человеком, сохраняется.
 */
export function savedSettings(
  next: GridViewSettings,
  saved: GridViewSettings,
  chat: boolean,
): GridViewSettings {
  if (!chat) return next;
  const same = next.sort?.key === CHAT_SORT.key && next.sort.dir === CHAT_SORT.dir;
  if (!same) return next;
  const { sort: _chatSort, ...rest } = next;
  return saved.sort === undefined ? rest : { ...rest, sort: saved.sort };
}
