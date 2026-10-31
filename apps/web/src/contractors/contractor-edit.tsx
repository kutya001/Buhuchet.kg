'use client';

import { pluralForm, reportPickAuto, reportPickBaseDiff } from '@buhuchet/domain';
import {
  ContractorSaved,
  type Contractor,
  type ContractorFormOptions,
  type PhoneCodes,
  type ReportPickRequest,
} from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  EmptyState,
  Field,
  FormGrid,
  Icon,
  inputClass,
  Modal,
  Note,
  PhoneInput,
  RecordChangedNotice,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { catalogQuery, valueDictsQuery, type Catalog, type ValueDicts } from '../dicts/dicts-data';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { phoneCodesQuery } from '../staff/staff-data';
import { BenefitPickDialog } from './benefit-pick';
import {
  BasesField,
  BenefitsField,
  BizSizeField,
  changeOffice,
  FormSelect,
  GkedNotesView,
  OfficeSelect,
  RegimeFields,
} from './contractor-fields';
import {
  contractorQuery,
  formOptionsQuery,
  gkedCheckQuery,
  socfundCheckQuery,
  useContractorsRefresh,
} from './contractor-data';
import {
  editDraftOf,
  editErrors,
  formFieldOf,
  updatePatchOf,
  type EditDraft,
  type FormField,
} from './contractor-form-model';
import { GkedFields } from './gked-pick';
import { RegistrationFields } from './registration-fields';
import { reportPickCalcOf, useReportPickCalc, type ReportPickCalc } from './report-pick';
import { pickDictOf, pickSubjectOf, reportPickQuery } from './report-pick-data';
import { SocfundFields } from './socfund-fields';

/*
 * Окно «Изменить контрагента» (ТЗ «Контрагенты» → «Обязательные поля», «Необязательные поля»; прототип
 * modules/contractor-form.js, editCpDlg): реквизиты, режимы, статусы, основания, признаки тарифа
 * Соцфонда и регистрационные данные. Отчёты здесь не выбираются — их подбор на вкладке «Подбор
 * отчётов» карточки; тип обслуживания, тариф, ответственный и периоды обслуживания меняются своими
 * действиями. Сохраняются только изменённые поля (`PATCH /api/contractors/{id}` с версией записи).
 */

type ErrorKey = FormField | 'feeDay';

interface Ask {
  title: string;
  text: ReactNode;
  ok: string;
  run: () => void;
}

interface Decisions {
  gked: string;
  benefits: string;
  socfund: boolean;
}

const gkedSig = (d: EditDraft) =>
  JSON.stringify([
    d.gked?.code ?? '',
    d.gkedExtra.map((g) => g.code),
    d.formCode,
    d.regimeCode,
    d.regime2Code,
  ]);
const benefitsSig = (d: EditDraft) =>
  JSON.stringify([
    d.gked?.code ?? '',
    d.gkedExtra.map((g) => g.code),
    d.benefits.map((b) => b.code),
  ]);

export function EditContractorDialog({
  contractorId,
  open,
  onClose,
  onSaved,
  onBases,
}: {
  contractorId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (saved: ContractorSaved) => void;
  /**
   * Сохранение изменило основания и есть что добавить или снять (docs/deviations.md п. А-7): окно
   * «Основания изменились» открывает тот, кто открыл форму; без него — уведомление, как в прототипе.
   */
  onBases?: (diff: BaseChanges) => void;
}) {
  const t = useT();
  const contractor = useQuery(contractorQuery(contractorId));
  const options = useQuery(formOptionsQuery);
  const catalog = useQuery(catalogQuery);
  const dicts = useQuery(valueDictsQuery);
  const codes = useQuery(phoneCodesQuery);
  if (contractor.data && options.data && catalog.data && dicts.data && codes.data) {
    return (
      <EditContractorForm
        key={contractor.data.version}
        contractor={contractor.data}
        open={open}
        onClose={onClose}
        onSaved={onSaved}
        onBases={onBases}
        onReload={() => void contractor.refetch()}
        options={options.data}
        catalog={catalog.data}
        dicts={dicts.data}
        codes={codes.data}
      />
    );
  }
  const failed =
    contractor.isError || options.isError || catalog.isError || dicts.isError || codes.isError;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('cp.form.title_edit')}
      footer={
        <button type="button" className={buttonClass('ghost')} onClick={onClose}>
          {t('btn.cancel')}
        </button>
      }
    >
      {failed ? (
        <EmptyState icon="alert" title={t('err.unknown')} />
      ) : (
        <div className="flex min-h-40 items-center justify-center text-faint" aria-busy="true">
          <Icon name="refresh" className="animate-spin" />
        </div>
      )}
    </Modal>
  );
}

