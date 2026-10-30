'use client';

import {
  benefitDueText,
  bishkekDate,
  formatDateRu,
  regimeAccountantNote,
  singleTaxRateParts,
} from '@buhuchet/domain';
import type {
  Authority,
  OwnershipForm,
  ReportBase,
  SingleTaxRate,
  TaxBenefit,
  TaxOffice,
  TaxRegime,
} from '@buhuchet/shared';
import { KeyValues, Note, Pill, type KeyValueItem } from '@buhuchet/ui';
import type { ReactNode } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import type { Catalog } from './dicts-data';
import {
  gkedEmpty,
  gkedText,
  kv,
  Para,
  Section,
  SECTIONS_CLASS,
  VerifyNote,
  VerifyPill,
} from './type-guide';

/*
 * Описание значения справочника платформы (ТЗ «Справочники платформы — только просмотр»; прототип
 * modules/dict-guide.js `valueGuideHtml`, `enRateViewDlg` и report-pick.js `benDescHtml`): режим,
 * форма собственности, орган с контактами, основание, льгота или статус, ставка единого налога.
 * Пустые значения и «—» не показываются; нет ни одного — «Пояснения нет».
 */

const None = () => {
  const t = useT();
  return <span className="text-faint">{t('dicts.value.none')}</span>;
};

/** Пары или «Пояснения нет». */
const orNone = (node: ReactNode) => node ?? <None />;

/** Режим: полное название, тип, от чего освобождает, кто применяет, переход, совмещение, статья. */
export function RegimeGuide({ x }: { x: TaxRegime }) {
  const t = useT();
  return orNone(
    kv([
      [t('dicts.value.full'), x.fullName || x.name],
      [t('dicts.value.kind'), t(`dicts.value.regime_kind.${x.kind}`)],
      [t('dicts.value.frees'), x.frees],
      [t('dicts.value.who_uses'), x.who],
      [t('dicts.value.how'), x.how],
      [t('dicts.value.combines'), x.combines],
      [t('dicts.value.acc'), regimeAccountantNote(x.accountantNote)],
      [t('dicts.value.art'), x.article],
    ]),
  );
}

/** Форма собственности: код, полное название, кем считается для ЕНД, что меняет в налогах. */
export function FormGuide({ x }: { x: OwnershipForm }) {
  const t = useT();
  return orNone(
    kv([
      [t('dicts.value.code'), x.code],
      [t('dicts.value.full'), x.fullName],
      [t('dicts.value.end'), t(`dicts.value.end.${x.declarationFor}`)],
      [t('dicts.value.form_note'), x.note],
    ]),
  );
}

