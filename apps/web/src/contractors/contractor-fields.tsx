'use client';

import {
  BIZ_SIZES,
  formatDateRu,
  officeBenefitChanges,
  type BizSize,
  type Translate,
} from '@buhuchet/domain';
import type { ContractorGkedNotes, OwnershipForm, TaxOffice } from '@buhuchet/shared';
import { buttonClass, Field, Icon, inputClass, Note, Segments, Tag } from '@buhuchet/ui';
import type { Catalog } from '../dicts/dicts-data';
import { useT } from '../l10n/provider';
import type { BenefitChoice } from './benefit-pick';

/*
 * Поля формы контрагента, общие у создания и «Изменить» (прототип modules/contractor-form.js: addCpDlg,
 * editCpDlg, sizeSeg, basesChips; modules/report-pick.js: benLine; modules/contractors.js: ugAuto,
 * ugDrop, ugMsg): форма собственности, УГНС, режимы, размер бизнеса, строка льгот и основания.
 */

/** «Отключённое» значение справочника видно, только если оно уже выбрано у контрагента. */
const shown = <T extends { code: string; active: boolean }>(items: readonly T[], keep: string) =>
  items.filter((x) => x.active || x.code === keep);

export function FormSelect({
  id,
  forms,
  value,
  current = '',
  error,
  required = false,
  onChange,
}: {
  id: string;
  forms: readonly OwnershipForm[];
  value: string;
  /** Форма контрагента до правки: отключённая в справочнике остаётся в списке. */
  current?: string;
  error?: string | undefined;
  required?: boolean;
  onChange: (code: string) => void;
}) {
  const t = useT();
  return (
    <Field id={id} label={t('cp.form.form')} required={required} error={error}>
      {(control) => (
        <select
          {...control}
          className={`${inputClass()} cursor-pointer`}
          value={value}
          data-cp-field="form"
          onChange={(e) => onChange(e.target.value)}
        >
          {value ? null : <option value="">{t('cp.form.choose')}</option>}
          {shown(forms, current || value).map((f) => (
            <option key={f.code} value={f.code}>
              {f.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** «Налоговый орган (УГНС)»: «код ГНС · название» (прототип ugT). */
export function OfficeSelect({
  id,
  offices,
  value,
  current = '',
  onChange,
}: {
  id: string;
  offices: readonly TaxOffice[];
  value: string;
  current?: string;
  onChange: (code: string) => void;
}) {
  const t = useT();
  return (
    <Field id={id} label={t('cp.form.office')} hint={t('cp.form.office_hint')}>
      {(control) => (
        <select
          {...control}
          className={`${inputClass()} cursor-pointer`}
          value={value}
          data-cp-field="office"
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t('cp.form.not_set')}</option>
          {shown(offices, current || value).map((o) => (
            <option key={o.code} value={o.code}>
              {o.gnsCode ? `${o.gnsCode} · ${o.name}` : o.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Статусы, которые ставит УГНС (справочник льгот: «Ставится по УГНС»). */
export const officeBenefits = (catalog: Catalog, office: string): string[] =>
  office
    ? catalog.benefits.filter((b) => b.active && b.taxOffices.includes(office)).map((b) => b.code)
    : [];

/**
 * Смена УГНС (прототип ugAuto, ugDrop): статусы нового УГНС отмечаются, статусы прежнего снимаются;
 * `message` — «Отмечен статус «…» по УГНС; Снят статус «…» по УГНС» для уведомления (пусто — ничего
 * не поменялось).
 */
export function changeOffice(
  catalog: Catalog,
  benefits: readonly BenefitChoice[],
  from: string,
  to: string,
  t: Translate,
): { benefits: BenefitChoice[]; added: string[]; dropped: string[]; message: string } {
  const { add, drop } = officeBenefitChanges(
    benefits.map((b) => b.code),
    officeBenefits(catalog, from),
    officeBenefits(catalog, to),
  );
  const name = (code: string) => catalog.benefits.find((b) => b.code === code)?.name ?? code;
  return {
    benefits: [
      ...benefits.filter((b) => !drop.includes(b.code)),
      ...add.map((code) => ({ code, validFrom: null, validTo: null })),
    ],
    added: add,
    dropped: drop,
    message: [
      ...add.map((c) => t('cp.form.office_added', { name: name(c) })),
      ...drop.map((c) => t('cp.form.office_dropped', { name: name(c) })),
    ].join('; '),
  };
}

export function RegimeFields({
  idPrefix,
  regimeId = `${idPrefix}-reg`,
  catalog,
  regime,
  regime2,
  current,
  error,
  hints = true,
  onRegime,
  onRegime2,
}: {
  idPrefix: string;
  /** id поля режима: по нему форма прокручивает к ошибке. */
  regimeId?: string;
  catalog: Catalog;
  regime: string;
  regime2: string;
  /** Режимы контрагента до правки: отключённые в справочнике остаются в списке. */
  current?: { regime: string; regime2: string };
  error?: string | undefined;
  /** Подсказки под полями (у формы создания). */
  hints?: boolean;
  onRegime: (code: string) => void;
  onRegime2: (code: string) => void;
}) {
  const t = useT();
  const label = (r: { name: string; fullName: string }) => r.fullName || r.name;
  return (
    <>
      <Field
        id={regimeId}
        label={t('cp.form.regime')}
        hint={hints && !regime ? t('cp.form.regime_hint') : undefined}
        error={error}
      >
        {(control) => (
          <select
            {...control}
            className={`${inputClass()} cursor-pointer`}
            value={regime}
            data-cp-field="regime"
            onChange={(e) => onRegime(e.target.value)}
          >
            <option value="">{t('cp.form.not_set')}</option>
            {shown(catalog.regimes, current?.regime || regime).map((r) => (
              <option key={r.code} value={r.code}>
                {label(r)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {regime ? (
        <Field
          id={`${idPrefix}-reg2`}
          label={t('cp.form.regime2')}
          hint={hints ? t('cp.form.regime2_hint') : undefined}
        >
          {(control) => (
            <select
              {...control}
              className={`${inputClass()} cursor-pointer`}
              value={regime2}
              data-cp-field="regime2"
              onChange={(e) => onRegime2(e.target.value)}
            >
              <option value="">{t('cp.form.regime2_none')}</option>
              {shown(catalog.regimes, current?.regime2 || regime2)
                .filter((r) => r.code !== regime)
                .map((r) => (
                  <option key={r.code} value={r.code}>
                    {label(r)}
                  </option>
                ))}
            </select>
          )}
        </Field>
      ) : (
        <div />
      )}
    </>
  );
}

/** «Размер бизнеса» (прототип sizeSeg): правило размера — в подсказке. */
export function BizSizeField({
  id,
  value,
  long = true,
  onChange,
}: {
  id: string;
  value: BizSize;
  /** Подсказка с пояснением, от чего зависит размер (у формы создания). */
  long?: boolean;
  onChange: (value: BizSize) => void;
}) {
  const t = useT();
  const rule = t(`cp.form.size_rule.${value}`);
  return (
    <Field
      id={id}
      label={t('cp.form.size')}
      full
      hint={long ? t('cp.form.size_hint', { rule }) : rule}
    >
      {() => (
        <div className="self-start" data-cp-field="size">
          <Segments<BizSize>
            label={t('cp.form.size')}
            options={BIZ_SIZES.map((code) => ({ value: code, label: t(`cp.biz.${code}`) }))}
            value={value}
            onChange={onChange}
          />
        </div>
      )}
    </Field>
  );
}

/** Строка выбранных льгот (прототип benLine): «отмечен по УГНС», «с …», «до …». */
export function BenefitsField({
  id,
  catalog,
  benefits,
  office,
  hint,
  onOpen,
}: {
  id: string;
  catalog: Catalog;
  benefits: readonly BenefitChoice[];
  office: string;
  hint?: string | undefined;
  onOpen: () => void;
}) {
  const t = useT();
  const byOffice = officeBenefits(catalog, office);
  return (
    <Field id={id} label={t('cp.form.benefits')} full hint={hint}>
      {(control) => (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5" data-cp-benefits="">
            {benefits.length ? (
              benefits.map((b) => {
                const x = catalog.benefits.find((y) => y.code === b.code);
                return (
                  <Tag key={b.code} title={x?.gives || undefined}>
                    {x?.name ?? b.code}
                    {byOffice.includes(b.code) ? t('cp.form.benefit.by_office') : ''}
                    {b.validFrom
                      ? t('cp.form.benefit.from', { date: formatDateRu(b.validFrom) })
                      : ''}
                    {b.validTo ? t('cp.form.benefit.to', { date: formatDateRu(b.validTo) }) : ''}
                  </Tag>
                );
              })
            ) : (
              <span className="text-faint">{t('cp.form.benefits_none')}</span>
            )}
          </div>
          <button
            {...control}
            type="button"
            className={`${buttonClass('default', 'sm')} self-start`}
            data-cp-benefits-open=""
            onClick={onOpen}
          >
            <Icon name="star" size="sm" />
            {t('cp.form.benefits_btn')}
          </button>
        </div>
      )}
    </Field>
  );
}

/** «Основания для сквозных отчётов» (прототип basesChips): отмечается несколько. */
export function BasesField({
  id,
  catalog,
  bases,
  hint,
  onChange,
}: {
  id: string;
  catalog: Catalog;
  bases: readonly string[];
  hint?: string | undefined;
  onChange: (bases: string[]) => void;
}) {
  const t = useT();
  const items = catalog.bases.filter((b) => b.active || bases.includes(b.code));
  return (
    <Field id={id} label={t('cp.form.bases')} full hint={hint}>
      {() => (
        <div
          role="group"
          aria-label={t('cp.form.bases')}
          className="flex flex-wrap gap-1.5"
          data-cp-bases=""
        >
          {items.map((b) => {
            const on = bases.includes(b.code);
            return (
              <button
                key={b.code}
                type="button"
                aria-pressed={on}
                title={b.description || undefined}
                data-base={b.code}
                onClick={() =>
                  onChange(on ? bases.filter((x) => x !== b.code) : [...bases, b.code])
                }
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-[11px] py-1 text-[12.5px] font-[550] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? 'border-transparent bg-accent text-on-accent shadow-cta' : 'border-line bg-raised text-muted'}`}
              >
                {on ? <Icon name="check" size="sm" /> : null}
                {b.name}
              </button>
            );
          })}
        </div>
      )}
    </Field>
  );
}

/**
 * Предупреждения сверки с ГКЭД под полями (прототип gkNote): режим нельзя применять, вопросы о праве на
 * режим, статусы и назначенные отчёты не подходят, код больше не действует; подсказка ставки единого
 * налога — отдельной синей заметкой. Ничего не меняется само.
 */
export function GkedNotesView({ notes }: { notes: ContractorGkedNotes }) {
  const t = useT();
  const warn = [
    ...notes.block,
    ...notes.regime,
    ...notes.benefits,
    ...(notes.types.length ? [t('cp.gked.types', { types: notes.types.join(', ') })] : []),
    ...notes.off.map((code) => t('cp.gked.off', { code })),
  ];
  return (
    <>
      {warn.length ? (
        <Note tone="warn">
          <span className="flex flex-col gap-0.5" data-gked-warn="">
            {warn.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </span>
        </Note>
      ) : null}
      {notes.rate.length ? (
        <Note>
          <span className="flex flex-col gap-0.5" data-gked-rate="">
            {notes.rate.map((r) => (
              <span key={r}>{r}</span>
            ))}
          </span>
        </Note>
      ) : null}
    </>
  );
}
