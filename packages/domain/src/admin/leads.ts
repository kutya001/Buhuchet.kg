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
