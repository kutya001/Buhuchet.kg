import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { LEAD_REPEAT_MARKS, messageTemplates, phoneCodes, submitLead } from '@buhuchet/db';
import {
  fillTemplate,
  formatPhone,
  leadSizeOptions,
  pageIpSubject,
  phoneProblem,
} from '@buhuchet/domain';
import { ApiError, LeadForm, LeadSubmitted } from '@buhuchet/shared';
import type { Context } from 'hono';
import { createHash } from 'node:crypto';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { serverTexts } from '../l10n/texts';

/*
 * «Оставить заявку» с лендинга (ТЗ «Лендинг» → «Форма «Оставить заявку»», «Основные технические
 * парадигмы»: «единственный метод без входа на нём — «Оставить заявку» с пределом по адресу IP»;
 * прототип modules/landing.js, landFormBind и leadAdd). Метод без сеанса (`PUBLIC_PATHS` в
 * middleware/session.ts): схема Zod, 400 на неверные данные, предел — в общей таблице `rate_limits`
 * функцией базы `app.lead_submit` (миграция 0089). Защита от спама — без внешних сервисов: не больше
 * 3 заявок в час с адреса, повтор с того же телефона за сутки дописывает комментарий к первой
 * заявке, заявку с заполненным полем-ловушкой сервер не сохраняет, но проверяет и засчитывает в предел
 * как обычную и отвечает так же — по ответу ловушку не распознать.
 */

const error = { 'application/json': { schema: ApiError } };

/**
 * Шаблоны «Telegram: новая заявка с сайта» и «Telegram: повторная заявка с сайта», пока в справочнике
 * шаблонов их нет (до `db:seed --update`): тот же текст, что в refDB.json (`messageTemplates.tgLead`,
 * `tgLeadRep`).
 */
const TG_LEAD_FALLBACK =
  '📩 Новая заявка с сайта: {фирма}, {имя}, {телефон}, клиентов: {клиентов}. Открыть: {ссылка}';
const TG_LEAD_REP_FALLBACK =
  '🔁 Повторная заявка с сайта: {фирма}, {имя}, {телефон}. Открыть: {ссылка}';

/** {ссылка} — вкладка «Заявки» Админки на этом сайте (прототип v74 leadLink). */
const LEADS_TAB = '/app/orgs/leads';

/** Пометка в начале сообщения о заявке с тестового стенда (прототип v74 leadTgText). */
export const STAND_MARK = '🧪 Тестовый стенд ';

/**
 * Чей счёт заявок по адресу — как у страницы контрагента по ссылке: первый адрес X-Forwarded-For (его
 * ставит Vercel и Caddy на VPS, входящий от клиента они заменяют), IPv6 — по сети /64. В базе — только
 * SHA-256 адреса со своей приставкой, сам адрес нигде не хранится. Без заголовка (локально, в тестах) —
 * общий счёт «unknown»; на стенде и рабочем сайте это ошибка настройки прокси — пишется предупреждение.
 */
function leadIpSubject(c: Context<AppEnv>, deps: ApiDeps): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (!forwarded && (deps.config.APP_ENV === 'staging' || deps.config.APP_ENV === 'production')) {
    deps.logger.warn(
      { requestId: c.get('requestId') },
      'нет X-Forwarded-For: предел заявок по адресу общий для всех',
    );
  }
  const subject = forwarded ? pageIpSubject(forwarded) : 'unknown';
  return createHash('sha256').update(`lead:${subject}`, 'utf8').digest('hex');
}

export const submitLeadRoute = createRoute({
  method: 'post',
  path: '/leads',
  tags: ['leads'],
  summary: 'Оставить заявку с лендинга (без входа)',
  request: { body: { required: true, content: { 'application/json': { schema: LeadForm } } } },
  responses: {
    200: {
      description:
        '«Спасибо!»: заявка принята (или дописана к заявке с того же телефона за сутки, или отброшена ловушкой)',
      content: { 'application/json': { schema: LeadSubmitted } },
    },
    400: { description: 'Неверные данные формы, номер не по маске страны', content: error },
    429: {
      description: 'Больше 3 заявок за час с этого адреса (`lead_limited`)',
      content: error,
    },
  },
});

export function submitLeadHandler(deps: ApiDeps): RouteHandler<typeof submitLeadRoute, AppEnv> {
  return async (c) => {
    const form = c.req.valid('json');
    c.header('Cache-Control', 'no-store');
    const codes = await phoneCodes(deps.db);
    if (phoneProblem(form.phone, codes)) {
      apiFail(400, 'validation_failed', 'Неверные данные запроса', [
        { path: ['phone'], message: 'land.e.phone' },
      ]);
    }
    // «Сколько клиентов ведёте» — вариант из действующего словаря, как список в форме.
    const t = await serverTexts(deps);
    if (!leadSizeOptions(t('land.f.size.opts')).includes(form.size)) {
      apiFail(400, 'validation_failed', 'Неверные данные запроса', [
        { path: ['size'], message: 'land.e.size' },
      ]);
    }
    // Поле-ловушка заполнено — так делают боты: заявка засчитывается в предел, но не сохраняется.
    const trap = form.website.trim() !== '';
    // Заявка со стенда сохраняется только на стенде (своя база): сообщение о ней получают
    // администраторы стенда от бота стенда, с пометкой в начале (решение заказчика 06.11.2026).
    const fromStand = deps.config.APP_ENV === 'staging';
    let telegramText: string | null = null;
    let telegramRepeatText: string | null = null;
    if (!trap && deps.telegram) {
      // Уведомление обязательно (прототип v74 leadNotify): о новой заявке и о повторной за сутки.
      const templates = await messageTemplates(deps.db);
      const vars = {
        фирма: form.firm,
        имя: form.name,
        телефон: formatPhone(form.phone, codes),
        клиентов: form.size,
        ссылка: new URL(LEADS_TAB, deps.config.APP_BASE_URL).href,
      };
      const mark = fromStand ? STAND_MARK : '';
      telegramText = mark + fillTemplate(templates.tgLead ?? TG_LEAD_FALLBACK, vars);
      // О повторе — фирма, имя и «клиентов» сохранённой заявки (прототип leadTgPreview(o.dup ? o.lead : o)):
      // их подставляет функция базы вместо меток, телефон тот же.
      telegramRepeatText =
        mark +
        fillTemplate(templates.tgLeadRep ?? TG_LEAD_REP_FALLBACK, {
          ...vars,
          фирма: LEAD_REPEAT_MARKS.firm,
          имя: LEAD_REPEAT_MARKS.name,
          клиентов: LEAD_REPEAT_MARKS.size,
        });
    }
    const res = await submitLead(deps.db, {
      ipSubject: leadIpSubject(c, deps),
      name: form.name,
      firm: form.firm,
      phone: form.phone,
      size: form.size,
      telegram: form.telegram,
      note: form.note,
      fromStand,
      trap,
      telegramText,
      telegramRepeatText,
      now: deps.clock.now(),
    });
    if (res.outcome === 'limited') {
      apiFail(429, 'lead_limited', 'Слишком много заявок с этого адреса. Попробуйте через час');
    }
    deps.logger.info(
      { requestId: c.get('requestId'), lead: res.leadId, outcome: res.outcome },
      'заявка с лендинга',
    );
    return c.json({ ok: true as const }, 200);
  };
}
