'use client';

import {
  dueRuleText,
  payRuleText,
  paysText,
  type GkedRule,
  type ReportPeriod,
} from '@buhuchet/domain';
import type { ReportType, Tax, Taxes } from '@buhuchet/shared';
import {
  ActPill,
  Icon,
  KeyValues,
  MONO_CLASS,
  Note,
  Pill,
  Tag,
  type IconName,
  type KeyValueItem,
} from '@buhuchet/ui';
import type { ReactNode } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import type { Catalog } from './dicts-data';

/*
 * Содержательные описания справочников (ТЗ «Форма просмотра налога и вида отчёта»; прототип
 * modules/dict-guide.js и report-pick.js): форма просмотра налога (`TaxGuide`), вида отчёта
 * (`TypeGuide`) и описание строки в «Выборе налогов» (`TypeDesc`). Пустые значения и «—» не
 * показываются, раздел без значений — тоже; в описании строки «Выбора налогов» «—» видно, как в
 * прототипе (`pkDescHtml`).
 */

/** Строка «подпись — значение»; пустое значение — строки нет. */
type KvRow = readonly [label: string, value: ReactNode, mono?: boolean] | null | false;

const blank = (v: ReactNode, dash = false) =>
  v === null ||
  v === undefined ||
  v === false ||
  (typeof v === 'string' && (dash ? /^\s*$/ : /^\s*(—\s*)?$/).test(v));

/**
 * Пары «подпись — значение» без пустых (прототип tgKv); нет ни одной — ничего. `dash` — строка со
 * значением «—» остаётся (прототип pkDescHtml).
 */
function kv(rows: readonly KvRow[], columns: 'auto' | 2 = 'auto', dash = false): ReactNode {
  const items: KeyValueItem[] = rows.flatMap((r, i) =>
    r && !blank(r[1], dash)
      ? [{ id: String(i), label: r[0], value: r[1], mono: r[2] ?? false }]
      : [],
  );
  return items.length ? <KeyValues items={items} columns={columns} /> : null;
}

/** Раздел формы (`.tg-sec`): заголовок прописными со значком; пустой раздел не показывается. */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
}) {
  if (blank(children)) return null;
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h4 className="m-0 flex items-center gap-1.5 text-[11.5px] font-bold tracking-[.06em] text-muted uppercase">
        <Icon name={icon} size="sm" />
        {title}
      </h4>
      {children}
    </section>
  );
}

/** Разделы одной формы: между ними черта (`.tg-sec + .tg-sec`). */
const SECTIONS_CLASS =
  'flex min-w-0 flex-col gap-3 [&>section+section]:border-t [&>section+section]:border-line [&>section+section]:pt-3';

const Para = ({ children }: { children: ReactNode }) => (
  <p className="m-0 text-[13.5px] leading-normal text-ink">{children}</p>
);

const List = ({ items }: { items: readonly ReactNode[] }) =>
  items.length ? (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-[18px]">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  ) : null;

const Mono = ({ children }: { children: ReactNode }) => (
  <span className={MONO_CLASS}>{children}</span>
);

/** Ссылка на источник — только http и https, открывается в новой вкладке; иначе — текстом. */
function SourceLink({ url, title }: { url: string; title?: string }) {
  if (!/^https?:\/\//i.test(url)) return <>{title || url}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-words text-link">
      {title || url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0]}
    </a>
  );
}

/** «Сверить: … Проверьте на сайте ГНС или в органе перед применением.» */
function VerifyNote({ on, text }: { on: boolean; text: string }) {
  const t = useT();
  if (!on) return null;
  return (
    <Note tone="warn">
      <b>{t('dicts.guide.verify')}</b>{' '}
      {t('dicts.guide.verify_text', { text: text || t('dicts.guide.verify_default') })}
    </Note>
  );
}

const VerifyPill = () => {
  const t = useT();
  return (
    <Pill tone="warn" size="sm" icon="alert">
      {t('dicts.guide.verify_pill')}
    </Pill>
  );
};

const PERIOD_LABEL: Record<
  ReportPeriod,
  'report.period.m' | 'report.period.q' | 'report.period.h' | 'report.period.y'
> = {
  M: 'report.period.m',
  Q: 'report.period.q',
  H: 'report.period.h',
  Y: 'report.period.y',
};

/** Периодичность задаётся в назначении: внутренний вид или «Периодичность — в назначении». */
export const periodOwn = (x: ReportType) => x.kind === 'internal' || x.periodPerAssignment;

