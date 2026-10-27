import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  activeReportTypes,
  getContractor,
  lockContractor,
  readContractorFields,
  updateContractor,
  withOrgContext,
} from '@buhuchet/db';
import {
  socfundAuto,
  socfundCapText,
  socfundConfirmText,
  socfundManualMismatch,
  socfundNeeded,
  socfundRatesText,
  socfundShort,
  socfundTitle,
  type SocfundChoice,
} from '@buhuchet/domain';
import {
  ContractorSaved,
  ContractorSocfundCheck,
  ContractorSocfundCheckRequest,
  SaveContractorSocfundRequest,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { notFound } from './card';
import { error, scopeSqlOf, subjectOf, todayOf, translateOf } from './common';
import { redueTexts, savedOut } from './save';
import {
  requireSocfundConfirm,
  requireSocfundReason,
  socfundContext,
  socfundInputOf,
  socfundOut,
  socfundPatch,
  socfundSubjectOf,
} from './socfund-view';

/*
 * Методы тарифа Соцфонда (прототип modules/socfund-ui.js): ответ форме и окну «Тариф Соцфонда» до
 * сохранения и сохранение из окна карточки. Правила и тексты — `socfund-view.ts`.
 */

export const socfundCheckRoute = createRoute({
  method: 'post',
  path: '/contractors/socfund-check',
  tags: ['contractors'],
  summary: 'Тариф Соцфонда по набранным значениям контрагента',
  middleware: [requirePermission('cpView')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ContractorSocfundCheckRequest } },
    },
  },
  responses: {
    200: {
      description:
        'Тариф по условиям с причинами, расхождение выбранного с условиями, нужны ли причина и подтверждение, тарифы справочника',
      content: { 'application/json': { schema: ContractorSocfundCheck } },
    },
    400: { description: 'Неверные данные запроса', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать контрагентов»', content: error },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

/**
 * Ответ форме и окну «Тариф Соцфонда» (прототип sfFields): ничего не сохраняет. У созданного
 * контрагента — его сохранённый выбор (выбор в форме не тронут) и действующие назначения (STI-161).
 */
export function socfundCheckHandler(deps: ApiDeps): RouteHandler<typeof socfundCheckRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      let stored: SocfundChoice | null = null;
      let types: string[] = [];
      if (body.contractorId) {
        const r = await getContractor(tx, body.contractorId, {
          scope: scopeSqlOf(subject),
          today: todayOf(deps),
        });
        if (!r) notFound();
        stored = r.socfundTariff;
        types = await activeReportTypes(tx, r.id);
      }
      const { dict, guide, form } = await socfundContext(tx, body.gked, body.formCode);
      const input = socfundInputOf(body, {});
      const s = socfundSubjectOf({ ...body, flags: input.flags }, form, types);
      // Выбор в форме: не тронут — сохранённый, «Определить автоматически» — нет выбора.
      const selected: SocfundChoice | null =
        body.tariff === undefined
          ? stored
          : body.tariff && {
              id: body.tariff,
              manual: body.tariff === stored?.id ? stored.manual : true,
              reason: body.tariff === stored?.id ? stored.reason : null,
            };
      const auto = socfundAuto(s, dict);
      const mismatch = socfundManualMismatch(s, input, dict);
      return {
        ...socfundOut(s, selected, dict, t),
        manualMismatch: mismatch,
        confirm: mismatch && auto ? socfundConfirmText(s, stored, input, dict, t) : '',
        tariffs: guide.tariffs.map((x) => {
          const d = dict.tariffs.find((y) => y.id === x.id)!;
          return {
            id: x.id,
            title: socfundTitle(d, dict),
            short: socfundShort(d),
            total: x.total,
            rates: socfundRatesText(d, t),
            cap: socfundCapText(d, t),
            tariff: {
              name: x.name,
              total: x.total,
              who: x.who,
              since: x.since,
              law: x.law,
              verify: x.verify,
              verifyNote: x.verifyNote,
              parts: x.parts,
              cap: x.cap && { amount: x.cap.amount, since: x.cap.since, note: x.cap.note },
            },
          };
        }),
        gnpf: guide.gnpf,
      };
    });
    return c.json(out, 200);
  };
}

export const saveSocfundRoute = createRoute({
  method: 'put',
  path: '/contractors/{id}/socfund',
  tags: ['contractors'],
  summary: 'Окно «Тариф Соцфонда»: признаки и тариф контрагента',
  middleware: [requirePermission('cpView'), requirePermission('createCp')] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: {
      required: true,
      content: { 'application/json': { schema: SaveContractorSocfundRequest } },
    },
  },
  responses: {
    200: {
      description:
        'Признаки и тариф сохранены; смена тарифа — в истории (кто и почему выбрал вручную)',
      content: { 'application/json': { schema: ContractorSaved } },
    },
    400: {
      description:
        'Неверные данные, тариф контрагенту не нужен, нет причины или подтверждения ручного выбора вопреки условиям',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Создавать и изменять контрагентов»', content: error },
    ...versionedSaveResponses,
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
    409: {
      description: 'Запись изменена другим пользователем или контрагент в архиве',
      content: error,
    },
  },
});

/**
 * «Тариф Соцфонда» из карточки и «Сменить на базовый» (прототип sfDlg, sfCardMount): тариф, выбранный
 * по условиям, — не ручной. Тариф нужен только постоянному контрагенту с наёмными сотрудниками
 * (`socfundNeeded`, docs/deviations.md п. А-5); архивного не меняют.
 */
export function saveSocfundHandler(deps: ApiDeps): RouteHandler<typeof saveSocfundRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, confirm, ...req } = c.req.valid('json');
    const subject = subjectOf(c);
    const ctx = orgContextOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const scope = scopeSqlOf(subject);
    const out = await withOrgContext(deps.db, ctx, async (tx) => {
      const row = await lockContractor(tx, id, scope);
      if (!row) notFound();
      if (row.serviceStatus === 'archived') {
        apiFail(409, 'contractor_archived', 'Контрагент в архиве — сначала верните его из архива');
      }
      const fields = await readContractorFields(tx, row);
      const [{ dict, form }, types] = await Promise.all([
        socfundContext(tx, fields.gked, fields.formCode),
        activeReportTypes(tx, id),
      ]);
      const input = socfundInputOf(req, fields.socfundFlags);
      const s = socfundSubjectOf(
        { ...fields, benefits: fields.benefits.map((b) => b.code), flags: input.flags },
        form,
        types,
      );
      if (!socfundNeeded(s, dict)) {
        apiFail(400, 'socfund_not_needed', t('err.socfund_not_needed'));
      }
      requireSocfundReason(s, input, dict);
      requireSocfundConfirm(s, fields.socfundTariff, input, dict, confirm ?? false, t);
      const patch = socfundPatch(
        { ...s, flags: fields.socfundFlags },
        fields.socfundTariff,
        input,
        dict,
        fields.benefits,
      );
      await updateContractor(tx, ctx.orgId, id, version, patch, scope, {
        today,
        texts: redueTexts(t),
      });
      return savedOut(tx, id, { orgId: ctx.orgId, subject, today, t, notices: [] });
    });
    return c.json(out, 200);
  };
}