function EditContractorForm({
  contractor: c,
  open,
  onClose,
  onSaved,
  onBases,
  onReload,
  options,
  catalog,
  dicts,
  codes,
}: {
  contractor: Contractor;
  open: boolean;
  onClose: () => void;
  onSaved: ((saved: ContractorSaved) => void) | undefined;
  onBases: ((diff: BaseChanges) => void) | undefined;
  onReload: () => void;
  options: ContractorFormOptions;
  catalog: Catalog;
  dicts: ValueDicts;
  codes: PhoneCodes['items'];
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const client = useQueryClient();
  const refresh = useContractorsRefresh();
  const [initial] = useState(() => editDraftOf(c, codes));
  const [d, setD] = useState<EditDraft>(initial);
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [win, setWin] = useState<{ n: number } | null>(null);
  const [winOpen, setWinOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [decided, setDecided] = useState<Decisions>({ gked: '', benefits: '', socfund: false });
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  const regular = c.kind === 'regular';
  const feeDay = regular && options.feeOn && options.fee && c.feeDay !== null;
  const benefitCodes = d.benefits.map((b) => b.code);
  const gkedCodes = d.gkedExtra.map((g) => g.code);
  const socfundChoice = {
    flags: d.socfund.flags,
    ...(d.socfund.touched
      ? {
          tariff: (d.socfund.tariff || null) as NonNullable<ReportPickRequest['socfund']>['tariff'],
        }
      : {}),
  };
  const pickRequest = {
    contractorId: c.id,
    formCode: d.formCode || null,
    regimeCode: d.regimeCode || null,
    regime2Code: (d.regimeCode && d.regime2Code) || null,
    gked: d.gked?.code ?? null,
    gkedExtra: gkedCodes,
    taxOfficeCode: d.taxOfficeCode || null,
    bizSize: d.bizSize,
    benefits: benefitCodes,
    bases: d.bases,
    socfund: socfundChoice,
  };
  const calc = useReportPickCalc(pickRequest);
  const assigned = useMemo(() => calc?.ctx.assigned ?? [], [calc]);
  // Назначенные виды, которые не подходят к новому режиму или форме (прототип editCpDlg, `bad`).
  const bad = assigned.filter((code) => calc?.pick.off.has(code));
  const gkedRequest = {
    contractorId: c.id,
    gked: d.gked?.code ?? null,
    gkedExtra: gkedCodes,
    formCode: d.formCode || null,
    regimeCode: d.regimeCode || null,
    regime2Code: (d.regimeCode && d.regime2Code) || null,
    benefits: benefitCodes,
    reportTypes: [...assigned],
  };
  const notes = useQuery({
    ...gkedCheckQuery(gkedRequest),
    enabled: !!d.gked || gkedCodes.length > 0,
  }).data;
  const socfund = useQuery({
    ...socfundCheckQuery({
      ...socfundChoice,
      reason: '',
      contractorId: c.id,
      kind: c.kind,
      bases: d.bases,
      gked: d.gked?.code ?? null,
      formCode: d.formCode || null,
      benefits: benefitCodes,
    }),
    enabled: regular,
  }).data;
  const checkCx = {
    codes,
    block: notes?.block[0] ?? null,
    socfundReason: !!(regular && socfund?.needed && socfund.manualMismatch),
    feeDay,
  };

  const set = (patch: Partial<EditDraft>, ...clear: ErrorKey[]) => {
    setD((x) => ({ ...x, ...patch }));
    if (clear.length) {
      setErrors((e) => {
        const next = { ...e };
        for (const k of clear) delete next[k];
        return next;
      });
    }
  };
  const fieldId = (k: ErrorKey) => `${id}-${k.replace('.', '-')}`;
  const focusField = (k: ErrorKey) =>
    requestAnimationFrame(() =>
      document.getElementById(fieldId(k))?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  const confirm = (a: Ask) => {
    setAsk(a);
    setAskOpen(true);
  };

  const gkedAsk = async (draft: EditDraft, ok: string) => {
    if (!draft.gked && !draft.gkedExtra.length) return null;
    const fresh = await client
      .fetchQuery(
        gkedCheckQuery({
          ...gkedRequest,
          gked: draft.gked?.code ?? null,
          gkedExtra: draft.gkedExtra.map((g) => g.code),
          formCode: draft.formCode || null,
          regimeCode: draft.regimeCode || null,
          regime2Code: (draft.regimeCode && draft.regime2Code) || null,
          benefits: draft.benefits.map((b) => b.code),
        }),
      )
      .catch(() => null);
    return fresh && fresh.confirm && ok !== gkedSig(draft) ? fresh : null;
  };

  const changeRegime = async (code: string) => {
    const draft = {
      ...d,
      regimeCode: code,
      regime2Code: !code || d.regime2Code === code ? '' : d.regime2Code,
    };
    set({ regimeCode: draft.regimeCode, regime2Code: draft.regime2Code }, 'regimeCode');
    const need = await gkedAsk(draft, decided.gked);
    if (need?.confirm) {
      confirm({
        title: need.confirm.title,
        text: need.confirm.text,
        ok: need.confirm.ok,
        run: () => setDecided((x) => ({ ...x, gked: gkedSig(draft) })),
      });
    }
  };

  const save = async (over: Partial<Decisions> = {}, again = true) => {
    if (busy) return;
    const dec = { ...decided, ...over };
    const all = editErrors(d, checkCx, t);
    setErrors(all);
    const first = Object.keys(all)[0] as ErrorKey | undefined;
    if (first) return focusField(first);
    const fresh = await gkedAsk(d, dec.gked);
    if (fresh?.confirm) {
      const sig = gkedSig(d);
      return confirm({
        title: fresh.confirm.title,
        text: fresh.confirm.text,
        ok: fresh.confirm.ok,
        run: () => {
          setDecided((x) => ({ ...x, gked: sig }));
          void save({ ...over, gked: sig });
        },
      });
    }
    if (notes?.benefits.length && dec.benefits !== benefitsSig(d)) {
      const sig = benefitsSig(d);
      return confirm({
        title: t('cp.form.ben_mismatch.title'),
        text: t('cp.form.ben_mismatch.text', { list: notes.benefits.join('. ') }),
        ok: t('btn.save'),
        run: () => {
          setDecided((x) => ({ ...x, benefits: sig }));
          void save({ ...over, benefits: sig });
        },
      });
    }
    if (checkCx.socfundReason && !dec.socfund && socfund?.confirm) {
      return confirm({
        title: t('cp.socfund.confirm_title'),
        text: socfund.confirm,
        ok: t('btn.save'),
        run: () => {
          setDecided((x) => ({ ...x, socfund: true }));
          void save({ ...over, socfund: true });
        },
      });
    }
    const patch = updatePatchOf(initial, d, { codes, feeDay, socfund: regular });
    const confirmed = dec.gked === gkedSig(d);
    if (!Object.keys(patch).length && !confirmed) {
      onClose();
      return toast(t('cp.form.edit.no_changes'), { icon: 'info' });
    }
    // Основания изменились — после сохранения окно «Основания изменились»: добавить отчёты включённых и
    // снять отчёты выключенных (ТЗ, решение заказчика 30.10.2026, docs/deviations.md п. А-7).
    // Обязательные по подбору, но не назначенные — в уведомлении после сохранения, без отчётов, которые
    // предложит окно (ТЗ «не повторяя отчёты оснований»; прототип editCpDlg: pkAuto без `pb.add`).
    // Подбор ещё пересчитывается (поле поменяли только что) — дождаться ответа: иначе окно и уведомление
    // считались бы по прежним полям или не появились бы вовсе.
    setBusy(true);
    const now =
      calc ??
      (regular
        ? await client
            .fetchQuery(reportPickQuery(pickRequest))
            .then((ctx) => reportPickCalcOf(catalog, ctx, t))
            .catch(() => null)
        : null);
    const had = now?.ctx.assigned ?? [];
    const bases =
      regular && now && 'bases' in patch && onBases ? baseChangesOf(c, now, had, t) : null;
    const missing =
      regular && now
        ? reportPickAuto(now.pick).filter((x) => !had.includes(x) && !bases?.add.includes(x))
        : [];
    const res = await callApi(() =>
      api.api.contractors[':id'].$patch({
        param: { id: c.id },
        json: {
          ...patch,
          version: c.version,
          ...(confirmed ? { gkedConfirm: true } : {}),
          ...(dec.socfund ? { socfundConfirm: true } : {}),
        },
      }),
    );
    setBusy(false);
    if (res.ok) {
      const saved = ContractorSaved.safeParse(res.data);
      refresh();
      onClose();
      const n = saved.success ? saved.data.redued : 0;
      const redued = n ? t(`cp.form.edit.redued.${pluralForm(n)}`, { n }) : '';
      toast(
        missing.length
          ? t('cp.form.edit.saved_missing', {
              redued,
              names: missing.map((x) => catalog.type(x)?.shortName ?? x).join(', '),
            })
          : t('cp.form.edit.saved') + redued,
        missing.length ? { icon: 'alert', bad: true } : {},
      );
      if (saved.success) {
        const s = saved.data;
        const gkedChanged = 'gked' in patch || 'gkedExtra' in patch;
        const k =
          s.gkedNotes.regime.length + s.gkedNotes.benefits.length + s.gkedNotes.types.length;
        if (gkedChanged && k) {
          setTimeout(
            () => toast(t('cp.form.edit.gked_changed', { n: k }), { icon: 'alert', bad: true }),
            1400,
          );
        }
        if (
          bad.length &&
          ('regimeCode' in patch || 'regime2Code' in patch || 'formCode' in patch)
        ) {
          setTimeout(
            () => toast(t('cp.form.edit.regime_changed'), { icon: 'alert', bad: true }),
            1400,
          );
        }
        onSaved?.(s);
        if (bases) onBases?.({ ...bases, version: s.version });
      }
      return;
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    // Сервер сам спросил о праве на режим (сверку не удалось получить заранее): спросить один раз,
    // повторный отказ — обычная ошибка под полем.
    if (res.error.code === 'gked_confirm_required' && again)
      return save({ ...over, gked: '' }, false);
    const field = formFieldOf((res.error.details as { field?: unknown } | undefined)?.field);
    if (field) {
      setErrors((e) => ({ ...e, [field]: errorText(res.error) }));
      return focusField(field);
    }
    toast(errorText(res.error), { icon: 'alert', bad: true });
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        kind="form"
        size="mid"
        title={t('cp.form.title_edit')}
        sub={c.name}
        dirty={JSON.stringify(d) !== JSON.stringify(initial)}
        footer={
          <>
            <button type="button" className={buttonClass('ghost')} onClick={onClose}>
              {t('btn.cancel')}
            </button>
            <button
              type="button"
              className={buttonClass('cta')}
              disabled={busy || changed}
              data-cp-save=""
              onClick={() => void save()}
            >
              {t('btn.save')}
            </button>
          </>
        }
      >
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={onReload}
          />
        ) : null}
        <FormGrid>
          <Field id={fieldId('name')} label={t('cp.form.name')} required full error={errors.name}>
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                value={d.name}
                placeholder={t('cp.form.name_placeholder')}
                data-cp-field="name"
                onChange={(e) => set({ name: e.target.value }, 'name')}
              />
            )}
          </Field>
          <Field id={fieldId('inn')} label={t('cp.form.inn')} required error={errors.inn}>
            {(control) => (
              <input
                {...control}
                className={inputClass({ mono: true })}
                value={d.inn}
                inputMode="numeric"
                maxLength={14}
                placeholder={t('cp.form.inn_placeholder')}
                data-cp-field="inn"
                onChange={(e) =>
                  set({ inn: e.target.value.replace(/\D/g, '').slice(0, 14) }, 'inn')
                }
              />
            )}
          </Field>
          <Field id={fieldId('phone')} label={t('cp.form.phone')} required error={errors.phone}>
            {(control) => (
              <PhoneInput
                codes={codes}
                value={d.phone}
                control={control}
                codeLabel={t('cp.form.phone_code')}
                onChange={(v) => set({ phone: v }, 'phone')}
              />
            )}
          </Field>
          <GkedFields
            idPrefix={id}
            mainId={fieldId('gked')}
            main={d.gked}
            extra={d.gkedExtra}
            off={notes?.off ?? []}
            error={errors.gked}
            onMain={(v) =>
              set(
                { gked: v, gkedExtra: d.gkedExtra.filter((x) => x.code !== v.code) },
                'gked',
                'regimeCode',
              )
            }
            onExtra={(v) => set({ gkedExtra: v }, 'regimeCode')}
          />
          <FormSelect
            id={fieldId('formCode')}
            forms={dicts.forms}
            value={d.formCode}
            current={initial.formCode}
            error={errors.formCode}
            onChange={(code) => set({ formCode: code }, 'formCode', 'regimeCode')}
          />
          <OfficeSelect
            id={`${id}-office`}
            offices={dicts.offices}
            value={d.taxOfficeCode}
            current={initial.taxOfficeCode}
            onChange={(code) => {
              const r = changeOffice(catalog, d.benefits, d.taxOfficeCode, code, t);
              set({ taxOfficeCode: code, benefits: r.benefits });
              if (r.message) toast(r.message, { icon: 'info' });
            }}
          />
          <RegimeFields
            idPrefix={id}
            regimeId={fieldId('regimeCode')}
            catalog={catalog}
            regime={d.regimeCode}
            regime2={d.regime2Code}
            current={{ regime: initial.regimeCode, regime2: initial.regime2Code }}
            error={errors.regimeCode}
            hints={false}
            onRegime={(code) => void changeRegime(code)}
            onRegime2={(code) => set({ regime2Code: code }, 'regimeCode')}
          />
          <BizSizeField
            id={`${id}-size`}
            value={d.bizSize}
            long={false}
            onChange={(v) => set({ bizSize: v })}
          />
          <BenefitsField
            id={`${id}-ben`}
            catalog={catalog}
            benefits={d.benefits}
            office={d.taxOfficeCode}
            onOpen={() => {
              setWin((w) => ({ n: (w?.n ?? 0) + 1 }));
              setWinOpen(true);
            }}
          />
          {regular ? (
            <BasesField
              id={`${id}-bases`}
              catalog={catalog}
              bases={d.bases}
              onChange={(bases) => set({ bases })}
            />
          ) : null}
          {regular ? (
            <SocfundFields
              idPrefix={id}
              reasonId={fieldId('socfund.reason')}
              draft={d.socfund}
              check={socfund}
              saved={
                c.socfund.tariff
                  ? {
                      id: c.socfund.tariff.id,
                      manual: c.socfund.tariff.manual,
                      reason: c.socfund.tariff.reason,
                    }
                  : null
              }
              reasonError={errors['socfund.reason']}
              onChange={(v) => set({ socfund: v }, 'socfund.reason')}
            />
          ) : null}
          {notes ? (
            <div className="col-span-full flex flex-col gap-2">
              <GkedNotesView notes={notes} />
            </div>
          ) : null}
          {regular ? (
            <div className="col-span-full">
              <Note icon="list">{t('cp.form.edit.reports_note')}</Note>
            </div>
          ) : null}
          {bad.length ? (
            <div className="col-span-full" data-cp-bad-types="">
              <Note tone="warn">
                {t('cp.form.edit.bad_types', {
                  names: bad.map((x) => catalog.type(x)?.shortName ?? x).join(', '),
                })}
              </Note>
            </div>
          ) : null}
          <Field id={`${id}-head`} label={t('cp.form.head')}>
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                value={d.head}
                onChange={(e) => set({ head: e.target.value })}
              />
            )}
          </Field>
          <Field id={`${id}-contact`} label={t('cp.form.contact')}>
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                value={d.contact}
                onChange={(e) => set({ contact: e.target.value })}
              />
            )}
          </Field>
          <Field id={`${id}-cno`} label={t('cp.form.contract_no')}>
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                value={d.contractNo}
                placeholder={t('cp.form.contract_no_placeholder')}
                onChange={(e) => set({ contractNo: e.target.value })}
              />
            )}
          </Field>
          <Field
            id={fieldId('contractDate')}
            label={t('cp.form.contract_date')}
            error={errors.contractDate}
          >
            {(control) => (
              <input
                {...control}
                type="date"
                className={inputClass()}
                value={d.contractDate}
                onChange={(e) => set({ contractDate: e.target.value }, 'contractDate')}
              />
            )}
          </Field>
          {feeDay ? (
            <Field
              id={fieldId('feeDay')}
              label={t('cp.form.edit.fee_day')}
              hint={t('cp.form.edit.fee_day_hint')}
              error={errors.feeDay}
            >
              {(control) => (
                <input
                  {...control}
                  type="number"
                  min={1}
                  max={28}
                  className={inputClass({ mono: true })}
                  value={d.feeDay}
                  data-cp-field="fee-day"
                  onChange={(e) => set({ feeDay: e.target.value }, 'feeDay')}
                />
              )}
            </Field>
          ) : null}
          <Field id={`${id}-note`} label={t('cp.form.note')} full>
            {(control) => (
              <textarea
                {...control}
                className={`${inputClass()} min-h-[60px]`}
                value={d.note}
                onChange={(e) => set({ note: e.target.value })}
              />
            )}
          </Field>
          <div className="col-span-full font-semibold">{t('cp.form.reg_toggle')}</div>
          <RegistrationFields
            idPrefix={id}
            value={d.registration}
            errors={{ okpo: errors.okpo, email: errors.email }}
            onChange={(v) => set({ registration: v }, 'okpo', 'email')}
          />
        </FormGrid>
        <p className="mt-3 mb-0 text-[12px] text-muted">{t('cp.form.edit.foot')}</p>
      </Modal>
      {win ? (
        <BenefitPickDialog
          key={`benefits-${win.n}`}
          open={winOpen}
          onClose={() => setWinOpen(false)}
          request={{
            contractorId: c.id,
            formCode: d.formCode || null,
            regimeCode: d.regimeCode || null,
            regime2Code: (d.regimeCode && d.regime2Code) || null,
            gked: d.gked?.code ?? null,
            gkedExtra: gkedCodes,
            taxOfficeCode: d.taxOfficeCode || null,
            bizSize: d.bizSize,
            bases: d.bases,
          }}
          taxOffice={d.taxOfficeCode || null}
          value={d.benefits}
          title={c.name}
          onApply={(benefits) => set({ benefits })}
        />
      ) : null}
      {ask ? (
        <ConfirmDialog
          open={askOpen}
          onClose={() => setAskOpen(false)}
          title={ask.title}
          text={<span className="whitespace-pre-line">{ask.text}</span>}
          ok={ask.ok}
          onConfirm={ask.run}
        />
      ) : null}
    </>
  );
}

/** Что предложить в окне «Основания изменились»: основания, отчёты к добавлению и снятию. */
export interface BaseChanges {
  contractorId: string;
  name: string;
  on: string[];
  off: string[];
  add: string[];
  remove: string[];
  /** Назначенные виды до окна: с них считается новый выбор. */
  assigned: string[];
  version: number;
}

/** Основания до и после «Изменить» (прототип pkBaseDiff); нечего добавить и снять — null. */
function baseChangesOf(
  c: Contractor,
  calc: ReportPickCalc,
  assigned: readonly string[],
  t: Translate,
): Omit<BaseChanges, 'version'> | null {
  const d = reportPickBaseDiff(
    c.bases.map((b) => b.code),
    pickSubjectOf(calc.ctx, calc.ctx.subject.bases),
    assigned,
    pickDictOf(calc.catalog, calc.ctx),
    calc.ctx.today,
    t,
  );
  if (!d.add.length && !d.remove.length) return null;
  return { contractorId: c.id, name: c.name, ...d, assigned: [...assigned] };
}
