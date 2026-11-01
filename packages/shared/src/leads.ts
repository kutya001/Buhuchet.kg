import {
  LEAD_FIRM_MAX,
  LEAD_NAME_MAX,
  LEAD_NOTE_MAX,
  LEAD_SIZE_MAX,
  LEAD_TELEGRAM_MAX,
  type UiTextKey,
} from '@buhuchet/domain';
import { z } from 'zod';

const message = (key: UiTextKey) => ({ message: key });

/** NUL PostgreSQL не примет — это 400, а не 500. */
const noNul = (s: string) => !s.includes('\u0000');
// eslint-disable-next-line no-control-regex -- однострочные поля: переводы строк и прочие управляющие
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Однострочное поле: без переводов строк — сообщение администратору в Telegram не подделать. */
const oneLine = (s: string) => !CONTROL.test(s);

/*
 * Форма «Оставить заявку» лендинга (ТЗ «Лендинг» → «Форма «Оставить заявку»»; прототип
 * modules/landing.js, landFormBind). Сообщения — ключи словаря группы «Лендинг» (`land.e.*`): те же
 * тексты под полями, что в прототипе. Телефон — «+», код страны и цифры номера («+996555100200»);
 * сколько цифр после кода, сверяет сервер по справочнику «Коды стран телефонов».
 */
export const LeadForm = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('land.e.name'))
    .max(LEAD_NAME_MAX, message('land.e.name'))
    .refine(oneLine, message('land.e.name')),
  firm: z
    .string()
    .trim()
    .min(1, message('land.e.firm'))
    .max(LEAD_FIRM_MAX, message('land.e.firm'))
    .refine(oneLine, message('land.e.firm')),
  phone: z.string().regex(/^\+\d{4,15}$/, message('land.e.phone')),
  /** Вариант из словаря (`land.f.size.opts`): что он из списка, сверяет сервер по действующему словарю. */
  size: z
    .string()
    .trim()
    .min(1, message('land.e.size'))
    .max(LEAD_SIZE_MAX, message('land.e.size'))
    .refine(oneLine, message('land.e.size')),
  telegram: z.string().trim().max(LEAD_TELEGRAM_MAX).refine(oneLine),
  note: z
    .string()
    .trim()
    .max(LEAD_NOTE_MAX, message('land.e.note'))
    .refine(noNul, message('land.e.note')),
  consent: z.literal(true, message('land.e.consent')),
  /**
   * Скрытое поле-ловушка («Сайт»): человек его не видит и не заполняет, бот — заполняет. Заявку с ним
   * сервер не сохраняет, но отвечает как обычно.
   */
  website: z.string().max(200).refine(noNul),
});
export type LeadForm = z.infer<typeof LeadForm>;

/** Ответ на заявку: всегда «Спасибо!», и для повторной с того же телефона, и для ловушки. */
export const LeadSubmitted = z.object({ ok: z.literal(true) });
export type LeadSubmitted = z.infer<typeof LeadSubmitted>;
