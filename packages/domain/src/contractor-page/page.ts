import type { PageSection } from '../org/policy';
import { PAGE_SECTION_FEATURE, PAGE_SECTIONS } from '../org/policy';
import type { Feature } from '../roles/permissions';
import { initials } from '../staff/names';

/*
 * Страница контрагента по ссылке: включение, код доступа и защита (задача 2.42; ТЗ «Контрагенты» →
 * «Страница контрагента по ссылке» → «Защита», «Включение»; прототип modules/cp-page.js — pgBox,
 * pgEnable, pgCodeDlg, pubDraw). Разделы и компоновка самой страницы — задача 2.43.
 */

/** Код доступа — 6 цифр, может начинаться с нуля (прототип pgNewCode). */
export const PAGE_CODE_LENGTH = 6;

/** Неверных кодов подряд по одной ссылке до перерыва и сам перерыв (ТЗ; прототип PG_TRY, PG_LOCK). */
export const PAGE_CODE_TRIES = 5;
export const PAGE_LOCK_MINUTES = 15;

/**
 * Счёт неверных кодов по ссылке забывается через час после последнего неверного, как у входа по
 * паролю: случайная опечатка раз в неделю не копится до перерыва.
 */
export const PAGE_FAILURE_MEMORY_MINUTES = 60;

/** Общий предел с одного адреса IP по всем ссылкам всех организаций (ТЗ): 30 неверных за час — час. */
export const PAGE_IP_MAX_FAILURES = 30;
export const PAGE_IP_WINDOW_MINUTES = 60;
export const PAGE_IP_LOCK_MINUTES = 60;

/** Верный код запоминается в этом браузере (ТЗ; прототип PG_KEEP). */
export const PAGE_REMEMBER_DAYS = 30;

export function isPageCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/** Код для показа сотруднику: «482 915» (прототип pgCodeTxt). */
export function pageCodeText(code: string): string {
  return code ? `${code.slice(0, 3)} ${code.slice(3)}` : '';
}

/** Путь страницы: <адрес организации>/inn/<ИНН> (прототип pgPath). */
export function pagePath(slug: string, inn: string): string {
  return `${slug}/inn/${inn}`;
}

/** Ссылка для контрагента: адрес сайта и путь страницы. */
export function pageLink(baseUrl: string, slug: string, inn: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${pagePath(slug, inn)}`;
}

/** Ссылка в блоке «Страница контрагента» — без https:// (прототип pgUrl: www.buhuchet.kg/…). */
export function pageLinkText(link: string): string {
  return link.replace(/^https?:\/\//, '');
}

/**
 * Устройство, с которого открыли страницу, — для истории и «Последнего открытия» (прототип pgDev):
 * «Телефон · Safari», «ПК · Chrome».
 */
export function pageDevice(userAgent: string): string {
  const u = userAgent;
  const browser = /Edg\//.test(u)
    ? 'Edge'
    : /OPR\/|Opera/.test(u)
      ? 'Opera'
      : /YaBrowser/.test(u)
        ? 'Яндекс Браузер'
        : /Firefox\//.test(u)
          ? 'Firefox'
          : /Chrome\//.test(u)
            ? 'Chrome'
            : /Safari\//.test(u)
              ? 'Safari'
              : 'браузер';
  return `${/Mobi|Android|iPhone|iPad/.test(u) ? 'Телефон' : 'ПК'} · ${browser}`;
}

/**
 * Разделы, которые организация показывает на страницах (прототип pgSecOrg): отмеченные в учётной
 * политике, а у раздела с функцией — только при включённой функции. Их можно скрыть у контрагента.
 */
export function pageOrgSections(
  orgSections: readonly PageSection[],
  features: Readonly<Partial<Record<Feature, boolean>>>,
): PageSection[] {
  return PAGE_SECTIONS.filter((s) => {
    const feature = PAGE_SECTION_FEATURE[s];
    return orgSections.includes(s) && (!feature || features[feature] === true);
  });
}

/** Разделы страницы этого контрагента: разделы организации без скрытых у него (прототип pgSecs). */
export function pageVisibleSections(
  orgSections: readonly PageSection[],
  features: Readonly<Partial<Record<Feature, boolean>>>,
  hidden: readonly PageSection[],
): PageSection[] {
  return pageOrgSections(orgSections, features).filter((s) => !hidden.includes(s));
}

/**
 * Буквы вместо логотипа в шапке страницы, если логотипа нет (прототип pubBody, `pub-logo`): инициалы
 * названия без формы собственности и кавычек — «ОсОО «Бухгалтер Плюс»» → «БП».
 */
export function orgLogoLetters(orgName: string): string {
  return initials(orgName.replace(/^(ОсОО|ИП|ОАО|ЗАО)\s+/, '').replace(/[«»"]/g, ''));
}

/** Отказы в блоке «Страница контрагента»: текст — `PAGE_MESSAGES`, ключ словаря — `err.<код>`. */
export type PageRefusal = 'page_manage_right' | 'page_send_right' | 'page_archived' | 'page_off';

export const PAGE_MESSAGES: Record<PageRefusal, string> = {
  page_manage_right: 'Нужно право «Управлять страницей контрагента»',
  page_send_right:
    'Отправлять ссылку может ответственный бухгалтер или сотрудник с правом «Управлять страницей контрагента»',
  page_archived: 'Контрагент в архиве: страница выключена',
  page_off: 'Страница контрагента выключена',
};

/** Кто действует в блоке: право «Управлять страницей контрагента» и ответственный ли он. */
export interface PageActor {
  canManage: boolean;
  isResponsible: boolean;
}

/** Включить, выключить, сменить код, скрыть раздел (прототип pgBox, `why`). */
export function pageManageRefusal(actor: PageActor, archived: boolean): PageRefusal | null {
  if (archived) return 'page_archived';
  return actor.canManage ? null : 'page_manage_right';
}

/**
 * Скопировать и отправить включённую ссылку — и ответственный бухгалтер без права (ТЗ «скопировать
 * и отправить включённую ссылку может и ответственный бухгалтер контрагента»; прототип pgSendWhy).
 */
export function pageSendRefusal(actor: PageActor, enabled: boolean): PageRefusal | null {
  if (!enabled) return 'page_off';
  return actor.canManage || actor.isResponsible ? null : 'page_send_right';
}

/** Шаблон сообщения со ссылкой, пока в справочнике платформы его нет (refDB.json, waPage). */
export const PAGE_WHATSAPP_TEMPLATE =
  'Уважаемые {контрагент}! Ваши отчёты и сроки, показатели и оплату за обслуживание можно посмотреть на странице {ссылка} — код доступа {код}. Код никому не передавайте.';

/**
 * Сообщение в WhatsApp со ссылкой и кодом (шаблон waPage справочника платформы; прототип waDlg,
 * `page`): подстановки {контрагент}, {ссылка}, {код}.
 */
export function pageWhatsAppText(
  template: string,
  values: { contractor: string; link: string; code: string },
): string {
  return template
    .replaceAll('{контрагент}', values.contractor)
    .replaceAll('{ссылка}', values.link)
    .replaceAll('{код}', values.code);
}

/** Ссылка WhatsApp на номер с готовым текстом (прототип waLink): номер — только цифры. */
export function whatsAppLink(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