/** Сайт органа: только http и https, без «https://» и косой черты в конце. */
function SiteLink({ url }: { url: string }) {
  if (!/^https?:\/\//i.test(url)) return <>{url}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-words text-link">
      {url.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
    </a>
  );
}

/**
 * Орган: «Что это» — код, что туда сдают, виды отчётов органа; «Контакты» — телефоны ссылками для
 * звонка, график, сайт и «Сверить». Контактов нет — только пары без разделов.
 */
export function OrganGuide({ x, catalog }: { x: Authority; catalog: Catalog }) {
  const t = useT();
  const types = catalog.types
    .filter((r) => r.authorityCode === x.code)
    .map((r) => r.shortName)
    .join(', ');
  const info = kv([
    [t('dicts.value.code'), x.code],
    [t('dicts.value.organ_note'), x.description],
    [t('dicts.value.types'), types],
  ]);
  const contacts = kv([
    ...x.contacts.map(
      (c) =>
        [
          c.label,
          <a key={c.value} href={`tel:${c.value.replace(/[^\d+]/g, '')}`} className="text-link">
            {c.value}
          </a>,
        ] as const,
    ),
    [t('dicts.value.hours'), x.hours],
    [t('dicts.value.site'), x.site ? <SiteLink url={x.site} /> : null],
  ]);
  if (!contacts) return orNone(info);
  return (
    <div className={SECTIONS_CLASS}>
      <Section title={t('dicts.value.about')} icon="info">
        {info}
      </Section>
      <Section title={t('dicts.value.contacts')} icon="chat">
        {contacts}
        <VerifyNote on={!!x.contactsNote} text={x.contactsNote} />
      </Section>
    </div>
  );
}

/** Основание: код, описание, виды отчётов с этим основанием. */
export function BaseGuide({ x, catalog }: { x: ReportBase; catalog: Catalog }) {
  const t = useT();
  return orNone(
    kv([
      [t('dicts.value.code'), x.code],
      [t('dicts.value.desc'), x.description],
      [
        t('dicts.value.types'),
        x.reportTypes.map((c) => catalog.type(c)?.shortName ?? c).join(', '),
      ],
    ]),
  );
}

/** УГНС подписью: «код ГНС · краткое название» (прототип `ugnsLabel`). */
const officeLabel = (offices: readonly TaxOffice[], code: string) => {
  const u = offices.find((o) => o.code === code);
  return u ? `${u.gnsCode ? `${u.gnsCode} · ` : ''}${u.shortName}` : code;
};

/** Пары описания льготы: пустые строки не показываются, «Что даёт» — всегда (пусто — «—»). */
function benefitItems(
  x: TaxBenefit,
  catalog: Catalog,
  offices: readonly TaxOffice[],
  t: Translate,
  ownOffice: ReactNode,
): KeyValueItem[] {
  const short = (codes: readonly string[]) =>
    codes.map((c) => catalog.type(c)?.shortName ?? c).join(', ');
  const due = benefitDueText(x.dueRules, catalog.type, t);
  const gked = x.gked;
  const rows: (readonly [label: string, value: ReactNode, wide?: boolean] | false)[] = [
    [t('dicts.value.ben_kind'), t(`dicts.value.ben_kind.${x.kind}`)],
    [t('dicts.value.gives'), x.gives || '—', true],
    !!due && [t('dicts.value.due'), due],
    x.taxOffices.length > 0 && [
      t('dicts.value.ugns'),
      <>
        {x.taxOffices.map((c) => officeLabel(offices, c)).join(', ')}
        {ownOffice ? <> {ownOffice}</> : null}
      </>,
    ],
    [t('dicts.value.payer'), t(`dicts.guide.who.${x.payer}`)],
    !!x.conditions && [t('dicts.value.conditions'), x.conditions, true],
    !!x.confirmation && [t('dicts.value.confirm'), x.confirmation],
    !!x.combines && [t('dicts.value.combines'), x.combines],
    !!(x.term || x.validUntil) && [
      t('dicts.value.term'),
      x.term || t('dicts.value.until', { date: formatDateRu(x.validUntil!) }),
    ],
    !gkedEmpty(gked) && [
      t('dicts.guide.gked'),
      <>
        {gkedText(gked, t)}
        {gked.hint ? <span className="text-faint"> {t('dicts.guide.gked_hint')}</span> : null}
        {gked.note ? (
          <div className="text-[11.5px] leading-[1.4] text-faint">{gked.note}</div>
        ) : null}
      </>,
    ],
    !!gked?.warn?.length && [t('dicts.value.gked_warn'), gked.warn.join(', ')],
    x.adds.length > 0 && [t('dicts.value.adds'), short(x.adds)],
    x.removes.length > 0 && [t('dicts.value.removes'), short(x.removes)],
    !!x.article && [t('dicts.value.art_full'), x.article],
  ];
  return rows.flatMap((r, i) =>
    r ? [{ id: String(i), label: r[0], value: r[1], wide: r[2] ?? false }] : [],
  );
}

/**
 * Льгота или особый статус (прототип `benDescHtml`): название с «сверить», «Данные уточняются», тип,
 * что даёт, меняет сроки, УГНС, кто может применять, условия, подтверждение, совмещение, срок
 * действия, ГКЭД, добавляемые и ненужные отчёты, статья. В окне «Льготы и особые статусы»: `office` —
 * УГНС контрагента (у «Ставится по УГНС» — метка «у контрагента»), `footer` — «Подходит» / «Не
 * подходит».
 */
export function BenefitGuide({
  x,
  catalog,
  offices,
  office,
  footer,
}: {
  x: TaxBenefit;
  catalog: Catalog;
  offices: readonly TaxOffice[];
  office?: { code: string | null; label: string };
  footer?: ReactNode;
}) {
  const t = useT();
  const own =
    office?.code && x.taxOffices.includes(office.code) ? (
      <Pill tone="info" size="sm">
        {office.label}
      </Pill>
    ) : null;
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="m-0 flex flex-wrap items-center gap-1.5 text-[15px] leading-[1.3] font-bold">
        {x.name}
        {x.verify ? <VerifyPill /> : null}
      </h3>
      {x.verify ? (
        <Note tone="warn">
          {x.verifyNote
            ? t('dicts.value.verify_note', { note: x.verifyNote })
            : t('dicts.value.verify')}
        </Note>
      ) : null}
      <KeyValues items={benefitItems(x, catalog, offices, t, own)} columns={2} />
      {footer}
    </div>
  );
}

/**
 * Ставка единого налога: «Когда применяется» — пояснение; «Условия» — ставка, безналичная и
 * наличная выручка, условие, к каким ставкам добавляется, строки суммы в отчёте на сегодня, ГКЭД и
 * статья.
 */
export function SingleTaxRateGuide({
  x,
  rates,
}: {
  x: SingleTaxRate;
  rates: readonly SingleTaxRate[];
}) {
  const t = useT();
  const parts = singleTaxRateParts(x, rates, bishkekDate(new Date()), t);
  return (
    <div className={SECTIONS_CLASS}>
      <Section title={t('dicts.value.en_when')} icon="info">
        {x.explanation ? <Para>{x.explanation}</Para> : null}
      </Section>
      <Section title={t('dicts.value.en_terms')} icon="list">
        {kv([
          [t('dicts.value.en_rate'), x.rate],
          [t('dicts.value.en_cashless'), x.rateCashless],
          [t('dicts.value.en_cash'), x.rateCash],
          [t('dicts.value.en_cond'), x.conditions],
          [t('dicts.value.en_adds'), x.addsTo.join(', ')],
          [t('dicts.value.en_parts'), parts.map((p) => `${p.name}, ${p.pct}`).join('; ')],
          !gkedEmpty(x.gked) && [t('dicts.guide.gked'), gkedText(x.gked, t)],
          [t('dicts.value.art'), x.article],
        ])}
      </Section>
    </div>
  );
}
