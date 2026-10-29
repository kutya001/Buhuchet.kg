import { PAGE_SECTIONS } from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion, Uuid } from './common';
import { OrgLogoLink, PageSectionSchema } from './org';

/*
 * Схемы страницы контрагента по ссылке (задача 2.42): блок «Страница контрагента» карточки, включение
 * у нескольких контрагентов и страница без входа (ввод кода, «Страница недоступна»). Разделы страницы —
 * задача 2.43. Ошибки сервера — `err.<code>`.
 */

/** Почему действие в блоке недоступно — ключ словаря `err.<код>` (`PAGE_MESSAGES`). */
export const PageRefusalCode = z.enum([
  'page_manage_right',
  'page_send_right',
  'page_archived',
  'page_off',
]);

/** Блок «Страница контрагента» на вкладке «Основное» карточки (прототип pgBox). */
export const ContractorPage = z.object({
  /** Функция «Страница контрагента по ссылке» включена в учётной политике; иначе блока нет. */
  featureOn: z.boolean(),
  enabled: z.boolean(),
  archived: z.boolean(),
  /** Ссылка для контрагента и код доступа — только у включённой страницы. */
  link: z.string().nullable(),
  code: z.string().nullable(),
  lastOpenAt: z.iso.datetime().nullable(),
  lastDevice: z.string().nullable(),
  /** Разделы организации, которые можно скрыть у этого контрагента, по порядку страницы. */
  sections: z.array(PageSectionSchema),
  hiddenSections: z.array(PageSectionSchema),
  /** Версия строки страницы — для «Разделов страницы»; null — страницу ещё не включали. */
  version: RecordVersion.nullable(),
  /** Включить, выключить, сменить код, разделы — и почему нельзя. */
  manage: PageRefusalCode.nullable(),
  /** Скопировать ссылку и отправить в WhatsApp — и почему нельзя. */
  send: PageRefusalCode.nullable(),
  /**
   * «Отправить в WhatsApp»: номер контрагента и готовое сообщение по шаблону waPage со ссылкой и
   * кодом — у включённой страницы и тому, кто может отправить.
   */
  whatsApp: z
    .object({
      /** Номер контрагента цифрами для ссылки wa.me и для показа («+996 505 89 00 76»). */
      phone: z.string(),
      phoneText: z.string(),
      text: z.string(),
    })
    .nullable(),
});
export type ContractorPage = z.infer<typeof ContractorPage>;

/** «Разделы страницы» у контрагента: скрытые разделы и версия, которую видел сотрудник. */
export const ContractorPageSectionsInput = z.object({
  hiddenSections: z
    .array(PageSectionSchema)
    .max(PAGE_SECTIONS.length)
    .refine((s) => new Set(s).size === s.length, 'Разделы без повторов'),
  version: RecordVersion,
});

/** «Включить страницу» у выбранных контрагентов (ТЗ «Массово: выбрать контрагентов в списке…»). */
export const ContractorPagesEnableInput = z.object({
  ids: z
    .array(Uuid)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Контрагенты без повторов'),
});

/** Итог: у скольких включено (у каждого свой код) и сколько пропущено — уже включена или в архиве. */
export const ContractorPagesEnabled = z.object({
  enabled: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

/** Адрес страницы без входа: /<адрес организации>/inn/<ИНН>; неверный вид — «недоступна». */
export const PublicPageParams = z.object({
  slug: z.string().max(64),
  inn: z.string().max(32),
});

/** Открытая страница: шапка и разделы, которые она показывает (содержимое разделов — задача 2.43). */
export const PublicPageBody = z.object({
  /** «Данные на <дата и время>». */
  asOf: z.iso.datetime(),
  contractor: z.object({ name: z.string(), inn: z.string(), regime: z.string().nullable() }),
  org: z.object({ name: z.string(), logo: OrgLogoLink.nullable() }),
  sections: z.array(PageSectionSchema),
});
export type PublicPageBody = z.infer<typeof PublicPageBody>;

/**
 * Что показать по ссылке: «Страница недоступна» (выключенная, неизвестный ИНН, архив — одинаково),
 * ввод кода, перерыв после неверных кодов или саму страницу.
 */
export const PublicPage = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unavailable') }),
  z.object({ state: z.literal('code') }),
  z.object({ state: z.literal('locked'), lockedUntil: z.iso.datetime() }),
  z.object({ state: z.literal('open'), page: PublicPageBody }),
]);
export type PublicPage = z.infer<typeof PublicPage>;

/** Ввод кода доступа: ровно 6 цифр (прототип: «Введите 6 цифр»). */
export const PublicPageCodeInput = z.object({
  code: z.string().regex(/^\d{6}$/, 'pub.code.format'),
});

export const PublicPageCodeOk = z.object({ ok: z.literal(true) });
