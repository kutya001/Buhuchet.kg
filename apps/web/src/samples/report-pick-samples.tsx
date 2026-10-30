'use client';

import { BIZ_SIZES, type BizSize } from '@buhuchet/domain';
import { ContractorList } from '@buhuchet/shared';
import { buttonClass, Card, Field, FormGrid, Icon, inputClass } from '@buhuchet/ui';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { api, apiFailure } from '../api-client';
import { BenefitPickDialog, type BenefitChoice } from '../contractors/benefit-pick';
import { EditContractorDialog } from '../contractors/contractor-edit';
import {
  NotNeededNote,
  ReportPickDialog,
  ReportPickTab,
  useReportPickAuto,
} from '../contractors/report-pick';
import { catalogQuery, valueDictsQuery } from '../dicts/dicts-data';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useT } from '../l10n/provider';

/*
 * Окна «Подбор отчётов» и «Льготы и особые статусы» (задача 2.07) на странице образцов — до формы
 * контрагента (задача 2.09) и вкладки карточки (задача 2.11), которые подключат их у себя. Черновик
 * формы ничего не сохраняет; вкладка «Подбор отчётов» меняет отчёты выбранного контрагента
 * по-настоящему (адрес страницы `?cp=<id>` выбирает контрагента сразу).
 */

const contractorsQuery = queryOptions({
  queryKey: ['contractors', 'samples'],
  queryFn: async () => {
    const res = await api.api.contractors.$get({ query: { size: '100', sort: 'name.asc' } });
    if (!res.ok) throw await apiFailure(res);
    return ContractorList.parse(await res.json());
  },
});

interface Draft {
  formCode: string;
  regimeCode: string;
  regime2Code: string;
  gked: string;
  bizSize: BizSize;
  taxOfficeCode: string;
}

const EMPTY: Draft = {
  formCode: '',
  regimeCode: '',
  regime2Code: '',
  gked: '',
  bizSize: 'small',
  taxOfficeCode: '',
};