/** «Периодичность» в описании: разовый, «задаётся в назначении» или период. */
const periodText = (x: ReportType, t: Translate) =>
  x.oneOff
    ? t('dicts.guide.per_oneoff')
    : periodOwn(x)
      ? t('dicts.guide.per_own')
      : t(PERIOD_LABEL[x.period]);

const whoText = (x: ReportType, t: Translate) => t(`dicts.guide.who.${x.payer}`);

const gkedEmpty = (r: GkedRule | null): r is null => !r || (!r.in.length && !r.ex.length);

/** «Виды деятельности (ГКЭД)»: коды или «все», «кроме …» (прототип gkRuleTxt). */
const gkedText = (r: GkedRule, t: Translate) =>
  [
    r.in.length ? r.in.join(', ') : t('dicts.guide.gked_all'),
    r.ex.length ? t('dicts.guide.gked_except', { codes: r.ex.join(', ') }) : '',
  ]
    .filter(Boolean)
    .join('; ');

/** Перечни ГКЭД для ИП и ИТД (прототип GK_INFO). */
const GKED_LISTS = [
  ['ip', 'dicts.guide.gked_ip'],
  ['ipEx', 'dicts.guide.gked_ip_ex'],
  ['itd', 'dicts.guide.gked_itd'],
] as const;

const actLabel = (x: ReportType, t: Translate) => t(`report.act.${x.act}`);

/** Налоги, к которым относится вид: у налога вид — в «Видах отчётов» (прототип taxesOfType). */
export const taxesOfType = (taxes: readonly Tax[], code: string) =>
  taxes.filter((x) => x.guide.reportTypes.includes(code));

