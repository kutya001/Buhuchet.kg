'use client';

import { benefitFits, benefitWarnings, searchText } from '@buhuchet/domain';
import type { ReportPickRequest, TaxBenefit } from '@buhuchet/shared';
import {
  buttonClass,
  CHECKBOX_CLASS,
  EmptyState,
  Field,
  Icon,
  inputClass,
  Modal,
  PHONE_QUERY,
  Pill,
  Segments,
  useMediaQuery,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { catalogQuery, valueDictsQuery } from '../dicts/dicts-data';
import { VerifyPill } from '../dicts/type-guide';
import { BenefitGuide } from '../dicts/value-guide';
import { useT } from '../l10n/provider';
import { ContextLine } from './report-pick';
import { pickDictOf, pickSubjectOf, reportPickQuery } from './report-pick-data';

/** Первая фраза «Что даёт» (прототип benPickDlg): до «;» или точки в конце предложения, не в дате. */
const firstPhrase = (text: string) => text.split(/;|\.(?=\s|$)/)[0];

/** Льгота или статус контрагента со сроком действия (как в форме контрагента). */
export interface BenefitChoice {
  code: string;
  validFrom: string | null;
  validTo: string | null;
}

/**
 * Окно «Льготы и особые статусы» (ТЗ «Контрагенты» → «Окно «Льготы и особые статусы»»; прототип
 * modules/report-pick.js — benPickDlg): вкладки «Подходят по ГКЭД» и «Все», поиск, строка с
 * галочкой и метками «Статус», «по УГНС», «сверить», «по ГКЭД», первая фраза «Что даёт» и
 * предупреждения отмеченного (ГКЭД не подходит, не совмещается с другим, не для этой формы
 * собственности); у статуса со сроком — «Действует с» и «Действует по» (дата окончания по кодексу
 * подставляется сама). Описание — справа, на телефоне — под строкой. Статус тарифа СПиНО здесь не
 * выбирается: он — в блоке «Тариф Соцфонда». `request` — поля формы (форма собственности, ГКЭД),
 * `taxOffice` — УГНС формы; без права «Создавать и изменять контрагентов» и у контрагента в архиве —
 * только описания.
 * «Применить» отдаёт выбор форме.
 */
export function BenefitPickDialog({
  open,
  onClose,
  request,
  taxOffice,
  value,
  title,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  request: Omit<ReportPickRequest, 'benefits'>;
  taxOffice: string | null;
  value: readonly BenefitChoice[];
  title?: string;
  onApply: (value: BenefitChoice[]) => void;
}) {
  const t = useT();
  const id = useId();
  const phone = useMediaQuery(PHONE_QUERY);
  const catalog = useQuery(catalogQuery).data;
  const offices = useQuery(valueDictsQuery).data?.offices ?? [];
  const ctx = useQuery(reportPickQuery(request)).data;
  const [tab, setTab] = useState<'fit' | 'all'>('fit');
  const [q, setQ] = useState('');
  const [cur, setCur] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [chosen, setChosen] = useState<BenefitChoice[]>(() => value.map((b) => ({ ...b })));
  const codes = useMemo(() => chosen.map((b) => b.code), [chosen]);
  const dict = useMemo(() => (catalog && ctx ? pickDictOf(catalog, ctx) : null), [catalog, ctx]);
  const subject = useMemo(
    () => (ctx ? pickSubjectOf(ctx, ctx.subject.bases, codes) : null),
    [ctx, codes],
  );
  const edit = !!ctx?.edit.bases;
  const hasGked = !!subject && (!!subject.gked || subject.gkedExtra.length > 0);
  const query = searchText(q.trim());
  const on = (code: string) => codes.includes(code);

  const items =
    catalog && ctx
      ? catalog.benefits.filter((b) => b.code !== ctx.socfundStatus && (b.active || on(b.code)))
      : [];
  const fits = (b: TaxBenefit) => !!dict && !!subject && benefitFits(b, subject, dict.index);
  const list = items.filter(
    (b) =>
      (tab === 'all' || fits(b)) &&
      (!query || [b.name, b.gives, b.code].some((v) => searchText(v).includes(query))),
  );

  const set = (b: TaxBenefit, value: boolean) =>
    setChosen((prev) =>
      value
        ? prev.some((x) => x.code === b.code)
          ? prev
          : [...prev, { code: b.code, validFrom: null, validTo: b.validUntil }]
        : prev.filter((x) => x.code !== b.code),
    );
  const setDate = (code: string, key: 'validFrom' | 'validTo', date: string) =>
    setChosen((prev) => prev.map((x) => (x.code === code ? { ...x, [key]: date || null } : x)));

  const desc = (b: TaxBenefit) =>
    catalog ? (
      <BenefitGuide
        x={b}
        catalog={catalog}
        offices={offices}
        office={{ code: taxOffice, label: t('cp.ben.ui.at_contractor') }}
        footer={
          edit ? (
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass(on(b.code) ? 'default' : 'cta', 'sm')}
                disabled={on(b.code)}
                onClick={() => set(b, true)}
              >
                <Icon name="check" size="sm" />
                {t('cp.pick.ui.fits')}
              </button>
              <button
                type="button"
                className={buttonClass('default', 'sm')}
                disabled={!on(b.code)}
                onClick={() => set(b, false)}
              >
                <Icon name="x" size="sm" />
                {t('cp.pick.ui.not_fits')}
              </button>
            </div>
          ) : null
        }
      />
    ) : null;

  const row = (b: TaxBenefit) => {
    const choice = chosen.find((x) => x.code === b.code);
    const warnings = choice && dict && subject ? benefitWarnings(b, subject, codes, dict, t) : [];
    const expanded = phone && opened === b.code;
    return (
      <div key={b.code}>
        <div
          data-benefit-row={b.code}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('input,button,a,label')) return;
            setCur(b.code);
            if (phone) setOpened(expanded ? null : b.code);
          }}
          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-[9px] hover:bg-row-hover ${cur === b.code ? 'border-brand-blue shadow-[inset_0_0_0_1px_var(--bu-b-blue)]' : 'border-line'} ${choice ? 'bg-[color-mix(in_srgb,var(--bu-green-bg)_45%,var(--bu-raised))]' : 'bg-raised'}`}
        >
          {edit ? (
            <input
              type="checkbox"
              className={`${CHECKBOX_CLASS} mt-0.5 h-[18px] w-[18px]`}
              checked={!!choice}
              aria-label={b.name}
              onChange={(e) => set(b, e.target.checked)}
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <div className="flex flex-wrap items-center gap-1.5 text-[13.5px]">
              <b>{b.name}</b>
              {b.kind === 'status' ? <Pill size="sm">{t('cp.ben.ui.status')}</Pill> : null}
              {taxOffice && b.taxOffices.includes(taxOffice) ? (
                <span title={t('cp.ben.ui.by_office_title')}>
                  <Pill tone="info" size="sm">
                    {t('cp.ben.ui.by_office')}
                  </Pill>
                </span>
              ) : null}
              {b.verify ? <VerifyPill /> : null}
              {fits(b) ? (
                <Pill tone="ok" size="sm" icon="check">
                  {t('cp.ben.ui.by_gked')}
                </Pill>
              ) : null}
            </div>
            <div className="text-[12px] leading-[1.35] text-faint">{firstPhrase(b.gives)}</div>
            {warnings.length ? (
              <div
                data-benefit-warn=""
                className="flex items-start gap-1 text-[12px] leading-[1.35] text-warn-label"
              >
                <Icon name="alert" size="sm" />
                <span>
                  {warnings.map((w, i) => (
                    <span key={i} className="block">
                      {w}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}
            {choice && (b.validUntil || b.term) ? (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Field id={`${id}-${b.code}-from`} label={t('cp.ben.ui.from')}>
                  {(control) => (
                    <input
                      {...control}
                      type="date"
                      className={`${inputClass()} min-h-8 py-[3px]`}
                      value={choice.validFrom ?? ''}
                      disabled={!edit}
                      onChange={(e) => setDate(b.code, 'validFrom', e.target.value)}
                    />
                  )}
                </Field>
                <Field id={`${id}-${b.code}-to`} label={t('cp.ben.ui.to')}>
                  {(control) => (
                    <input
                      {...control}
                      type="date"
                      className={`${inputClass()} min-h-8 py-[3px]`}
                      value={choice.validTo ?? ''}
                      disabled={!edit}
                      onChange={(e) => setDate(b.code, 'validTo', e.target.value)}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </div>
          {phone ? (
            <span className="grid flex-none self-center text-faint" aria-hidden="true">
              <Icon name={expanded ? 'up' : 'down'} size="sm" />
            </span>
          ) : null}
        </div>
        {expanded ? (
          <div className="pt-1 pb-2 [&>div]:rounded-lg [&>div]:border [&>div]:border-line [&>div]:bg-raised [&>div]:p-3">
            {desc(b)}
          </div>
        ) : null}
      </div>
    );
  };

  const current = cur ? items.find((b) => b.code === cur) : undefined;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      swipeHead
      phoneFull
      title={t('cp.ben.ui.title')}
      sub={title}
      footer={
        edit ? (
          <>
            <span data-benefit-sum="" className="text-[13px] text-muted">
              {t('cp.ben.ui.sum', { n: chosen.length })}
            </span>
            <div className="flex-1" />
            <button type="button" className={buttonClass('ghost')} onClick={onClose}>
              {t('btn.cancel')}
            </button>
            <button
              type="button"
              className={buttonClass('cta')}
              disabled={!ctx}
              onClick={() => {
                onApply(chosen);
                onClose();
              }}
            >
              {t('cp.pick.ui.apply')}
            </button>
          </>
        ) : (
          <>
            <div className="flex-1" />
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('btn.close')}
            </button>
          </>
        )
      }
    >
      <div className="flex min-w-0 flex-col gap-2.5" data-benefit-pick="">
        {catalog && ctx ? (
          // Строка о контрагенте — со статусами формы, с которыми окно открыли (прототип benPickDlg).
          <ContextLine
            ctx={{ ...ctx, subject: { ...ctx.subject, benefits: value.map((b) => b.code) } }}
            catalog={catalog}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="relative flex min-w-[220px] flex-1 items-center max-md:min-w-0 max-md:basis-full">
            <Icon
              name="search"
              size="sm"
              className="pointer-events-none absolute left-2.5 text-faint"
            />
            <input
              type="search"
              className={`${inputClass()} pl-8`}
              value={q}
              placeholder={t('cp.ben.ui.search')}
              aria-label={t('cp.ben.ui.search_label')}
              onChange={(e) => setQ(e.target.value)}
            />
          </span>
          <div className="max-md:w-full max-md:[&>div]:flex max-md:[&>div>button]:flex-1">
            <Segments
              label={t('cp.ben.ui.tabs_label')}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'fit', label: t('cp.ben.ui.tab.fit') },
                { value: 'all', label: t('cp.ben.ui.tab.all') },
              ]}
            />
          </div>
        </div>
        <div className="grid min-h-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-3.5 max-md:block">
          <div className="flex min-w-0 flex-col gap-1.5" data-benefit-list="">
            {!ctx || !catalog ? (
              <div
                className="flex min-h-40 items-center justify-center text-faint"
                aria-busy="true"
              >
                <Icon name="refresh" className="animate-spin" />
              </div>
            ) : list.length ? (
              list.map(row)
            ) : (
              <EmptyState
                icon="star"
                title={
                  tab === 'fit' && !query ? t('cp.ben.ui.empty.fit') : t('cp.ben.ui.empty.found')
                }
                text={
                  hasGked || tab !== 'fit'
                    ? t('cp.ben.ui.empty.all_text')
                    : t('cp.ben.ui.empty.no_gked_text')
                }
              />
            )}
          </div>
          {phone ? null : (
            <div className="sticky top-0 max-h-[calc(100dvh-330px)] overflow-auto rounded-xl border border-line bg-raised px-4 py-3.5">
              {current ? (
                desc(current)
              ) : (
                <div className="flex flex-col items-center gap-2 px-2 py-7 text-center text-muted">
                  <Icon name="info" size="lg" className="text-faint" />
                  <b className="text-[15px] text-ink">{t('cp.ben.ui.side_title')}</b>
                  <span className="max-w-[420px]">{t('cp.ben.ui.side_text')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
