import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import fixture from './__fixtures__/socfund.json';
import type { ContractorKind } from './rules';
import {
  penaltyText,
  socfundAuto,
  socfundAutoTexts,
  socfundBadWhy,
  socfundCapText,
  socfundConfirmText,
  socfundDecide,
  socfundFlagsHistoryText,
  socfundFlagsOf,
  socfundManualMismatch,
  socfundNeeded,
  socfundRatesText,
  socfundShort,
  socfundState,
  socfundTariffHistoryText,
  socfundTitle,
  SOCFUND_BY_REPORT,
  type SocfundChoice,
  type SocfundDict,
  type SocfundInput,
  type SocfundSubject,
  type SocfundTariffId,
} from './socfund';

// Эталон — прототип (scripts/oracle-socfund.mjs): пункты приёмки ТЗ 38 и 39, все демо-контрагенты
// и придуманные на каждую ветку правила, сохранение формы и подсказка о пене.
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);

const dict: SocfundDict = {
  tariffs: fixture.dict.tariffs.map((x) => ({ ...x, id: x.id as SocfundTariffId })),
  status: fixture.dict.status,
  statusNames: new Map(fixture.dict.statusNames as [string, string][]),
  exceptions: fixture.dict.exceptions,
  gkedNames: new Map(fixture.dict.gkedNames as [string, string][]),
  index: new Map(fixture.dict.index.map((x) => [x.code, x])),
  reportTypes: fixture.dict.reportTypes,
};

