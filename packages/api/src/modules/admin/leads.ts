import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  discardLeadDraft,
  leadDocKey,
  leadDocsReady,
  leadDraftDocs,
  leadUploadKey,
  messageTemplates,
  phoneCodes,
  submitLead,
  submitLeadDocs,
  type LeadSubmission,
} from '@buhuchet/db';
import {
  botMessageProblem,
  botTemplate,
  fillTemplate,
  formatPhone,
  LEAD_DOC_MAX_BYTES,
  LEAD_DOC_TEXT_KEYS,
  LEAD_TG_LINK_HOURS,
  leadBotMessage,
  leadDocsMissing,
  leadSizeOptions,
  pageIpSubject,
  phoneProblem,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import { ApiError, LeadForm, LeadSubmitted } from '@buhuchet/shared';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createHash } from 'node:crypto';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { serverTexts } from '../l10n/texts';
import { issueLeadTgLink, type LeadTgLink } from '../telegram/lead-link';
import { botSiteUrl } from '../telegram/staff-view';
import { isStoredPdf, removeLeadObjects } from './lead-uploads';

/*
 * «Оставить заявку» с лендинга (ТЗ «Лендинг» → «Форма «Оставить заявку»», «Основные технические
 * парадигмы»: «единственный метод без входа на нём — «Оставить заявку» с пределом по адресу IP»;
 * прототип modules/landing.js, landFormBind и leadAdd). Метод без сеанса (`PUBLIC_PATHS` в
 * middleware/session.ts): схема Zod, 400 на неверные данные, предел — в общей таблице `rate_limits`
 * функцией базы `app.lead_submit` (миграция 0089); сообщение администраторам платформы в Telegram — с
 * таблицей и кнопками (поток Т, задача Т6), в очередь в той же транзакции. Защита от спама — без внешних сервисов: не больше
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

/** Пометка в начале простого текста сообщения о заявке с тестового стенда (прототип v74 leadTgText). */
export const STAND_MARK = '🧪 Тестовый стенд ';

/**
 * Чей счёт заявок по адресу — как у страницы контрагента по ссылке: первый адрес X-Forwarded-For (его
 * ставит Vercel и Caddy на VPS, входящий от клиента они заменяют), IPv6 — по сети /64. В базе — только
 * SHA-256 адреса со своей приставкой, сам адрес нигде не хранится. Без заголовка (локально, в тестах) —
 * общий счёт «unknown»; на стенде и рабочем сайте это ошибка настройки прокси — пишется предупреждение.
 */
export function leadIpSubject(c: Context<AppEnv>, deps: ApiDeps): string {
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

/**
 * Cookie ссылки на бота заявителя (контракт потока Т, доработки 14.11.2026, блок 1): токен ссылки —
 * только этому браузеру и только методу заявки; повтор с того же телефона получает ссылку первой заявки,
 * только если браузер принёс живой токен (`issueLeadTgLink`). Ловушке — тоже, чтобы ответ не отличался.
 */
export const LEAD_TG_COOKIE = 'bu_lead_tg';

function leadTgCookie(c: Context<AppEnv>, deps: ApiDeps, token: string): void {
  const secure =
    deps.config.APP_ENV === 'staging' ||
    deps.config.APP_ENV === 'production' ||
    deps.config.APP_BASE_URL.startsWith('https:');
  setCookie(c, LEAD_TG_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: '/api/leads',
    maxAge: LEAD_TG_LINK_HOURS * 3600,
  });
}

/** Ссылка на бота для ответа формы: срок — для «Ссылка на бота действует до …». */
function tgOut(tg: LeadTgLink) {
  if (!tg) return null;
  return 'linked' in tg
    ? { linked: true as const }
    : { url: tg.url, expiresAt: tg.expiresAt.toISOString() };
}

/**
 * Документы новой заявки — под ключи заявки (после транзакции заявки): копия загрузки, у копии — тот же
 * размер и начало PDF (загрузку по ссылке могли подменить после чтения, копию — нет). Годные — `ready`;
 * негодный остаётся «переносится», «Одобрить» его не возьмёт. Загрузки черновика удаляются. Ошибки —
 * в журнал: заявка уже сохранена.
 */
