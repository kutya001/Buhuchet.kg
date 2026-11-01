import { scaleBack, scaleNext } from '../common/status';

/*
 * Заявки с лендинга (ТЗ «Лендинг — buhuchet.kg для гостей» → «Форма «Оставить заявку»», «Админка» →
 * модуль организаций → «Вкладка «Заявки»»; прототип modules/landing.js, admin/leads.js; решение
 * заказчика 01.11.2026). Правила без базы и сети: пределы полей, защита от спама, шкала статусов.
 */

/** Пределы полей формы: длиннее не бывает, а строка без предела — путь забить базу. */
export const LEAD_NAME_MAX = 120;
export const LEAD_FIRM_MAX = 160;
export const LEAD_SIZE_MAX = 40;
export const LEAD_TELEGRAM_MAX = 64;
/** «Комментарий» — до 1 000 знаков (ТЗ: «Не длиннее 1 000 знаков»). */
export const LEAD_NOTE_MAX = 1000;
/**
 * Комментарий заявки вместе с дописанными повторными (ТЗ: «её комментарий дописывается к первой
 * заявке»): повторов с одного адреса не больше трёх в час, но предел у столбца всё равно есть.
 */
export const LEAD_NOTE_TOTAL_MAX = 8000;
/** «Заметка администратора» в окне заявки. */
export const LEAD_ADMIN_NOTE_MAX = 2000;
/** Причина отказа и отката. */
export const LEAD_REASON_MAX = 500;

/** «Не больше 3 заявок в час с одного адреса IP» (ТЗ «Защита от спама без внешних сервисов»). */
export const LEAD_IP_LIMIT = 3;
export const LEAD_IP_WINDOW_SECONDS = 3600;
/** «Повторная заявка с тем же телефоном в течение суток новой не создаётся». */
export const LEAD_REPEAT_HOURS = 24;

/**
 * Статусы заявки (справочник «Статусы», шкала «Заявка»): 1 Новая → 2 В работе → 3 Подключена;
 * «Отказ» — конечная отметка вне шкалы с обязательной причиной.
 */
export const LEAD_STATUSES = ['new', 'in_progress', 'connected', 'rejected'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Что записано в историю заявки: заявка с сайта, повтор с того же телефона, смена статуса, откат
 * статуса с причиной (в «Истории статусов» — с пометкой «Откат»), заметка, создана организация.
 */
export const LEAD_EVENT_KINDS = ['created', 'repeat', 'status', 'rollback', 'note', 'org'] as const;
export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];

/**
 * Варианты «Сколько клиентов ведёте» — из текста словаря `land.f.size.opts` («До 20|21–50|…»):
 * правятся в «Локализации», как остальные тексты лендинга.
 */
export function leadSizeOptions(text: string): string[] {
  return text
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** «@имя» или «имя» в Telegram — как ввёл человек, без пробелов по краям. */
export function cleanLeadText(text: string | undefined | null): string {
  return (text ?? '').trim();
}

/**
 * Комментарий первой заявки после повторной с того же телефона: новый дописывается с новой строки
 * (прототип leadAdd: `dup.note + '\n' + v.note`); пустой повтор комментарий не меняет. Сверх предела
 * столбца — обрезается, чтобы повтор не отказал человеку.
 */
export function appendLeadNote(note: string | null, more: string): string | null {
  const add = more.trim();
  if (!add) return note;
  const joined = note ? `${note}\n${add}` : add;
  return joined.slice(0, LEAD_NOTE_TOTAL_MAX);
}

/** Отказы методов заявок: код ошибки API → текст (сервер и экран берут один текст). */
export const LEAD_MESSAGES = {
  lead_not_found: 'Заявка не найдена',
  lead_status_invalid: 'Такой смены статуса у заявки нет',
  lead_back_locked: 'По заявке создана организация: статус «Подключена» не откатывается',
  lead_reason_required: 'Укажите причину отказа',
  lead_org_exists: 'По заявке уже создана организация',
} as const;

/** Что о заявке нужно правилам меню и смены статуса. */
export interface LeadState {
  status: LeadStatus;
  /** Статус до «Отказа» (прототип `prevSt`): «Снять «Отказ»» возвращает в него. */
  statusBefore: LeadStatus | null;
  /** По заявке создана организация. */
  hasOrg: boolean;
}

/** «В работу» — только у новой (прототип leadActions). */
export function leadCanStart(s: LeadState): boolean {
  return s.status === 'new';
}

/** «Создать организацию» — пока по заявке её не создали, в любом статусе, и у «Отказа» тоже. */
export function leadCanCreateOrg(s: LeadState): boolean {
  return !s.hasOrg;
}

/**
 * «Отметить «Подключена»» — из «В работе», если организацию не создавали (её создание само ставит
 * «Подключена»).
 */
export function leadCanConnect(s: LeadState): boolean {
  return s.status === 'in_progress' && !s.hasOrg;
}

/** «Отказ» — у новой и в работе: у «Подключена» и самого «Отказа» его нет. */
export function leadCanReject(s: LeadState): boolean {
  return s.status === 'new' || s.status === 'in_progress';
}

/**
 * Откат на шаг (прототип `scBack` для `lead`): «Снять «Отказ»» — в статус до отказа (нет — «Новая»),
 * «Подключена» → «В работе», «В работе» → «Новая»; у новой — некуда (null). «Подключена» с созданной
 * организацией не откатывается: `locked` (пункт меню виден, но недоступен с причиной).
 */
export type LeadBack = { to: LeadStatus } | { locked: true } | null;

export function leadBack(s: LeadState): LeadBack {
  if (s.status === 'connected' && s.hasOrg) return { locked: true };
  const before =
    s.statusBefore === 'new' || s.statusBefore === 'in_progress' ? s.statusBefore : null;
  const to = scaleBack('lead', s.status, { beforeReject: before });
  return to ? { to: to as LeadStatus } : null;
}

/** Главная кнопка окна заявки (прототип openLead): «В работу» у новой, иначе «Создать организацию». */
export function leadMainAction(s: LeadState): 'start' | 'org' | null {
  if (leadCanStart(s)) return 'start';
  return leadCanCreateOrg(s) && s.status !== 'rejected' ? 'org' : null;
}

/** Смена статуса заявки, как её понял сервер: шаг, «Отказ» или откат. */
export type LeadStatusChange =
  { kind: 'step'; to: LeadStatus } | { kind: 'reject' } | { kind: 'rollback'; to: LeadStatus };

/**
 * Что значит «перевести заявку в `to`» (меню, шкала и окно отката шлют один метод): «Отказ» — у новой
 * и в работе; шаг вперёд по шкале — «Подключена» только без созданной организации; шаг назад — откат.
 * null — такой смены нет; `locked` — «Подключена» с организацией не откатывается.
 */
export function leadStatusChange(s: LeadState, to: LeadStatus): LeadStatusChange | 'locked' | null {
  if (to === 'rejected') return leadCanReject(s) ? { kind: 'reject' } : null;
  if (scaleNext('lead', s.status).includes(to)) {
    return to === 'connected' && s.hasOrg ? null : { kind: 'step', to };
  }
  const back = leadBack(s);
  if (back && 'locked' in back) return scaleBack('lead', s.status) === to ? 'locked' : null;
  return back?.to === to ? { kind: 'rollback', to } : null;
}