type Case = (typeof fixture.cases)[number];
const subjectOf = (s: Case['subject']): SocfundSubject => ({
  ...s,
  kind: s.kind as ContractorKind,
  flags: socfundFlagsOf(s.flags),
});
/**
 * Тариф без основания «Есть наёмные сотрудники», только по действующему STI-161: прототип (sfNeed) его
 * определяет, ТЗ — нет; пока решения нет, продукт — по ТЗ.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#А-5
const byReportOnly = (s: Case['subject']) =>
  !SOCFUND_BY_REPORT &&
  s.kind !== 'oneoff' &&
  !(s.bases as readonly string[]).includes('employees') &&
  s.activeTypes.some((x) => fixture.dict.reportTypes.includes(x));
const choiceOf = (c: Case['current']): SocfundChoice | null =>
  c.tariff ? { id: c.tariff as SocfundTariffId, manual: c.manual, reason: c.reason || null } : null;

describe('Тариф Соцфонда по условиям — как в прототипе', () => {
  it.each(fixture.cases.filter((c) => !byReportOnly(c.subject)))(
    '$name',
    ({ subject, current, expected }) => {
      const s = subjectOf(subject);
      expect(socfundNeeded(s, dict)).toBe(expected.needed);
      const auto = socfundAuto(s, dict);
      if (!expected.auto) {
        expect(auto).toBeNull();
      } else {
        expect(auto?.tariff ?? null).toBe(expected.auto.t);
        expect(socfundAutoTexts(auto!, dict, t)).toEqual({
          why: expected.auto.why,
          miss: expected.auto.miss,
          warn: expected.auto.warn,
        });
      }
      const st = socfundState(s, choiceOf(current), dict);
      if (!expected.state) {
        expect(st).toBeNull();
        return;
      }
      expect({ bad: st!.bad, none: st!.none, ask: st!.ask }).toEqual({
        bad: expected.state.bad,
        none: expected.state.none,
        ask: expected.state.ask,
      });
      expect(socfundBadWhy(st!, dict, t)).toBe(expected.state.why);
    },
  );

  it('п. А-5: без основания «Есть наёмные сотрудники» тариф не нужен и при действующем STI-161', () => {
    const cases = fixture.cases.filter((c) => byReportOnly(c.subject));
    expect(cases.map((c) => c.name)).toEqual(['без основания, но со STI-161']);
    for (const c of cases) {
      const s = subjectOf(c.subject);
      expect(socfundNeeded(s, dict)).toBe(false);
      expect(socfundAuto(s, dict)).toBeNull();
      expect(socfundState(s, choiceOf(c.current), dict)).toBeNull();
      // Признаки сохраняются, тариф не меняется (прототип sfApply без sfAuto).
      const flags = socfundFlagsOf({ cashless: true });
      const out = socfundDecide(s, choiceOf(c.current), { flags, tariff: 'spino' }, dict);
      expect(out).toEqual({ flags, choice: choiceOf(c.current), changed: false });
    }
  });
});

describe('Сохранение признаков и тарифа — как в прототипе', () => {
  it.each(
    fixture.saves
      .map((x, i) => ({ ...x, i, name: fixture.cases[x.case]!.name }))
      .filter((x) => !byReportOnly(fixture.cases[x.case]!.subject)),
  )('$i: $name', ({ case: k, input, expected }) => {
    const c = fixture.cases[k]!;
    const s = subjectOf(c.subject);
    const choice = choiceOf(c.current);
    // Выбор, которого не трогали, в запрос не приходит.
    const req: SocfundInput = {
      flags: socfundFlagsOf(input.flags),
      reason: input.reason,
      ...(input.touched ? { tariff: (input.tariff as SocfundTariffId | null) ?? null } : {}),
    };
    const draft = { ...s, flags: req.flags };
    expect(socfundManualMismatch(draft, req, dict)).toBe(expected.manBad);
    const out = socfundDecide(s, choice, req, dict);
    expect(out.choice?.id ?? null).toBe(expected.sfT);
    expect(out.choice?.manual ?? false).toBe(expected.sfMan);
    expect(out.choice?.reason ?? '').toBe(expected.sfWhy);
    // Статус СПиНО идёт за тарифом, когда тариф меняется (прототип sfSet).
    const spino = out.changed ? out.choice?.id === 'spino' : s.benefits.includes('ЛЬГ-29');
    expect(spino).toBe(expected.spino);

    // История: признаки (если изменились) и тариф (если сменился или выбран вручную).
    const log: string[] = [];
    if (JSON.stringify(out.flags) !== JSON.stringify(s.flags)) {
      log.push(socfundFlagsHistoryText(out.flags, t));
    }
    if (out.changed) {
      const line = socfundTariffHistoryText(choice, out.choice, dict, t);
      if (line) log.push(line);
    }
    expect(log).toEqual(expected.log);
  });

  it('без изменения выбора и признаков ничего не меняется', () => {
    const c = fixture.cases[0]!;
    const s = subjectOf(c.subject);
    const out = socfundDecide(s, choiceOf(c.current), { flags: s.flags }, dict);
    expect(out.changed).toBe(false);
    expect(out.choice).toEqual(choiceOf(c.current));
  });

  it('ручной выбор вопреки условиям — текст подтверждения с причиной', () => {
    const c = fixture.cases.find((x) => x.name === 'п. 39: резидент ПКИ')!;
    const s = subjectOf(c.subject);
    expect(socfundConfirmText(s, null, { flags: s.flags, tariff: 'spino' }, dict, t)).toBe(
      '«СПиНО» расходится с условиями: Статус «Резидент ПКИ». Сохранить ручной выбор? В истории контрагента запишется, кто и почему его поставил.',
    );
    const none = fixture.cases.find((x) => x.name === 'нет подтверждения ГНС и реестра')!;
    const n = subjectOf(none.subject);
    expect(socfundConfirmText(n, null, { flags: n.flags, tariff: 'spino' }, dict, t)).toBe(
      '«СПиНО» расходится с условиями: не указано: реестр работников, подтверждение ГНС. Сохранить ручной выбор? В истории контрагента запишется, кто и почему его поставил.',
    );
  });
});

describe('Названия, ставки и предельная база тарифа', () => {
  it.each(fixture.titles)('$id', ({ id, title, short, rates, cap }) => {
    const x = dict.tariffs.find((y) => y.id === id)!;
    expect(socfundTitle(x, dict)).toBe(title);
    expect(socfundShort(x)).toBe(short);
    expect(socfundRatesText(x, t)).toBe(rates);
    expect(socfundCapText(x, t)).toBe(cap);
  });
});

describe('Подсказка о пене — как в прототипе', () => {
  it.each(fixture.penalties.map((x, i) => ({ ...x, i })))('$i', ({ report, expected }) => {
    const p = fixture.dict.penalties.find((x) => x.type === report.reportTypeCode) ?? null;
    expect(penaltyText(report, p, fixture.today, t)).toBe(expected);
  });
});
