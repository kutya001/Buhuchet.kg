import {
  BELL_REPORT_TABS,
  bellAgo,
  bellDayGroup,
  type BellAgo,
  type BellKind,
} from '@buhuchet/domain';
import type { BellItem } from '@buhuchet/shared';
import type { BellRowView, IconName } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { presetHref } from '../lists/preset';
import { APP_PATH, tabHref } from './modules';

/*
 * Колокольчик (доработки 16.11.2026, блок 3; прототип v123 `ui/bell-panel.js`): строка для показа и
 * куда ведёт нажатие — чистыми функциями (тесты — `bell-model.test.ts`).
 */

/** Значок строки — по фильтру, у отдельных событий свой (прототип `BELL_IC`, `BELL_EV_IC`). */
const KIND_ICON: Record<BellKind, IconName> = {
  reports: 'file',
  tasks: 'task',
  files: 'folder',
  money: 'wallet',
  news: 'grad',
  other: 'info',
};
const EVENT_ICON: Readonly<Record<string, IconName>> = {
  login_locked: 'lock',
  lead: 'user',
  broadcast: 'send',
  cp_tg_request: 'tg',
  cp_question: 'chat',
  page_closed: 'ban',
  nudge: 'clock',
  day_dues: 'calendar',
  week: 'calendar',
};

export function bellAgoText(t: Translate, ago: BellAgo): string {
  switch (ago.kind) {
    case 'now':
      return t('bell.at.now');
    case 'min':
      return t('bell.at.min', { n: ago.n });
    case 'today':
      return ago.hm;
    case 'yesterday':
      return t('bell.at.yesterday', { hm: ago.hm });
    case 'date':
      return `${ago.date} ${ago.hm}`;
  }
}

/** Строка для показа: контрагент и фраза — простым текстом (React экранирует), время — по Бишкеку. */
export function bellRowView(t: Translate, x: BellItem, now: Date): BellRowView {
  const at = new Date(x.at);
  return {
    id: x.id,
    icon: EVENT_ICON[x.event] ?? KIND_ICON[x.kind],
    contractor: x.contractor?.name ?? null,
    text: x.text,
    at: bellAgoText(t, bellAgo(at, now)),
    group: t(`bell.group.${bellDayGroup(at, now)}`),
    read: x.read,
  };
}

/** Что делает нажатие строки: адрес, карточка контрагента или ничего (незнакомый вид). */
export type BellGo =
  | { kind: 'href'; href: string }
  | { kind: 'contractor'; id: string; tab: 'main' | 'money' | 'fee' | 'files'; sent?: boolean }
  | { kind: 'gone' }
  | null;

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Куда ведёт строка (прототип `bellGo`; виды — договорённость с потоком Т, `BELL_TARGETS`). Отчёт и
 * задача открываются, как ссылка «Открыть» из сообщения бота: списком с карточкой записи.
 */
export function bellGoOf(
  open: BellItem['open'],
  ctx: {
    employeeId: string | null;
    reportsAll: boolean;
    tasks: boolean;
    contractors: boolean;
  },
): BellGo {
  if (!open) return null;
  const { id } = open;
  const record = UUID.test(id);
  const card = (tab: 'main' | 'money' | 'fee' | 'files', sent?: boolean): BellGo =>
    record && ctx.contractors ? { kind: 'contractor', id, tab, sent } : { kind: 'gone' };
  // ОТКЛОНЕНИЕ: docs/deviations.md#И-11 — отчёт, задача, новость, сотрудник и заявка открываются
  // списком модуля с карточкой (`?report=`, `?task=`, `?news=`, `?employee=`, `?lead=`).
  switch (open.kind) {
    case 'report':
      return record ? { kind: 'href', href: `${tabHref('reports', 'all')}?report=${id}` } : null;
    case 'task':
      return record && ctx.tasks
        ? { kind: 'href', href: `${tabHref('tasks', 'mine')}?task=${id}` }
        : { kind: 'gone' };
    case 'contractor':
      return card('main');
    case 'cp_money':
      return card('money');
    case 'cp_fee':
      return card('fee');
    case 'cp_sent':
      return card('files', true);
    // «Сроки на сегодня»: «Отчёты для сдачи» → «На неделе», свои отчёты (прототип: фильтр
    // «Ответственный», когда видно отчёты всех).
    case 'reports_day':
      return {
        kind: 'href',
        href: presetHref(
          'reports',
          'week',
          ctx.reportsAll && ctx.employeeId
            ? { responsible: { type: 'enum', vals: [ctx.employeeId] } }
            : {},
        ),
      };
    case 'reports_tab':
      return (BELL_REPORT_TABS as readonly string[]).includes(id)
        ? { kind: 'href', href: tabHref('reports', id === 'wait' ? 'waiting' : id) }
        : null;
    case 'tasks_tab':
      return ctx.tasks && id === 'mine'
        ? { kind: 'href', href: tabHref('tasks', 'mine') }
        : { kind: 'gone' };
    case 'employee':
      return record ? { kind: 'href', href: `${tabHref('staff', 'list')}?employee=${id}` } : null;
    case 'news':
      return { kind: 'href', href: `${tabHref('kb', 'news')}?news=${encodeURIComponent(id)}` };
    case 'lead':
      return record ? { kind: 'href', href: `${tabHref('orgs', 'leads')}?lead=${id}` } : null;
    // Подписка (доработки 20.11.2026; прототип `subBellGo`): владельцу — экран «Подписка»,
    // администратору — «Организации» → «Подписки» с окном организации; сверка хранилища — Админка →
    // «Файлы» → «Проверка хранилища». Вкладки делает поток И.
    case 'sub':
      return { kind: 'href', href: `${APP_PATH}/org/sub` };
    case 'sub_check':
      return record ? { kind: 'href', href: `${APP_PATH}/orgs/subs?org=${id}` } : null;
    case 'storage_check':
      return { kind: 'href', href: `${APP_PATH}/afiles/check` };
    // «Шаблон перестал работать» (Витрина данных, этап 2, П4 и П7): Админка → «Витрина данных» →
    // «Шаблоны» с окном шаблона.
    case 'dm_template':
      return record ? { kind: 'href', href: `${tabHref('dm', 'tpl')}?tpl=${id}` } : null;
    default:
      return null;
  }
}