/** Строки ставок с тарифами по фондам (прототип tgTariffs). */
function Tariffs({ tax }: { tax: Tax }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      {tax.guide.tariffs.map((r, i) => (
        <div
          key={i}
          className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-[9px]"
        >
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-2">
            <b className="text-[16px] whitespace-nowrap tabular-nums">{r.total}</b>
            <span className="min-w-0 grow">
              {r.name}
              {r.who ? <span className="text-faint"> · {r.who}</span> : null}
            </span>
            {r.since ? <Tag>{t('dicts.tax.since', { date: r.since })}</Tag> : null}
            {r.verify ? <VerifyPill /> : null}
          </div>
          {r.parts.map((p, j) => (
            <div key={j} className="flex flex-col gap-0.5">
              <div className="flex justify-between gap-2.5 text-[13px] font-semibold">
                <span>{p.payer}</span>
                <b className="whitespace-nowrap tabular-nums">{p.rate}</b>
              </div>
              {p.funds.length ? (
                <ul className="m-0 flex list-none flex-col gap-px p-0 pl-3">
                  {p.funds.map((f, k) => (
                    <li key={k} className="flex justify-between gap-2.5 text-[13px] text-muted">
                      <span>{f.fund}</span>
                      <b className="whitespace-nowrap tabular-nums">{f.rate}</b>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          {r.cap ? (
            <div className="flex items-start gap-1.5 border-t border-dashed border-line pt-1.5 text-[13px]">
              <Icon name="alert" size="sm" className="mt-px" />
              <span>
                {t('dicts.tax.cap')} <b>{r.cap.amount}</b>
                {r.cap.since ? ` ${t('dicts.tax.since', { date: r.cap.since })}` : ''}
                {r.cap.note ? ` (${r.cap.note})` : ''}
              </span>
            </div>
          ) : null}
          {r.law || r.verifyNote ? (
            <div className="text-[12px] text-faint">
              {[r.law, r.verifyNote ? t('dicts.tax.verify_note', { note: r.verifyNote }) : '']
                .filter(Boolean)
                .join(' · ')}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** «Ставки»: тарифы по фондам, ставки «ставка — когда» или ставка строкой (прототип taxGuideHtml). */
function Rates({ tax }: { tax: Tax }) {
  const g = tax.guide;
  if (g.tariffs.length) return <Tariffs tax={tax} />;
  if (g.rates.length) {
    return (
      <div className="flex flex-col gap-1.5">
        {g.rates.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 rounded-lg border border-line bg-raised px-2.5 py-[7px] max-md:grid-cols-1"
          >
            <b className="whitespace-nowrap tabular-nums">{r.rate}</b>
            <span className="text-[13px] text-muted">{r.when}</span>
          </div>
        ))}
      </div>
    );
  }
  return tax.rates ? <Para>{tax.rates}</Para> : null;
}

/**
 * Форма просмотра налога (ТЗ «Форма просмотра налога»; прототип taxGuideHtml): метки группы, уровня,
 * органа и периода, затем «Что это», «Кто платит и с чего», «Ставки», «Кто платит по полному тарифу»,
 * «Кто администрирует», «Сроки», «Связи», «Освобождения», «Важно знать», «Как проверить», «Статья НК»
 * с пометкой «Сверить» и «Источники».
 */
export function TaxGuide({
  tax,
  catalog,
  gkedNames,
}: {
  tax: Tax;
  catalog: Catalog;
  gkedNames: Taxes['gkedNames'];
}) {
  const t = useT();
  const g = tax.guide;
  const gked = (codes: readonly string[]) =>
    codes.length
      ? codes.map((c) => (
          <span key={c} className="block">
            <Mono>{c}</Mono> {gkedNames[c] ?? ''}
          </span>
        ))
      : null;
  const types = (g.reportTypes.length ? g.reportTypes : tax.reportTypes).map((code) => {
    const x = catalog.type(code);
    return (
      <span key={code} className="block">
        {x ? x.name : code}
        {x?.formCode ? (
          <>
            {' '}
            <span className={`text-faint ${MONO_CLASS}`}>{x.formCode}</span>
          </>
        ) : null}
      </span>
    );
  });
  const tags = [tax.group, tax.level, g.organ || tax.organ, g.period || tax.period].filter(Boolean);
  return (
    <div className={SECTIONS_CLASS}>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((v, i) => (
          <Tag key={i}>{v}</Tag>
        ))}
        {tax.verify ? <VerifyPill /> : null}
      </div>
      <Section title={t('dicts.tax.about')} icon="info">
        {g.about ? <Para>{g.about}</Para> : null}
      </Section>
      <Section title={t('dicts.tax.payers_base')} icon="users">
        {kv([
          [t('dicts.tax.payers'), g.payers || tax.payers],
          [t('dicts.tax.base'), g.base || tax.base],
        ])}
      </Section>
      <Section title={t('dicts.tax.rates')} icon="coins">
        <Rates tax={tax} />
      </Section>
      <Section title={t('dicts.tax.full_tariff')} icon="list">
        {g.exceptions27.length ? <List items={g.exceptions27} /> : null}
      </Section>
      <Section title={t('dicts.tax.admin')} icon="landmark">
        {kv(g.admin.map((a) => [a.organ, a.what] as const))}
      </Section>
      <Section title={t('dicts.tax.dues')} icon="calendar">
        {kv([
          [t('dicts.tax.period'), g.period || tax.period],
          [t('dicts.tax.report_due'), g.reportDue || tax.reportDue],
          [t('dicts.tax.pay_due'), g.payDue || tax.payDue],
          [t('dicts.tax.pays'), g.pays],
          [t('dicts.tax.form'), g.form || tax.form],
          [t('dicts.tax.organ'), g.organ || tax.organ],
        ])}
      </Section>
      <Section title={t('dicts.tax.links')} icon="link">
        {kv([
          [t('dicts.tax.regimes_pay'), g.regimesPay],
          [t('dicts.tax.regimes_free'), g.regimesFree],
          [t('dicts.tax.benefits'), g.benefits.map(benefitName(catalog)).join(', ')],
          [t('dicts.tax.bases'), g.bases.map(catalog.base).join(', ')],
          [t('dicts.guide.gked'), gked(g.gked)],
          [t('dicts.tax.gked_ex'), gked(g.gkedExclude)],
          [t('dicts.tax.types'), types.length ? types : t('dicts.tax.types_none')],
        ])}
      </Section>
      <Section title={t('dicts.tax.exemptions')} icon="ban">
        {blank(g.exemptions) ? null : <Para>{g.exemptions}</Para>}
      </Section>
      <Section title={t('dicts.tax.notes')} icon="alert">
        {g.notes.length ? <List items={g.notes} /> : null}
      </Section>
      <Section title={g.check?.title || t('dicts.tax.check')} icon="search">
        {g.check?.ways.length ? (
          <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5">
            {g.check.ways.map((w, i) => (
              <li key={i}>
                <b>{w.name}</b>
                <List items={w.steps} />
              </li>
            ))}
          </ol>
        ) : null}
      </Section>
      <Section title={t('dicts.tax.art')} icon="book">
        <Para>{g.art || tax.art || '—'}</Para>
        <VerifyNote on={tax.verify} text={g.verifyNote} />
      </Section>
      <Section title={t('dicts.tax.sources')} icon="globe">
        {g.sources.length ? (
          <List
            items={g.sources.map((s, i) => (
              <SourceLink key={i} url={s.url} title={s.title} />
            ))}
          />
        ) : null}
      </Section>
    </div>
  );
}

const benefitName = (catalog: Catalog) => (code: string) =>
  catalog.benefits.find((b) => b.code === code)?.name ?? code;

/** Налог свёрнутым блоком (`details.tg-tax`): название и код; один налог — раскрыт. */
function TaxBlock({
  tax,
  open,
  prefix,
  catalog,
  gkedNames,
}: {
  tax: Tax;
  open: boolean;
  prefix: string;
  catalog: Catalog;
  gkedNames: Taxes['gkedNames'];
}) {
  return (
    <details
      open={open}
      data-tax={tax.code}
      className="group mt-3.5 rounded-xl border border-line bg-pane"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 group-open:border-b group-open:border-line [&::-webkit-details-marker]:hidden">
        <Icon name="coins" size="sm" />
        <span className="min-w-0 flex-1">
          {prefix ? `${prefix} ` : ''}
          <b>{tax.name}</b> <span className={`text-faint ${MONO_CLASS}`}>{tax.code}</span>
        </span>
        <Icon name="down" size="sm" className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3.5 pt-3 pb-3.5">
        <TaxGuide tax={tax} catalog={catalog} gkedNames={gkedNames} />
      </div>
    </details>
  );
}

/** Строки «Описания» вида, общие у формы просмотра и «Выбора налогов». */
function typeRows(x: ReportType, catalog: Catalog, t: Translate) {
  return {
    code: x.formCode ? <Mono>{x.formCode}</Mono> : '—',
    index: x.statIndex ? <Mono>{x.statIndex}</Mono> : null,
    organ: catalog.authority(x.authorityCode),
    period: periodText(x, t),
    due: dueRuleText(x, t),
    pay: x.act !== 'sub' ? payRuleText(x, t) : null,
    act: <ActPill act={x.act} label={actLabel(x, t)} />,
    pays: x.act !== 'sub' ? paysText(x.payments, catalog.authority(x.authorityCode)) : null,
    rates: x.rates.length ? x.rates.join(', ') : null,
    bases: x.bases.length ? x.bases.map(catalog.base).join('; ') : null,
  };
}

/**
 * Форма просмотра вида отчёта (ТЗ, решение заказчика 19.10.2026; прототип typeGuideHtml): «Что это за
 * отчёт» — описание, выбор, пояснение для контрагента, код формы, орган, периодичность, сроки, «Что
 * нужно сделать», «Что уплачивается», ставки, тип, основание, ГКЭД, «Для кого», статья НК, примечание и
 * «Сверить»; ниже — налоги, к которым относится вид: один — раскрыт, несколько — свёрнуты.
 */
export function TypeGuide({
  type: x,
  catalog,
  taxes,
}: {
  type: ReportType;
  catalog: Catalog;
  taxes: Taxes;
}) {
  const t = useT();
  const r = typeRows(x, catalog, t);
  const own = taxesOfType(taxes.items, x.code);
  const lists = x.gked
    ? GKED_LISTS.flatMap(([key, label]) => {
        const codes = x.gked?.[key] ?? [];
        return codes.length ? [[t(label), codes.join(', ')] as const] : [];
      })
    : [];
  const gkedLists = !!x.gked && !!(x.gked.ip?.length || x.gked.itd?.length);
  return (
    <>
      <div className={SECTIONS_CLASS}>
        <Section title={t('dicts.guide.about_type')} icon="file">
          {x.description ? <Para>{x.description}</Para> : null}
          {x.choiceNote ? <Note>{x.choiceNote}</Note> : null}
          {x.clientNote ? (
            <Note icon="user">
              <b>{t('dicts.guide.for_client')}</b> {x.clientNote}
            </Note>
          ) : null}
          {kv([
            [t('dicts.col.code'), r.code],
            [t('dicts.col.organ'), r.organ],
            [t('dicts.col.index'), r.index],
            [t('dicts.guide.respondents'), x.respondents],
            [t('dicts.col.per'), r.period],
            [t('dicts.col.rule'), r.due],
            [t('dicts.col.payrule'), r.pay],
            [t('dicts.guide.act'), r.act],
            [t('dicts.col.pays'), r.pays],
            [t('dicts.col.rates'), r.rates],
            [
              t('dicts.guide.rate_add'),
              x.rateAdditions
                .map((a) => `${a.rate} — ${a.name}${a.art ? ` (${a.art})` : ''}`)
                .join('; '),
            ],
            [
              t('dicts.col.kind'),
              x.kind === 'regime'
                ? t('dicts.guide.kind_regime', {
                    regimes: x.regimes.map(catalog.regime).join(', '),
                  })
                : t(`report.kind.${x.kind}`),
            ],
            [t('dicts.guide.bases'), r.bases],
            !gkedEmpty(x.gked) && [
              t('dicts.guide.gked'),
              gkedLists
                ? t('dicts.guide.gked_org', { rule: gkedText(x.gked, t) })
                : gkedText(x.gked, t),
            ],
            ...lists,
            [t('dicts.guide.who'), whoText(x, t)],
            [t('dicts.guide.art_type'), x.article],
            [t('dicts.guide.note'), x.note],
          ])}
          <VerifyNote on={x.verify} text={x.verifyNote} />
        </Section>
      </div>
      {own.map((tax) => (
        <TaxBlock
          key={tax.code}
          tax={tax}
          open={own.length === 1}
          prefix={own.length === 1 ? t('dicts.guide.tax_one') : ''}
          catalog={catalog}
          gkedNames={taxes.gkedNames}
        />
      ))}
    </>
  );
}

/**
 * Описание вида в строке «Выбора налогов» (ТЗ: «то же, что в «Подборе отчётов»»; прототип pkDescHtml):
 * название с пометкой «сверить», описание, выбор, подсказка, «Данные уточняются», пары «подпись —
 * значение» и свёрнутые налоги. «Ближайший срок» и «Срок по статусу» добавит «Подбор отчётов»
 * контрагента (docs/decisions.md).
 */
export function TypeDesc({
  type: x,
  catalog,
  taxes,
}: {
  type: ReportType;
  catalog: Catalog;
  taxes: Taxes | undefined;
}) {
  const t = useT();
  const r = typeRows(x, catalog, t);
  const adds = catalog.benefits.filter((b) => b.adds.includes(x.code)).map((b) => b.name);
  const removes = catalog.benefits.filter((b) => b.removes.includes(x.code)).map((b) => b.name);
  const own = taxes ? taxesOfType(taxes.items, x.code) : [];
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="m-0 flex flex-wrap items-center gap-1.5 text-[15px] leading-[1.3] font-bold">
        {x.name}
        {x.verify ? <VerifyPill /> : null}
      </h3>
      {x.description ? <Para>{x.description}</Para> : null}
      {x.choiceNote ? <Note>{x.choiceNote}</Note> : null}
      {x.pickHint ? (
        <div className="text-[11.5px] leading-[1.4] text-faint">{x.pickHint}</div>
      ) : null}
      {x.verify ? (
        <Note tone="warn">
          {x.verifyNote
            ? t('dicts.guide.pick_verify_note', { note: x.verifyNote })
            : t('dicts.guide.pick_verify')}
        </Note>
      ) : null}
      {kv(
        [
          [t('dicts.col.organ'), r.organ],
          [t('dicts.col.code'), r.code],
          [t('dicts.col.index'), r.index],
          [t('dicts.guide.respondents'), x.respondents],
          [t('dicts.col.per'), r.period],
          [x.act === 'pay' ? t('dicts.guide.due') : t('dicts.col.rule'), r.due],
          !x.oneOff && [t('dicts.col.payrule'), r.pay],
          [t('dicts.guide.act'), r.act],
          x.act !== 'sub' && [t('dicts.col.pays'), r.pays || '—'],
          [t('dicts.col.rates'), r.rates],
          [
            t('dicts.col.regimes'),
            x.regimes.length
              ? x.regimes.map(catalog.regime).join(', ')
              : t('dicts.guide.regimes_any'),
          ],
          [t('dicts.guide.bases'), r.bases],
          [t('dicts.guide.benefit_adds'), adds.join(', ')],
          [t('dicts.guide.benefit_removes'), removes.join(', ')],
          !gkedEmpty(x.gked) && [
            t('dicts.guide.gked'),
            <>
              {gkedText(x.gked, t)}
              {x.gked.hint ? (
                <span className="text-faint"> {t('dicts.guide.gked_hint')}</span>
              ) : null}
            </>,
          ],
          [t('dicts.guide.who'), whoText(x, t)],
          [t('dicts.guide.art_type'), x.article],
          x.source ? [t('dicts.guide.source'), <SourceLink key="src" url={x.source} />] : null,
        ],
        2,
        true,
      )}
      {taxes
        ? own.map((tax) => (
            <TaxBlock
              key={tax.code}
              tax={tax}
              open={false}
              prefix={t('dicts.guide.tax_more')}
              catalog={catalog}
              gkedNames={taxes.gkedNames}
            />
          ))
        : null}
    </div>
  );
}