async function moveLeadDocs(
  deps: ApiDeps,
  leadId: string,
  docs: readonly { id: string; size: number }[],
): Promise<void> {
  const ok: string[] = [];
  for (const doc of docs) {
    const key = leadDocKey(leadId, doc.id);
    try {
      if (!(await deps.storage.copy(leadUploadKey(doc.id), key))) continue;
      const stored = await deps.storage.stat(key);
      if (
        stored &&
        stored.size === doc.size &&
        stored.size <= LEAD_DOC_MAX_BYTES &&
        (await isStoredPdf(deps, key))
      ) {
        ok.push(doc.id);
      } else {
        await removeLeadObjects(deps, [key]);
      }
    } catch (err) {
      deps.logger.error({ err }, 'заявка: документ не перенесён');
    }
  }
  if (ok.length) {
    await leadDocsReady(deps.db, leadId, ok).catch((err: unknown) =>
      deps.logger.error({ err }, 'заявка: документы не отмечены загруженными'),
    );
  }
  if (ok.length < docs.length) {
    deps.logger.warn(
      { lead: leadId, moved: ok.length, docs: docs.length },
      'заявка: не все документы перенесены',
    );
  }
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
    400: {
      description:
        'Неверные данные формы, номер не по маске страны, не приложены или не проверены документы формы',
      content: error,
    },
    409: {
      description: 'Документы черновика не перенеслись в заявку (`lead_docs_missing`)',
      content: error,
    },
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
    let notify: LeadSubmission['notify'] = null;
    if (!trap && deps.telegram) {
      // Уведомление обязательно (прототип v74 leadNotify): о новой заявке и о повторной за сутки.
      const templates = await messageTemplates(deps.db);
      const phone = formatPhone(form.phone, codes);
      const link = new URL(LEADS_TAB, deps.config.APP_BASE_URL).href;
      const tpl = (key: TelegramTemplateKey) => botTemplate(key, templates[key]);
      notify = (saved) => {
        // О повторе — фирма, имя, «клиентов» и статус сохранённой заявки, а не второй формы (прототип
        // `leadMsg(o.dup ? o.lead : o)`); телефон тот же.
        const plain =
          (fromStand ? STAND_MARK : '') +
          fillTemplate(
            saved.repeat
              ? (templates.tgLeadRep ?? TG_LEAD_REP_FALLBACK)
              : (templates.tgLead ?? TG_LEAD_FALLBACK),
            {
              фирма: saved.firm,
              имя: saved.name,
              телефон: phone,
              клиентов: saved.size,
              ссылка: link,
            },
          );
        // Сообщение с таблицей и кнопками «Взять в работу», «Отклонить», «Открыть в Админке» (задача Т6;
        // прототип v103 `leadMsg`); простой текст — прежнее сообщение одной строкой.
        const message = leadBotMessage({
          id: saved.id,
          firm: saved.firm,
          name: saved.name,
          phone,
          size: saved.size,
          status: saved.status,
          statusName: t(`status.lead.${saved.status}`),
          repeat: saved.repeat,
          stand: fromStand,
          link: botSiteUrl(deps, LEADS_TAB),
          plain,
          texts: {
            head: tpl(saved.repeat ? 'tgLeadRepHead' : 'tgLeadHead'),
            work: tpl('tgBtnLeadWork'),
            no: tpl('tgBtnLeadNo'),
            open: tpl('tgBtnLeadOpen'),
            firm: t('telegram.lead.firm'),
            size: t('telegram.lead.size'),
            contact: t('telegram.lead.contact'),
            status: t('telegram.lead.status'),
          },
        });
        const problem = botMessageProblem(message);
        if (problem) {
          // Шаблон кнопки испортили в справочнике — заявка всё равно доходит, прежним текстом.
          deps.logger.error({ problem }, 'Telegram: сообщение о заявке собрано неверно');
          return { text: plain, message: { text: plain } };
        }
        return { text: plain, message };
      };
    }
    const now = deps.clock.now();
    const prior = getCookie(c, LEAD_TG_COOKIE) ?? null;
    // Доработки 14.11.2026, блок 1: документы формы — в черновике; в той же транзакции, что заявка,
    // они становятся документами новой заявки, у повтора и ловушки — убираются; ссылка на бота — тоже
    // здесь (поток Т). Проверка документов — у любой заявки, и у ловушки: по ответу её не отличить.
    const res = await submitLead(
      deps.db,
      {
        ipSubject: leadIpSubject(c, deps),
        name: form.name,
        firm: form.firm,
        phone: form.phone,
        size: form.size,
        telegram: form.telegram,
        note: form.note,
        fromStand,
        trap,
        notify,
        now,
      },
      async (tx, r) => {
        if (r.outcome === 'limited') return null;
        const draft = await leadDraftDocs(tx, form.draft, now);
        const ready = draft.filter((d) => d.state === 'ready');
        const missing = leadDocsMissing(
          form.form,
          ready.map((d) => d.kind),
        );
        if (missing.length) {
          apiFail(
            400,
            'validation_failed',
            'Неверные данные запроса',
            missing.map((kind) => ({
              path: ['docs', kind],
              message: LEAD_DOC_TEXT_KEYS[kind].replace('land.f.doc.', 'land.e.doc.'),
            })),
          );
        }
        let docs: { id: string; size: number }[] = [];
        let drop: string[];
        if (r.outcome === 'created') {
          const out = await submitLeadDocs(tx, {
            leadId: r.leadId!,
            now,
            form: form.form,
            inn: form.inn,
            okpo: form.okpo,
            address: form.address,
            head: form.head,
            draft: form.draft,
          });
          if (out.missing) apiFail(409, 'lead_docs_missing', 'Документы заявки не загрузились');
          const sizes = new Map(draft.map((d) => [d.id, d.sizeBytes]));
          docs = out.docs.map((id) => ({ id, size: sizes.get(id) ?? -1 }));
          drop = out.dropped;
        } else {
          // Повтор с того же телефона документов не получает (docs/deviations.md п. И-9), ловушка — тоже.
          drop = await discardLeadDraft(tx, form.draft);
        }
        const tg = await issueLeadTgLink(tx, {
          leadId: r.outcome === 'trap' ? null : r.leadId,
          repeat: r.outcome === 'repeat',
          prior,
          now,
          botUsername: deps.config.TELEGRAM_BOT_USERNAME,
        });
        return { docs, drop, tg };
      },
    );
    if (res.outcome === 'limited' || !res.extra) {
      apiFail(429, 'lead_limited', 'Слишком много заявок с этого адреса. Попробуйте через час');
    }
    const { docs, drop, tg } = res.extra;
    if (res.outcome === 'created' && res.leadId) await moveLeadDocs(deps, res.leadId, docs);
    await removeLeadObjects(deps, [...docs.map((d) => d.id), ...drop].map(leadUploadKey));
    if (tg && 'token' in tg) leadTgCookie(c, deps, tg.token);
    deps.logger.info(
      { requestId: c.get('requestId'), lead: res.leadId, outcome: res.outcome },
      'заявка с лендинга',
    );
    return c.json({ ok: true as const, tg: tgOut(tg) }, 200);
  };
}
