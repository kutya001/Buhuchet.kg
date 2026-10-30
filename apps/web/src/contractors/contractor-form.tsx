'use client';

import {
  bishkekDate,
  gkedFitOf,
  NEW_CONTRACTOR_FORM,
  reportPickAuto,
  SINGLE_TAX_REGIME,
  type ContractorKind,
  type FirstMonthMode,
  type TariffPeriod,
} from '@buhuchet/domain';
import {
  ContractorCreated,
  type ContractorUnarchived,
  type ContractorFormOptions,
  type ContractorGkedNotes,
  type PhoneCodes,
  type ReportPickRequest,
} from '@buhuchet/shared';
import {
  ActPill,
  buttonClass,
  ConfirmDialog,
  EmptyState,
  Field,
  FormGrid,
  Icon,
  iconButtonClass,
  inputClass,
  linkButtonClass,
  Modal,
  Note,
  PHONE_QUERY,
  PhoneInput,
  Segments,
  useMediaQuery,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { catalogQuery, valueDictsQuery, type Catalog, type ValueDicts } from '../dicts/dicts-data';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { phoneCodesQuery } from '../staff/staff-data';
import { BenefitPickDialog } from './benefit-pick';
import {
  changeOffice,
  BasesField,
  BenefitsField,
  BizSizeField,
  FormSelect,
  GkedNotesView,
  OfficeSelect,
  RegimeFields,
} from './contractor-fields';
import {
  formOptionsQuery,
  gkedCheckQuery,
  socfundCheckQuery,
  useContractorsRefresh,
} from './contractor-data';
import {
  chosenReports,
  createRequestOf,
  draftErrors,
  errorsInSection,
  FIELD_SECTION,
  FORM_SECTIONS,
  feeFieldShown,
  formFieldOf,
  leftInSection,
  newDraft,
  prorationText,
  type ContractorDraft,
  type DraftCheckContext,
  type FormField,
  type FormSection,
} from './contractor-form-model';
import { GkedFields } from './gked-pick';
import { RateRows, singleTaxDefaults, type SingleTaxContext } from './rate-rows';
import { RegistrationFields } from './registration-fields';
import { NotNeededNote, ReportPickDialog, useReportPickCalc } from './report-pick';
import { useServiceActions } from './service-actions';
import { SocfundFields } from './socfund-fields';

/*
 * Окно «Новый контрагент» (ТЗ «Контрагенты» → «Обязательные поля», «Необязательные поля», «Форма
 * создания контрагента разбита на разделы», «Непостоянные контрагенты»; прототип
 * modules/contractor-form.js, addCpDlg): разделы «Реквизиты», «Режим и статусы», «Отчёты и
 * обслуживание» — на ПК на одном экране с оглавлением, на телефоне — шаги с «Назад» и «Далее»
 * (дальше не пускает, пока в разделе ошибки). Отчёты подбираются сами по режиму, статусам и
 * основаниям, пока их не выбрали в «Подобрать отчёты»; ставки — по ГКЭД. Перед сохранением — вопросы
 * о праве на режим по ГКЭД, о несоответствии статусов и о ручном тарифе Соцфонда, как в прототипе.
 * Контрагент, отчёты и первая запись тарифа создаются одним целым (`POST /api/contractors`).
 */

/** Окно подтверждения поверх формы. */
interface Ask {
  title: string;
  text: ReactNode;
  ok: string;
  danger?: boolean;
  run: () => void;
}

/** Решения в окнах подтверждения: к какому набору данных относится каждое. */
interface Decisions {
  /** «Подтверждаю» / «Нет, не оказывает» — подпись ГКЭД, режимов и формы. */
  gked: string;
  /** «Сохранить с несоответствием?» — подпись ГКЭД и статусов. */
  benefits: string;
  /** «Тариф не совпадает с условиями» → «Сохранить». */
  socfund: boolean;
}

const NO_DECISIONS: Decisions = { gked: '', benefits: '', socfund: false };

const gkedSig = (d: ContractorDraft) =>
  JSON.stringify([
    d.gked?.code ?? '',
    d.gkedExtra.map((g) => g.code),
    d.formCode,
    d.regimeCode,
    d.regime2Code,
  ]);
const benefitsSig = (d: ContractorDraft) =>
  JSON.stringify([
    d.gked?.code ?? '',
    d.gkedExtra.map((g) => g.code),
    d.benefits.map((b) => b.code),
  ]);

const withoutReports = (e: Partial<Record<FormField, string>>) => {
  const next = { ...e };
  delete next.reports;
  return next;
};

export function NewContractorDialog({
  open,
  onClose,
  kind = 'regular',
  onCreated,
  onUnarchived,
}: {
  open: boolean;
  onClose: () => void;
  kind?: ContractorKind;
  /** Контрагент создан: карточка (задача 2.11) откроет его. */
  onCreated?: (created: ContractorCreated) => void;
  /** Контрагент с этим ИНН возвращён из архива: карточка (задача 2.11) откроет его. */
  onUnarchived?: (card: ContractorUnarchived) => void;
}) {
  const t = useT();
  const options = useQuery(formOptionsQuery);
  const catalog = useQuery(catalogQuery);
  const dicts = useQuery(valueDictsQuery);
  const codes = useQuery(phoneCodesQuery);
  if (options.data && catalog.data && dicts.data && codes.data) {
    return (
      <NewContractorForm
        open={open}
        onClose={onClose}
        kind={kind}
        onCreated={onCreated}
        onUnarchived={onUnarchived}
        options={options.data}
        catalog={catalog.data}
        dicts={dicts.data}
        codes={codes.data}
      />
    );
  }
  const failed = options.isError || catalog.isError || dicts.isError || codes.isError;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('cp.form.title_new')}
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

function NewContractorForm({
  open,
  onClose,
  kind,
  onCreated,
  onUnarchived,
  options,
  catalog,
  dicts,
  codes,
}: {
  open: boolean;
  onClose: () => void;
  kind: ContractorKind;
  onCreated: ((created: ContractorCreated) => void) | undefined;
  onUnarchived: ((card: ContractorUnarchived) => void) | undefined;
  options: ContractorFormOptions;
  catalog: Catalog;
  dicts: ValueDicts;
  codes: PhoneCodes['items'];
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const id = useId();
  const phone = useMediaQuery(PHONE_QUERY);
  const client = useQueryClient();
  const refresh = useContractorsRefresh();
  const [initial] = useState(() =>
    newDraft({
      kind,
      today: bishkekDate(new Date()),
      formCode: dicts.forms.some((f) => f.active && f.code === NEW_CONTRACTOR_FORM)
        ? NEW_CONTRACTOR_FORM
        : '',
      regimeCode: catalog.regimes.some((r) => r.active && r.code === SINGLE_TAX_REGIME)
        ? SINGLE_TAX_REGIME
        : '',
      responsibleId: options.defaultResponsible ?? '',
      phoneCc: codes.find((c) => c.active)?.cc ?? codes[0]?.cc ?? '',
    }),
  );
  const [d, setD] = useState<ContractorDraft>(initial);
  const [fieldErrors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  // ИНН архивного контрагента: в ошибке поля — «Вернуть из архива» (ТЗ «Регистрация контрагентов»,
  // прототип addCpDlg `nc-unarch`; возврат — задача 2.12). Кнопка — с правом метода «Отправлять в
  // архив и удалять контрагентов» и пока ИНН в поле тот же.
  // ОТКЛОНЕНИЕ: docs/deviations.md#А-8
  const [archived, setArchived] = useState<{ id: string; inn: string } | null>(null);
  const [unarchiving, setUnarchiving] = useState(false);
  const { access } = useShell();
  const service = useServiceActions({
    onUnarchived: (card) => {
      onClose();
      onUnarchived?.(card);
    },
  });
  const [step, setStep] = useState<FormSection>(1);
  const [win, setWin] = useState<{ kind: 'benefits' | 'pick' | 'single'; n: number } | null>(null);
  const [winOpen, setWinOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [decided, setDecided] = useState<Decisions>(NO_DECISIONS);
  const [busy, setBusy] = useState(false);
  const sections = useRef<Partial<Record<FormSection, HTMLElement | null>>>({});

  const regular = d.kind === 'regular';
  const benefitCodes = d.benefits.map((b) => b.code);
  const gkedCodes = d.gkedExtra.map((g) => g.code);
  const office = dicts.offices.find((o) => o.code === d.taxOfficeCode);
  const manualEn = Object.entries(d.rates.en).find(([code]) => d.rates.manual.includes(code))?.[1];
  const socfundChoice = {
    flags: d.socfund.flags,
    ...(d.socfund.touched
      ? {
          tariff: (d.socfund.tariff || null) as NonNullable<ReportPickRequest['socfund']>['tariff'],
        }
      : {}),
  };
  const pickRequest: Omit<ReportPickRequest, 'contractorId' | 'bases'> = {
    formCode: d.formCode || null,
    regimeCode: d.regimeCode || null,
    regime2Code: (d.regimeCode && d.regime2Code) || null,
    gked: d.gked?.code ?? null,
    gkedExtra: gkedCodes,
    taxOfficeCode: d.taxOfficeCode || null,
    bizSize: d.bizSize,
    benefits: benefitCodes,
    ...(manualEn ? { enRates: manualEn.map((e) => ({ code: e.code, variant: e.variant })) } : {}),
    socfund: socfundChoice,
  };
  const calc = useReportPickCalc({ ...pickRequest, bases: d.bases });
  const auto = useMemo(() => (calc ? reportPickAuto(calc.pick) : null), [calc]);
  // Неподходящие к режиму и форме виды снимаются (прототип: смена режима и формы убирает их из выбора).
  const sel = chosenReports(d, auto).filter((code) => !calc?.pick.off.has(code));
  // «Выберите хотя бы один отчёт» уходит сама, как только отчёты подобрались или выбраны.
  const errors = sel.length && fieldErrors.reports ? withoutReports(fieldErrors) : fieldErrors;
  const notes = useQuery({
    ...gkedCheckQuery({
      gked: d.gked?.code ?? null,
      gkedExtra: gkedCodes,
      formCode: d.formCode || null,
      regimeCode: d.regimeCode || null,
      regime2Code: (d.regimeCode && d.regime2Code) || null,
      benefits: benefitCodes,
      reportTypes: regular ? sel : [],
    }),
    enabled: !!d.gked || gkedCodes.length > 0,
  }).data;
  const socfundRequest = {
    ...socfundChoice,
    reason: '',
    kind: d.kind,
    bases: d.bases,
    gked: d.gked?.code ?? null,
    formCode: d.formCode || null,
    benefits: benefitCodes,
  };
  const socfund = useQuery({ ...socfundCheckQuery(socfundRequest), enabled: regular }).data;
  const cx: SingleTaxContext | null = calc
    ? {
        rates: dicts.rates,
        index: new Map(calc.ctx.gkedIndex.map((n) => [n.code, n])),
        subject: {
          gked: d.gked?.code ?? null,
          gkedExtra: gkedCodes,
          benefits: benefitCodes,
          place: [office?.region ?? '', d.registration.address.trim()].filter(Boolean).join(' '),
        },
        today: calc.ctx.today,
      }
    : null;
  const enDefaults = cx ? singleTaxDefaults(cx) : [];
  const fee = { feeOn: options.feeOn, fee: options.fee };
  const showFee = feeFieldShown(d, fee);
  const checkCx: DraftCheckContext = {
    codes,
    reports: sel,
    fee,
    block: notes?.block[0] ?? null,
    socfundReason: !!(regular && socfund?.needed && socfund.manualMismatch),
  };

  const set = (patch: Partial<ContractorDraft>, ...clear: FormField[]) => {
    setD((x) => ({ ...x, ...patch }));
    if (clear.length) {
      setErrors((e) => {
        const next = { ...e };
        for (const k of clear) delete next[k];
        return next;
      });
    }
  };
  const fieldId = (k: FormField) => `${id}-${k.replace('.', '-')}`;
  const show = (sec: FormSection) => {
    if (phone) setStep(sec);
    else sections.current[sec]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const focusField = (k: FormField) => {
    if (phone) setStep(FIELD_SECTION[k]);
    // Ошибка в регистрационных данных: свёрнутый блок раскрывается, чтобы она была видна.
    if (k === 'okpo' || k === 'email') set({ regOpen: true });
    requestAnimationFrame(() =>
      document.getElementById(fieldId(k))?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  };
  /** Проверить раздел (или всё) и показать ошибки; первое неверное поле — или null. */
  const validate = (sec?: FormSection): FormField | null => {
    const all = draftErrors(d, checkCx, t);
    const keys = (Object.keys(all) as FormField[]).filter((k) => !sec || FIELD_SECTION[k] === sec);
    setErrors((e) => {
      const next: Partial<Record<FormField, string>> = {};
      if (sec) {
        for (const [k, v] of Object.entries(e) as [FormField, string][]) {
          if (FIELD_SECTION[k] !== sec) next[k] = v;
        }
      }
      for (const k of keys) next[k] = all[k]!;
      return next;
    });
    return keys[0] ?? null;
  };
  const next = () => {
    const bad = validate(step);
    if (bad) return focusField(bad);
    setStep((s) => (s < 3 ? ((s + 1) as FormSection) : s));
  };
  const goStep = (n: FormSection) => {
    if (!phone) return show(n);
    for (let s = step; s < n; s++) {
      const bad = validate(s as FormSection);
      if (bad) return focusField(bad);
    }
    setStep(n);
  };
  const confirm = (a: Ask) => {
    setAsk(a);
    setAskOpen(true);
  };
  const openWin = (k: 'benefits' | 'pick' | 'single') => {
    setWin((w) => ({ kind: k, n: (w?.n ?? 0) + 1 }));
    setWinOpen(true);
  };

  /** Вопрос о праве на режим по ГКЭД (прототип gkEnOk) для набранных значений; null — не нужен. */
  const gkedAsk = async (
    draft: ContractorDraft,
    ok: string,
  ): Promise<ContractorGkedNotes | null> => {
    if (!draft.gked && !draft.gkedExtra.length) return null;
    const fresh = await client
      .fetchQuery(
        gkedCheckQuery({
          gked: draft.gked?.code ?? null,
          gkedExtra: draft.gkedExtra.map((g) => g.code),
          formCode: draft.formCode || null,
          regimeCode: draft.regimeCode || null,
          regime2Code: (draft.regimeCode && draft.regime2Code) || null,
          benefits: draft.benefits.map((b) => b.code),
          reportTypes: draft.kind === 'regular' ? sel : [],
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
    // Вопрос задаётся сразу при выборе режима, как в прототипе; «Отмена» оставляет режим — при
    // сохранении вопрос будет снова.
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

  const changeOfficeCode = (code: string) => {
    const r = changeOffice(catalog, d.benefits, d.taxOfficeCode, code, t);
    set({ taxOfficeCode: code, benefits: r.benefits });
    if (r.message) toast(r.message, { icon: 'info' });
  };

  const unselect = (code: string) => {
    const rec = calc?.pick.rec.get(code);
    const go = () =>
      setD((x) => ({
        ...x,
        reports: { sel: sel.filter((c) => c !== code), picked: true },
        forced: rec?.pre && rec.must ? [...new Set([...x.forced, code])] : x.forced,
      }));
    if (rec?.pre && rec.must) {
      confirm({
        title: t('cp.form.must.title'),
        text: t('cp.form.must.text', {
          must: rec.must,
          name: catalog.type(code)?.shortName ?? code,
        }),
        ok: t('cp.form.must.ok'),
        danger: true,
        run: go,
      });
    } else go();
  };

  const save = async (over: Partial<Decisions> = {}, again = true) => {
    if (busy) return;
    const dec = { ...decided, ...over };
    const bad = validate();
    if (bad) return focusField(bad);
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
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors.$post({
        json: createRequestOf(d, {
          codes,
          fee,
          reports: sel,
          enDefaults,
          gkedConfirm: dec.gked === gkedSig(d),
          socfundConfirm: dec.socfund,
        }),
      }),
    );
    setBusy(false);
    if (res.ok) {
      const created = ContractorCreated.safeParse(res.data);
      refresh();
      onClose();
      toast(
        regular
          ? t('cp.form.created', { n: created.success ? created.data.reportsCreated : 0 })
          : t('cp.form.created_oneoff'),
        { icon: 'building' },
      );
      if (!d.regimeCode) {
        setTimeout(() => toast(t('cp.form.no_regime'), { icon: 'alert', bad: true }), 1600);
      }
      if (created.success) onCreated?.(created.data);
      return;
    }
    const details = res.error.details as
      { field?: unknown; id?: unknown; archived?: unknown } | undefined;
    const field = formFieldOf(details?.field);
    setArchived(
      res.error.code === 'inn_duplicate' &&
        details?.archived === true &&
        typeof details.id === 'string'
        ? { id: details.id, inn: d.inn }
        : null,
    );
    // Сервер сам спросил о праве на режим (сверку не удалось получить заранее): спросить один раз,
    // повторный отказ — обычная ошибка под полем.
    if (res.error.code === 'gked_confirm_required' && again)
      return save({ ...over, gked: '' }, false);
    if (field) {
      setErrors((e) => ({ ...e, [field]: errorText(res.error) }));
      return focusField(field);
    }
    toast(res.status >= 500 || res.status === 0 ? t('cp.form.save_failed') : errorText(res.error), {
      icon: 'alert',
      bad: true,
    });
  };

  const mark = (sec: FormSection) => {
    const bad = errorsInSection(errors, sec);
    const left = leftInSection(d, sec, checkCx);
    return bad ? (
      <span className="inline-flex items-center gap-[3px] text-[11px] font-semibold text-danger-label">
        <Icon name="alert" size="sm" />
        {t('cp.form.mark.bad', { n: bad })}
      </span>
    ) : left ? (
      <span className="text-[11px] font-semibold text-caution-label">
        {t('cp.form.mark.left', { n: left })}
      </span>
    ) : (
      <span className="inline-flex items-center gap-[3px] text-[11px] font-semibold text-ok">
        <Icon name="check" size="sm" />
        {t('cp.form.mark.done')}
      </span>
    );
  };

  const toc = (
    <div
      role="tablist"
      aria-label={t('cp.form.sections')}
      data-cf-toc=""
      data-form-toc=""
      className={`sticky -top-1.5 z-[3] -mt-1.5 flex gap-1.5 bg-pane pt-1.5 pb-2 shadow-[0_1px_0_var(--bu-line)] ${phone ? 'flex-nowrap items-center gap-0.5' : 'flex-wrap'}`}
    >
      {FORM_SECTIONS.map((sec) => {
        // На ПК, как в прототипе (cfToc со step = 1), выделен первый раздел: оглавление только прокручивает.
        const on = phone ? step === sec : sec === 1;
        return (
          <div key={sec} className={`contents`}>
            <button
              type="button"
              role="tab"
              aria-selected={on}
              data-cf-step={sec}
              onClick={() => goStep(sec)}
              className={`inline-flex cursor-pointer items-center border border-line font-semibold ${on ? 'bg-raised text-ink shadow-btn' : 'bg-pane-alt text-muted'} ${phone ? 'min-w-0 flex-[1_1_0] flex-col gap-0.5 rounded-md px-1 py-1.5 text-center text-[11.5px] leading-[1.2]' : 'gap-[7px] rounded-full py-[5px] pr-3 pl-1.5 text-[12.5px]'}`}
            >
              <span
                className={`inline-grid h-5 w-5 flex-none place-items-center rounded-full text-[11.5px] font-bold ${on ? 'bg-accent text-on-accent' : 'bg-sel text-muted'}`}
              >
                {sec}
              </span>
              <span className="max-w-full truncate">{t(`cp.form.sec.${sec}`)}</span>
              <span data-cf-mark={sec}>{mark(sec)}</span>
            </button>
            {phone && sec < 3 ? (
              <span aria-hidden="true" className="inline-grid flex-none text-faint">
                <Icon name="right" size="sm" />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const section = (sec: FormSection, body: ReactNode) => (
    <section
      key={sec}
      ref={(el) => {
        sections.current[sec] = el;
      }}
      data-cf-sec={sec}
      hidden={phone && step !== sec}
      className="flex scroll-mt-[52px] flex-col gap-2.5"
    >
      {phone ? null : (
        <h3 className="m-0 flex items-center gap-2 border-b border-line pb-1.5 text-[14px]">
          <span className="inline-grid h-5 w-5 flex-none place-items-center rounded-full bg-accent text-[11.5px] font-bold text-on-accent">
            {sec}
          </span>
          {t(`cp.form.sec.${sec}`)}
        </h3>
      )}
      <FormGrid>{body}</FormGrid>
    </section>
  );

  const s1 = (
    <>
      <Field
        id={`${id}-kind`}
        label={t('cp.form.kind')}
        full
        hint={t(`cp.form.kind.${d.kind}_hint`)}
      >
        {() => (
          <div className="self-start" data-cp-field="kind">
            <Segments<ContractorKind>
              label={t('cp.form.kind')}
              options={[
                { value: 'regular', label: t('cp.form.kind.regular') },
                { value: 'oneoff', label: t('cp.form.kind.oneoff') },
              ]}
              value={d.kind}
              onChange={(v) => set({ kind: v }, 'reports', 'tariff', 'socfund.reason')}
            />
          </div>
        )}
      </Field>
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
      <Field
        id={fieldId('inn')}
        label={t('cp.form.inn')}
        required
        error={
          errors.inn && archived?.inn === d.inn && access.can('cpArchive') ? (
            <>
              {errors.inn}{' '}
              <button
                type="button"
                data-cp-unarchive=""
                className={`${buttonClass('default', 'sm')} ml-1 align-middle`}
                disabled={unarchiving}
                onClick={async () => {
                  setUnarchiving(true);
                  await service.unarchive(archived.id);
                  setUnarchiving(false);
                }}
              >
                {t('svc.menu.unarchive')}
              </button>
            </>
          ) : (
            errors.inn
          )
        }
      >
        {(control) => (
          <input
            {...control}
            className={inputClass({ mono: true })}
            value={d.inn}
            inputMode="numeric"
            maxLength={14}
            placeholder={t('cp.form.inn_placeholder')}
            data-cp-field="inn"
            onChange={(e) => set({ inn: e.target.value.replace(/\D/g, '').slice(0, 14) }, 'inn')}
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
            {
              gked: v,
              gkedExtra: d.gkedExtra.filter((x) => x.code !== v.code),
              rates: { ...d.rates, manual: [] },
            },
            'gked',
            'regimeCode',
          )
        }
        onExtra={(v) => set({ gkedExtra: v, rates: { ...d.rates, manual: [] } }, 'regimeCode')}
      />
      <FormSelect
        id={fieldId('formCode')}
        forms={dicts.forms}
        value={d.formCode}
        required
        error={errors.formCode}
        onChange={(code) => set({ formCode: code }, 'formCode', 'regimeCode')}
      />
      <OfficeSelect
        id={`${id}-office`}
        offices={dicts.offices}
        value={d.taxOfficeCode}
        onChange={changeOfficeCode}
      />
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
      <div className="col-span-full flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <button
          type="button"
          className={linkButtonClass()}
          aria-expanded={d.regOpen}
          data-cp-reg-toggle=""
          onClick={() => set({ regOpen: !d.regOpen }, 'okpo', 'email')}
        >
          <Icon name={d.regOpen ? 'down' : 'right'} size="sm" />
          {t('cp.form.reg_toggle')}
        </button>
        <span className="text-[12px] text-muted">
          {t(d.regOpen ? 'cp.form.reg_hint' : 'cp.form.reg_hint_optional')}
        </span>
      </div>
      {d.regOpen ? (
        <RegistrationFields
          idPrefix={id}
          value={d.registration}
          errors={{ okpo: errors.okpo, email: errors.email }}
          onChange={(v) => set({ registration: v }, 'okpo', 'email')}
        />
      ) : null}
    </>
  );

  const s2 = (
    <>
      <RegimeFields
        idPrefix={id}
        regimeId={fieldId('regimeCode')}
        catalog={catalog}
        regime={d.regimeCode}
        regime2={d.regime2Code}
        error={errors.regimeCode}
        onRegime={(code) => void changeRegime(code)}
        onRegime2={(code) => set({ regime2Code: code }, 'regimeCode')}
      />
      <BizSizeField id={`${id}-size`} value={d.bizSize} onChange={(v) => set({ bizSize: v })} />
      <BenefitsField
        id={`${id}-ben`}
        catalog={catalog}
        benefits={d.benefits}
        office={d.taxOfficeCode}
        hint={t('cp.form.benefits_hint')}
        onOpen={() => openWin('benefits')}
      />
      {regular ? (
        <BasesField
          id={`${id}-bases`}
          catalog={catalog}
          bases={d.bases}
          hint={t('cp.form.bases_hint')}
          onChange={(bases) => set({ bases }, 'reports')}
        />
      ) : null}
      {regular ? (
        <SocfundFields
          idPrefix={id}
          reasonId={fieldId('socfund.reason')}
          draft={d.socfund}
          check={socfund}
          reasonError={errors['socfund.reason']}
          onChange={(v) => set({ socfund: v }, 'socfund.reason')}
        />
      ) : null}
      {notes ? (
        <div className="col-span-full flex flex-col gap-2">
          <GkedNotesView notes={notes} />
        </div>
      ) : null}
    </>
  );

  const s3 = (
    <>
      {regular ? (
        <ReportsBlock
          id={fieldId('reports')}
          catalog={catalog}
          sel={sel}
          auto={!d.reports.picked && sel.length > 0}
          why={(code) => calc?.pick.rec.get(code)?.why ?? ''}
          error={errors.reports}
          ready={!!calc}
          onPick={() => openWin('pick')}
          onAdd={() => openWin('single')}
          onRemove={unselect}
        />
      ) : null}
      {regular ? (
        <div className="col-span-full flex flex-col gap-2">
          <NotNeededNote
            benefits={benefitCodes}
            assigned={sel}
            catalog={catalog}
            onRemove={(drop) =>
              set({ reports: { sel: sel.filter((c) => !drop.includes(c)), picked: true } })
            }
          />
          {d.reports.picked && auto ? (
            <MissingNote
              catalog={catalog}
              missing={auto.filter((c) => !sel.includes(c))}
              onAdd={(codes) =>
                set({ reports: { sel: [...sel, ...codes], picked: true } }, 'reports')
              }
            />
          ) : null}
          {calc ? (
            <GkedFitHint
              catalog={catalog}
              sel={sel}
              connected={calc.ctx.connected}
              subject={{
                gked: d.gked?.code ?? null,
                gkedExtra: gkedCodes,
                form: calc.ctx.subject.form,
                regimes: [],
                benefits: [],
              }}
              index={cx?.index ?? new Map()}
            />
          ) : null}
        </div>
      ) : null}
      {regular && sel.length && cx ? (
        <Field id={`${id}-rates`} label={t('cp.form.rates')} full hint={t('cp.form.rates_hint')}>
          {() =>
            sel.some((c) => (catalog.type(c)?.rates.length ?? 0) > 0) ? (
              <RateRows
                codes={sel}
                types={catalog.type}
                state={d.rates}
                defaults={enDefaults}
                cx={cx}
                onChange={(rates) => set({ rates })}
              />
            ) : (
              <span className="text-faint">{t('cp.form.rates_none')}</span>
            )
          }
        </Field>
      ) : null}
      <Field
        id={fieldId('responsibleEmployeeId')}
        label={t('cp.form.responsible')}
        required
        error={errors.responsibleEmployeeId}
      >
        {(control) => (
          <select
            {...control}
            className={`${inputClass()} cursor-pointer`}
            value={d.responsibleId}
            data-cp-field="responsible"
            onChange={(e) => set({ responsibleId: e.target.value }, 'responsibleEmployeeId')}
          >
            <option value="">{t('cp.form.choose')}</option>
            {options.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.shortName}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        id={fieldId('startDate')}
        label={t(regular ? 'cp.form.start' : 'cp.form.start_oneoff')}
        error={errors.startDate}
      >
        {(control) => (
          <input
            {...control}
            type="date"
            className={inputClass()}
            value={d.startDate}
            data-cp-field="start"
            onChange={(e) => set({ startDate: e.target.value }, 'startDate')}
          />
        )}
      </Field>
      {showFee ? (
        <FeeFields
          id={fieldId('tariff')}
          d={d}
          error={errors.tariff}
          onChange={(patch) => set(patch, 'tariff')}
        />
      ) : regular && options.feeOn ? (
        <div className="col-span-full">
          <Note icon="lock">{t('cp.form.fee_locked')}</Note>
        </div>
      ) : null}
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
      {showFee ? (
        <p className="col-span-full m-0 text-[12px] text-muted" data-cp-proration="">
          {prorationText(d, t)}
        </p>
      ) : null}
    </>
  );

  const cancel = (
    <button type="button" className={buttonClass('ghost')} onClick={onClose}>
      {t('btn.cancel')}
    </button>
  );
  const saveButton = (
    <button
      type="button"
      className={buttonClass('cta')}
      // Пока отчёты подбираются, сохранять рано: «Сдаёт отчёты» ещё пуст.
      disabled={busy || (regular && !calc)}
      data-cp-save=""
      onClick={() => void save()}
    >
      {t('cp.form.save_new')}
    </button>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        kind="form"
        size="mid"
        title={t('cp.form.title_new')}
        sub={t('cp.form.sub_new')}
        dirty={JSON.stringify(d) !== JSON.stringify(initial)}
        footer={
          phone ? (
            <>
              {step > 1 ? (
                <button
                  type="button"
                  className={buttonClass('ghost')}
                  data-cf-back=""
                  onClick={() => setStep((s) => (s > 1 ? ((s - 1) as FormSection) : s))}
                >
                  <Icon name="left" size="sm" />
                  {t('cp.form.back')}
                </button>
              ) : (
                cancel
              )}
              <div className="flex-1" />
              {step < 3 ? (
                <button type="button" className={buttonClass('cta')} data-cf-next="" onClick={next}>
                  {t('cp.form.next')}
                  <Icon name="right" size="sm" />
                </button>
              ) : (
                saveButton
              )}
            </>
          ) : (
            <>
              {cancel}
              {saveButton}
            </>
          )
        }
      >
        <div className="flex flex-col gap-[18px]" data-cf="" data-step={phone ? step : undefined}>
          {toc}
          {section(1, s1)}
          {section(2, s2)}
          {section(3, s3)}
        </div>
      </Modal>
      {win?.kind === 'benefits' ? (
        <BenefitPickDialog
          key={`benefits-${win.n}`}
          open={winOpen}
          onClose={() => setWinOpen(false)}
          request={{ ...pickRequest, bases: d.bases }}
          taxOffice={d.taxOfficeCode || null}
          value={d.benefits}
          title={d.name.trim() || t('cp.form.title_new')}
          onApply={(benefits) => set({ benefits })}
        />
      ) : null}
      {win?.kind === 'pick' || win?.kind === 'single' ? (
        <ReportPickDialog
          key={`pick-${win.n}`}
          single={win.kind === 'single'}
          open={winOpen}
          onClose={() => setWinOpen(false)}
          request={pickRequest}
          initial={{ sel, bases: d.bases }}
          title={d.name.trim() || t('cp.form.title_new')}
          onApply={(choice) =>
            setD((x) => {
              setErrors((e) => {
                const rest = { ...e };
                delete rest.reports;
                return rest;
              });
              return {
                ...x,
                reports: { sel: choice.sel, picked: true },
                bases: choice.bases,
                forced: [...new Set([...x.forced, ...choice.forced])],
              };
            })
          }
        />
      ) : null}
      {ask ? (
        <ConfirmDialog
          open={askOpen}
          onClose={() => setAskOpen(false)}
          title={ask.title}
          text={<span className="whitespace-pre-line">{ask.text}</span>}
          ok={ask.ok}
          danger={ask.danger ?? false}
          onConfirm={ask.run}
        />
      ) : null}
    </>
  );
}

/** «Сдаёт отчёты» (прототип cfTypes): выбранные виды с причиной подбора, «Подобрать отчёты», «Добавить отчёт». */
function ReportsBlock({
  id,
  catalog,
  sel,
  auto,
  why,
  error,
  ready,
  onPick,
  onAdd,
  onRemove,
}: {
  id: string;
  catalog: Catalog;
  sel: readonly string[];
  auto: boolean;
  why: (code: string) => string;
  error: string | undefined;
  ready: boolean;
  onPick: () => void;
  onAdd: () => void;
  onRemove: (code: string) => void;
}) {
  const t = useT();
  return (
    <Field id={id} label={t('cp.form.types')} required full error={error}>
      {(control) => (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1.5" data-cp-types="">
            {sel.length ? (
              sel.map((code) => {
                const x = catalog.type(code);
                return (
                  <div
                    key={code}
                    data-cp-type={code}
                    className="flex items-center gap-2 rounded-md border border-line bg-raised py-[7px] pr-2 pl-3"
                  >
                    <div className="min-w-0 grow">
                      <b>{x?.shortName ?? code}</b>{' '}
                      {x ? <ActPill act={x.act} label={t(`report.act.${x.act}`)} /> : null}{' '}
                      <span className="text-muted">
                        {x ? catalog.authority(x.authorityCode) : ''}
                      </span>
                      <div className="mt-px text-[12px] text-muted">
                        {why(code) || t('cp.form.types_manual')}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={iconButtonClass('sm')}
                      title={t('cp.form.types_remove', { name: x?.shortName ?? code })}
                      aria-label={t('cp.form.types_remove', { name: x?.shortName ?? code })}
                      onClick={() => onRemove(code)}
                    >
                      <Icon name="x" size="sm" />
                    </button>
                  </div>
                );
              })
            ) : (
              <span className="text-faint">{t('cp.form.types_none')}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              {...control}
              type="button"
              className={buttonClass('cta', 'sm')}
              disabled={!ready}
              data-cp-pick=""
              onClick={onPick}
            >
              <Icon name="list" size="sm" />
              {t('cp.form.pick_btn')}
            </button>
            <button
              type="button"
              className={buttonClass('default', 'sm')}
              disabled={!ready}
              data-cp-pick-one=""
              onClick={onAdd}
            >
              <Icon name="plus" size="sm" />
              {t('cp.form.add_btn')}
            </button>
          </div>
          {auto ? (
            <span className="flex items-start gap-1.5 text-[12px] text-muted">
              <Icon name="info" size="sm" />
              {t('cp.form.types_auto')}
            </span>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/** Обязательные по подбору, но не выбранные (прототип cfMissing) — с кнопкой «Добавить». */
function MissingNote({
  catalog,
  missing,
  onAdd,
}: {
  catalog: Catalog;
  missing: readonly string[];
  onAdd: (codes: string[]) => void;
}) {
  const t = useT();
  if (!missing.length) return null;
  return (
    <Note>
      <div className="flex flex-wrap items-center gap-2" data-cp-missing="">
        <span className="grow">
          {t('cp.form.missing', {
            names: missing.map((c) => catalog.type(c)?.shortName ?? c).join(', '),
          })}
        </span>
        <button
          type="button"
          className={buttonClass('default', 'sm')}
          onClick={() => onAdd([...missing])}
        >
          {t('btn.add')}
        </button>
      </div>
    </Note>
  );
}

/** «Подходит по ГКЭД: … · не выбраны: …» (прототип gkFitHint) — подключённые виды с перечнем ГКЭД. */
function GkedFitHint({
  catalog,
  sel,
  connected,
  subject,
  index,
}: {
  catalog: Catalog;
  sel: readonly string[];
  connected: readonly string[];
  subject: Parameters<typeof gkedFitOf>[1];
  index: Parameters<typeof gkedFitOf>[2];
}) {
  const t = useT();
  if (!subject.gked && !subject.gkedExtra.length) return null;
  const fit = catalog.types.filter(
    (x) => connected.includes(x.code) && (gkedFitOf(x.gked, subject, index).fit ?? []).length > 0,
  );
  if (!fit.length) return null;
  const miss = fit.filter((x) => !sel.includes(x.code));
  return (
    <span className="flex items-start gap-1.5 text-[12px] text-muted" data-cp-gked-fit="">
      <Icon name="check" size="sm" />
      <span>
        {t('cp.form.gked_fit', { names: fit.map((x) => x.shortName).join(', ') })}
        {miss.length
          ? t('cp.form.gked_fit_miss', { names: miss.map((x) => x.shortName).join(', ') })
          : ''}
      </span>
    </span>
  );
}

/** Стоимость обслуживания: сумма, «в месяц / в год» и «Первый неполный месяц». */
function FeeFields({
  id,
  d,
  error,
  onChange,
}: {
  id: string;
  d: ContractorDraft;
  error: string | undefined;
  onChange: (patch: Partial<ContractorDraft>) => void;
}) {
  const t = useT();
  return (
    <>
      <Field
        id={id}
        label={t('cp.form.fee')}
        required
        error={error}
        hint={d.period === 'Y' ? t('cp.form.fee_year_hint') : undefined}
      >
        {(control) => (
          <div className="flex flex-nowrap items-center gap-2">
            <input
              {...control}
              className={inputClass({ mono: true })}
              value={d.fee}
              inputMode="decimal"
              data-cp-field="fee"
              onChange={(e) => onChange({ fee: e.target.value })}
            />
            <div className="flex-none whitespace-nowrap">
              <Segments<TariffPeriod>
                label={t('cp.form.fee_period')}
                options={[
                  { value: 'M', label: t('cp.form.fee.month') },
                  { value: 'Y', label: t('cp.form.fee.year') },
                ]}
                value={d.period}
                onChange={(v) => onChange({ period: v })}
              />
            </div>
          </div>
        )}
      </Field>
      {d.period === 'M' ? (
        <Field id={`${id}-first`} label={t('cp.form.first')}>
          {(control) => (
            <select
              {...control}
              className={`${inputClass()} cursor-pointer`}
              value={d.firstMonth}
              data-cp-field="first"
              onChange={(e) => onChange({ firstMonth: e.target.value as FirstMonthMode })}
            >
              {(['prorate', 'full', 'next'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`cp.form.first.${m}`)}
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
