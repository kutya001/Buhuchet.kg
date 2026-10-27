import {
  ownershipFormOf,
  socfundDict,
  type ContractorFields,
  type SocfundGuide,
  type Tx,
} from '@buhuchet/db';
import {
  SOCFUND_FLAGS,
  socfundAutoTexts,
  socfundBadWhy,
  socfundConfirmText,
  socfundDecide,
  socfundFlagsOf,
  socfundManualMismatch,
  socfundNeeded,
  socfundShort,
  socfundState,
  socfundTitle,
  type ContractorKind,
  type SocfundChoice,
  type SocfundDict,
  type SocfundFlags,
  type SocfundInput,
  type SocfundSubject,
  type Translate,
} from '@buhuchet/domain';
import type { ContractorSocfund, ContractorSocfundRequest } from '@buhuchet/shared';
import { apiFail } from '../../errors';

/*
 * Тариф Соцфонда у контрагента (ТЗ «Контрагенты» → «Тариф страховых взносов в Соцфонд (СПиНО)»;
 * прототип core/socfund.js, modules/socfund-ui.js): тариф словами в карточке, ответ форме до
 * сохранения, сохранение вместе с формой контрагента и окно «Тариф Соцфонда» из карточки. Тариф и
 * признаки меняет право «Создавать и изменять контрагентов». Статус СПиНО (ЛЬГ-29) у контрагента идёт за
 * тарифом: в окне «Льготы и особые статусы» его нет (docs/decisions.md п. А-3).
 */

/** Справочные данные тарифа и форма собственности контрагента. */
export async function socfundContext(
  tx: Tx,
  gked: string | null,
  formCode: string | null,
): Promise<{
  dict: SocfundDict;
  guide: SocfundGuide;
  form: { code: string; name: string } | null;
}> {
  const [{ dict, guide }, form] = await Promise.all([
    socfundDict(tx, gked ? [gked] : []),
    formCode ? ownershipFormOf(tx, formCode) : Promise.resolve(null),
  ]);
  return { dict, guide, form };
}

/** Контрагент для тарифа. */
export function socfundSubjectOf(
  fields: {
    kind: ContractorKind;
    bases: readonly string[];
    gked: string | null;
    benefits: readonly string[];
    flags: SocfundFlags;
  },
  form: { code: string; name: string } | null,
  activeTypes: readonly string[],
): SocfundSubject {
  return {
    kind: fields.kind,
    bases: fields.bases,
    activeTypes,
    gked: fields.gked,
    form,
    benefits: fields.benefits,
    flags: fields.flags,
  };
}

/** Признаки запроса: только указанные. */
const flagsOfRequest = (f: ContractorSocfundRequest['flags']): SocfundFlags =>
  socfundFlagsOf(f as Record<string, unknown>);

/** Признаки для ответа: у каждого — да, нет или null. */
const flagsOut = (f: SocfundFlags) =>
  Object.fromEntries(SOCFUND_FLAGS.map((k) => [k, f[k] ?? null])) as ContractorSocfund['flags'];

/** Тариф словами (прототип sfState, sfBadWhy): выбранный, по условиям, «больше не применим», «под вопросом». */
export function socfundOut(
  s: SocfundSubject,
  choice: SocfundChoice | null,
  dict: SocfundDict,
  t: Translate,
): ContractorSocfund {
  const tariff = choice && dict.tariffs.find((x) => x.id === choice.id);
  const st = socfundState(s, choice, dict);
  const auto = st?.auto ?? null;
  const autoTariff = auto?.tariff ? dict.tariffs.find((x) => x.id === auto.tariff)! : null;
  return {
    needed: socfundNeeded(s, dict),
    flags: flagsOut(s.flags),
    tariff:
      choice && tariff
        ? {
            id: choice.id,
            short: socfundShort(tariff),
            title: socfundTitle(tariff, dict),
            total: tariff.total,
            manual: choice.manual,
            reason: choice.reason,
          }
        : null,
    auto: auto && {
      id: auto.tariff,
      short: socfundShort(autoTariff),
      total: autoTariff?.total ?? '',
      ...socfundAutoTexts(auto, dict, t),
    },
    bad: st?.bad ?? false,
    badWhy: st ? socfundBadWhy(st, dict, t) : '',
    ask: st?.ask ?? false,
  };
}

/** Статус СПиНО (ЛЬГ-29) идёт за тарифом: убрать из переданных и поставить, если тариф — СПиНО. */
export function withSocfundStatus(
  benefits: ContractorFields['benefits'],
  dict: SocfundDict,
  spino: boolean,
): ContractorFields['benefits'] {
  const code = dict.status?.code;
  if (!code) return benefits;
  const rest = benefits.filter((b) => b.code !== code);
  return spino ? [...rest, { code, validFrom: null, validTo: null }] : rest;
}

/** Вход формы: не переданный блок — признаки как сохранены, выбор не тронут (прототип sfInit). */
export function socfundInputOf(
  req: ContractorSocfundRequest | undefined,
  stored: SocfundFlags,
): SocfundInput {
  if (!req) return { flags: stored };
  return {
    flags: flagsOfRequest(req.flags),
    ...(req.tariff !== undefined ? { tariff: req.tariff } : {}),
    reason: req.reason ?? '',
  };
}

/**
 * Причина ручного выбора, который расходится с условиями (прототип sfValid): без неё — отказ 400 у поля.
 * `s` — контрагент с новыми признаками.
 */
export function requireSocfundReason(s: SocfundSubject, input: SocfundInput, dict: SocfundDict) {
  if (socfundManualMismatch(s, input, dict) && !(input.reason ?? '').trim()) {
    apiFail(400, 'socfund_reason_required', 'Укажите, почему тариф выбран вручную', {
      field: 'socfund.reason',
    });
  }
}

/**
 * Ручной выбор вопреки условиям сохраняется только после «Сохранить» в окне «Тариф не совпадает с
 * условиями» (прототип sfConfirm): без подтверждения — отказ 400 с текстом окна.
 */
export function requireSocfundConfirm(
  s: SocfundSubject,
  choice: SocfundChoice | null,
  input: SocfundInput,
  dict: SocfundDict,
  confirmed: boolean,
  t: Translate,
) {
  if (confirmed || !socfundManualMismatch(s, input, dict)) return;
  apiFail(400, 'socfund_confirm_required', t('err.socfund_confirm_required'), {
    field: 'socfund.tariff',
    text: socfundConfirmText(s, choice, input, dict, t),
  });
}

/**
 * Что сохранить у контрагента (прототип sfApply): признаки, тариф и статус СПиНО. У разового контрагента
 * признаков и тарифа нет — без изменений.
 */
export function socfundPatch(
  s: SocfundSubject,
  choice: SocfundChoice | null,
  input: SocfundInput,
  dict: SocfundDict,
  benefits: ContractorFields['benefits'],
): Pick<ContractorFields, 'socfundFlags' | 'socfundTariff' | 'benefits'> {
  if (s.kind === 'oneoff') return { socfundFlags: s.flags, socfundTariff: choice, benefits };
  const out = socfundDecide(s, choice, input, dict);
  return {
    socfundFlags: out.flags,
    socfundTariff: out.choice,
    benefits: out.changed
      ? withSocfundStatus(benefits, dict, out.choice?.id === 'spino')
      : benefits,
  };
}