export function ReportPickSamples({
  initialCp,
  canEdit,
}: {
  initialCp: string | null;
  canEdit: boolean;
}) {
  const t = useT();
  const id = useId();
  const catalog = useQuery(catalogQuery).data;
  const dicts = useQuery(valueDictsQuery).data;
  const contractors = useQuery(contractorsQuery).data;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [benefits, setBenefits] = useState<BenefitChoice[]>([]);
  const [reports, setReports] = useState<{ sel: string[]; bases: string[]; picked: boolean }>({
    sel: [],
    bases: [],
    picked: false,
  });
  const [dialog, setDialog] = useState<{
    kind: 'pick' | 'single' | 'benefits';
    n: number;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [cp, setCp] = useState(initialCp ?? '');
  const [edit, setEdit] = useState<DialogSlot<string> | null>(null);

  const request = {
    formCode: draft.formCode || null,
    regimeCode: draft.regimeCode || null,
    regime2Code: draft.regime2Code || null,
    gked: draft.gked.trim() || null,
    gkedExtra: [],
    taxOfficeCode: draft.taxOfficeCode || null,
    bizSize: draft.bizSize,
  };
  const codes = benefits.map((b) => b.code);
  // Как в форме создания (прототип contractor-form.js): пока выбор в окне не меняли, отмечены
  // отчёты, которые отмечаются сами.
  const auto = useReportPickAuto({ ...request, benefits: codes, bases: reports.bases });
  const sel = reports.picked ? reports.sel : (auto ?? []);
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const show = (kind: 'pick' | 'single' | 'benefits') => {
    setDialog((d) => ({ kind, n: (d?.n ?? 0) + 1 }));
    setOpen(true);
  };
  const select = (
    key: keyof Draft,
    label: string,
    options: readonly { code: string; name: string }[],
  ): ReactNode => (
    <Field id={`${id}-${key}`} label={label}>
      {(control) => (
        <select
          {...control}
          data-draft={key}
          className={`${inputClass()} cursor-pointer`}
          value={draft[key]}
          onChange={(e) => change(key, e.target.value as never)}
        >
          {key === 'bizSize' ? null : <option value="">{t('samples.pick.none')}</option>}
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  const names = (codes: readonly string[], name: (code: string) => string) =>
    codes.length ? codes.map(name).join(', ') : t('samples.pick.nothing');

  return (
    <Card title={t('samples.pick.title')}>
      <p className="mt-0 mb-3 text-[13px] text-muted">{t('samples.pick.hint')}</p>
      <section className="flex flex-col gap-3" data-pick-draft="">
        <h3 className="m-0 text-[13px] font-semibold">{t('samples.pick.draft')}</h3>
        <FormGrid>
          {select(
            'formCode',
            t('cp.col.form'),
            (dicts?.forms ?? [])
              .filter((f) => f.active)
              .map((f) => ({
                code: f.code,
                name: f.shortName || f.name,
              })),
          )}
          {select(
            'regimeCode',
            t('cp.col.regime'),
            (catalog?.regimes ?? []).filter((r) => r.active),
          )}
          {select(
            'regime2Code',
            t('cp.col.regime2'),
            (catalog?.regimes ?? []).filter((r) => r.active),
          )}
          <Field id={`${id}-gked`} label={t('cp.col.gked')}>
            {(control) => (
              <input
                {...control}
                data-draft="gked"
                className={inputClass()}
                value={draft.gked}
                placeholder="62.01.0"
                onChange={(e) => change('gked', e.target.value)}
              />
            )}
          </Field>
          {select(
            'bizSize',
            t('samples.pick.biz'),
            BIZ_SIZES.map((code) => ({ code, name: t(`cp.biz.${code}`) })),
          )}
          {select(
            'taxOfficeCode',
            t('cp.col.tax_office'),
            (dicts?.offices ?? [])
              .filter((o) => o.active)
              .map((o) => ({
                code: o.code,
                name: o.shortName,
              })),
          )}
        </FormGrid>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass('default')}
            disabled={!catalog}
            onClick={() => show('benefits')}
          >
            <Icon name="star" size="sm" />
            {t('samples.pick.benefits_btn')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={!catalog || (!reports.picked && !auto)}
            onClick={() => show('pick')}
          >
            <Icon name="list" size="sm" />
            {t('samples.pick.pick_btn')}
          </button>
          <button
            type="button"
            className={buttonClass('default')}
            disabled={!catalog || (!reports.picked && !auto)}
            onClick={() => show('single')}
          >
            <Icon name="plus" size="sm" />
            {t('samples.pick.add_btn')}
          </button>
        </div>
        {catalog ? (
          <div className="flex flex-col gap-1.5 text-[13px]" data-pick-result="">
            <span data-result="benefits">
              {t('samples.pick.chosen_benefits', {
                names: names(codes, (c) => catalog.benefits.find((b) => b.code === c)?.name ?? c),
              })}
            </span>
            <span data-result="bases">
              {t('samples.pick.chosen_bases', { names: names(reports.bases, catalog.base) })}
            </span>
            <span data-result="reports">
              {t('samples.pick.chosen_reports', {
                names: names(sel, (c) => catalog.type(c)?.shortName ?? c),
              })}
            </span>
            <NotNeededNote
              benefits={codes}
              assigned={sel}
              catalog={catalog}
              onRemove={(drop) =>
                setReports((r) => ({
                  ...r,
                  sel: sel.filter((c) => !drop.includes(c)),
                  picked: true,
                }))
              }
            />
          </div>
        ) : null}
      </section>

      <section
        className="mt-5 flex flex-col gap-3 border-t border-line pt-4"
        data-pick-contractor=""
      >
        <h3 className="m-0 text-[13px] font-semibold">{t('samples.pick.tab')}</h3>
        <Field id={`${id}-cp`} label={t('samples.pick.contractor')}>
          {(control) => (
            <select
              {...control}
              data-sample-contractor=""
              className={`${inputClass()} cursor-pointer`}
              value={cp}
              onChange={(e) => setCp(e.target.value)}
            >
              <option value="">{t('samples.pick.contractor_none')}</option>
              {cp && !contractors?.items.some((x) => x.id === cp) ? (
                <option value={cp}>{cp}</option>
              ) : null}
              {(contractors?.items ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {cp && canEdit ? (
          <button
            type="button"
            className={`${buttonClass('default')} self-start`}
            data-sample-edit=""
            onClick={() => setEdit(openSlot(cp))}
          >
            <Icon name="edit" size="sm" />
            {t('samples.pick.edit')}
          </button>
        ) : null}
        {cp ? <ReportPickTab key={cp} contractorId={cp} /> : null}
      </section>
      {edit ? (
        <EditContractorDialog
          key={edit.n}
          contractorId={edit.data}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
        />
      ) : null}

      {dialog?.kind === 'pick' || dialog?.kind === 'single' ? (
        <ReportPickDialog
          key={`pick-${dialog.n}`}
          single={dialog.kind === 'single'}
          open={open}
          onClose={() => setOpen(false)}
          request={{ ...request, benefits: codes }}
          initial={{ sel, bases: reports.bases }}
          title={t('samples.pick.draft')}
          onApply={(choice) => setReports({ sel: choice.sel, bases: choice.bases, picked: true })}
        />
      ) : null}
      {dialog?.kind === 'benefits' ? (
        <BenefitPickDialog
          key={`benefits-${dialog.n}`}
          open={open}
          onClose={() => setOpen(false)}
          request={{ ...request, bases: reports.bases }}
          taxOffice={draft.taxOfficeCode || null}
          value={benefits}
          title={t('samples.pick.draft')}
          onApply={setBenefits}
        />
      ) : null}
    </Card>
  );
}
