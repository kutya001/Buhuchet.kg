'use client';

import {
  benefitsEndingSoon,
  bishkekDate,
  formatDateRu,
  pluralForm,
  SOCFUND_FLAGS,
} from '@buhuchet/domain';
import { ContractorSaved, type Contractor, type UpdateContractorRequest } from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  inputClass,
  linkButtonClass,
  Modal,
  Note,
  Pill,
  RecordChangedNotice,
  Tag,
  useToast,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { valueDictsQuery, type Catalog } from '../dicts/dicts-data';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import { BenefitPickDialog, type BenefitChoice } from './benefit-pick';
import { socfundCheckQuery, useContractorsRefresh } from './contractor-data';
import {
  SocfundFields,
  socfundDraftOf,
  socfundRequestOf,
  type SocfundDraft,
} from './socfund-fields';

/*
 * Правки прямо в «Основном» карточки контрагента (ТЗ «Карточка контрагента», «Тариф страховых взносов
 * в Соцфонд»; прототип modules/contractor-card.js — `#cp-ben`, `#cp-ugns`, benSoon; modules/socfund-ui.js
 * — sfCardKv, sfCardMount, sfDlg): строка «Льготы и особые статусы» с «выбрать» (без права — «описания»)
 * и предупреждением за 60 дней до конца льготы по кодексу, выбор УГНС списком и строка «Тариф
 * Соцфонда» с признаками, «изменить» и «Сменить на …». Сохраняется только изменённое поле с версией
 * записи; статусы по УГНС и сроки отчётов по статусам пересчитывает сервер.
 */

export interface CardEdits {
  benefits: ReactNode;
  office: ReactNode;
  /** null — тариф Соцфонда контрагенту не нужен (разовый или без наёмных, docs/deviations.md п. А-5). */
  socfund: ReactNode | null;
  dialogs: ReactNode;
}

const Faint = ({ children }: { children: ReactNode }) => (
  <span className="text-faint">{children}</span>
);
const Hint = ({ children }: { children: ReactNode }) => (
  <span className="block text-[11.5px] leading-[1.4] text-faint">{children}</span>
);
const linkClass = `${linkButtonClass()} text-[12px]`;

/** «Тариф ПВТ / ПКИ» → «тариф ПВТ / ПКИ» для «Сменить на …» (прототип sfLow без « тариф»). */
const low = (s: string) => s.replace(/^./, (x) => x.toLowerCase()).replace(/ тариф$/, '');

const reduedText = (t: Translate, n: number) =>
  n ? t(`cp.form.edit.redued.${pluralForm(n)}`, { n }) : '';

const sameBenefits = (a: readonly BenefitChoice[], b: readonly BenefitChoice[]) =>
  JSON.stringify(a.map((x) => [x.code, x.validFrom, x.validTo])) ===
  JSON.stringify(b.map((x) => [x.code, x.validFrom, x.validTo]));

export function useCardEdits(c: Contractor, catalog: Catalog | undefined): CardEdits {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const { access } = useShell();
  const edit = access.can('createCp') && c.serviceStatus !== 'archived';
  const offices = useQuery({ ...valueDictsQuery, enabled: edit }).data?.offices;
  const [ben, setBen] = useState<{ n: number; open: boolean }>({ n: 0, open: false });
  const [sf, setSf] = useState<{ n: number; open: boolean }>({ n: 0, open: false });
  const [busy, setBusy] = useState(false);

  const patch = async (
    json: Omit<UpdateContractorRequest, 'version'>,
    done: (saved: ContractorSaved) => string,
  ) => {
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors[':id'].$patch({
        param: { id: c.id },
        json: { ...json, version: c.version },
      }),
    );
    setBusy(false);
    refresh();
    if (!res.ok) return toast(errorText(res.error), { icon: 'alert', bad: true });
    const saved = ContractorSaved.safeParse(res.data);
    toast(saved.success ? done(saved.data) : t('cp.card.saved'));
  };

  const switchTariff = async (tariff: NonNullable<Contractor['socfund']['auto']>) => {
    if (!tariff.id) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors[':id'].socfund.$put({
        param: { id: c.id },
        json: { flags: c.socfund.flags, tariff: tariff.id, reason: '', version: c.version },
      }),
    );
    setBusy(false);
    refresh();
    if (!res.ok) return toast(errorText(res.error), { icon: 'alert', bad: true });
    toast(t('cp.socfund.switched', { tariff: tariff.short }));
  };

  const today = bishkekDate(new Date());
  const soon = catalog
    ? benefitsEndingSoon(
        catalog.benefits,
        c.benefits.map((b) => b.code),
        today,
      )
    : [];
  const benefits = (
    <>
      <span className="inline-flex flex-wrap items-center gap-1" data-cp-benefits="">
        {c.benefits.length ? (
          c.benefits.map((b) => {
            const x = catalog?.benefits.find((y) => y.code === b.code);
            const to = b.validTo ?? x?.validUntil ?? null;
            return (
              <Tag key={b.code} title={x?.gives || undefined}>
                {[
                  b.name,
                  b.byOffice ? t('cp.card.benefit_office') : '',
                  b.validFrom ? t('cp.card.benefit_from', { date: formatDateRu(b.validFrom) }) : '',
                  to ? t('cp.card.benefit_to', { date: formatDateRu(to) }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Tag>
            );
          })
        ) : (
          <Faint>{t('cp.card.none')}</Faint>
        )}{' '}
        <button
          type="button"
          data-cp-ben=""
          className={linkClass}
          onClick={() => setBen((x) => ({ n: x.n + 1, open: true }))}
        >
          {t(edit ? 'cp.card.benefits_pick' : 'cp.card.benefits_view')}
        </button>
      </span>
      {soon.map((b) => (
        <div key={b.name} className="mt-1.5">
          <Note tone="warn" icon="alert">
            {t('cp.card.benefit_soon', { name: b.name, date: formatDateRu(b.until), n: b.days })}
          </Note>
        </div>
      ))}
    </>
  );

  const officeLabel = (o: { gnsCode: string | null; name: string }) =>
    o.gnsCode ? `${o.gnsCode} · ${o.name}` : o.name;
  const current = c.taxOffice?.code ?? '';
  const office =
    edit && offices ? (
      <select
        className={`${inputClass()} min-h-[30px] cursor-pointer px-2 py-[3px]`}
        aria-label={t('cp.card.office')}
        data-cp-ugns=""
        value={current}
        disabled={busy}
        onChange={(e) => {
          const code = e.target.value;
          if (code === current) return;
          void patch(
            { taxOfficeCode: code || null },
            (s) => (s.notices.join('; ') || t('cp.card.saved')) + reduedText(t, s.redued),
          );
        }}
      >
        <option value="">{t('cp.form.not_set')}</option>
        {offices
          .filter((o) => o.active || o.code === current)
          .map((o) => (
            <option key={o.code} value={o.code}>
              {officeLabel(o)}
            </option>
          ))}
      </select>
    ) : c.taxOffice ? (
      c.taxOffice.name
    ) : (
      <Faint>{t('cp.card.office_none')}</Faint>
    );

  const socfund = c.socfund.needed ? (
    <SocfundValue
      t={t}
      c={c}
      edit={edit}
      busy={busy}
      onOpen={() => setSf((x) => ({ n: x.n + 1, open: true }))}
      onSwitch={(x) => void switchTariff(x)}
    />
  ) : null;

  const dialogs = (
    <>
      {ben.n ? (
        <BenefitPickDialog
          key={`ben-${ben.n}`}
          open={ben.open}
          onClose={() => setBen((x) => ({ ...x, open: false }))}
          request={{
            contractorId: c.id,
            formCode: c.form.code,
            regimeCode: c.regime?.code ?? null,
            regime2Code: c.regime2?.code ?? null,
            gked: c.gked?.code ?? null,
            gkedExtra: c.gkedExtra.map((g) => g.code),
            taxOfficeCode: c.taxOffice?.code ?? null,
            bizSize: c.bizSize,
            bases: c.bases.map((b) => b.code),
          }}
          taxOffice={c.taxOffice?.code ?? null}
          value={c.benefits.map((b) => ({
            code: b.code,
            validFrom: b.validFrom,
            validTo: b.validTo,
          }))}
          title={c.name}
          onApply={(value) => {
            const was = c.benefits.map((b) => ({
              code: b.code,
              validFrom: b.validFrom,
              validTo: b.validTo,
            }));
            if (sameBenefits(was, value)) return toast(t('cp.asg.unchanged'), { icon: 'info' });
            void patch(
              { benefits: value },
              (s) => t('cp.card.benefits_saved') + reduedText(t, s.redued),
            );
          }}
        />
      ) : null}
      {sf.n && c.socfund.needed ? (
        <SocfundDialog
          key={`sf-${sf.n}`}
          c={c}
          edit={edit}
          open={sf.open}
          onClose={() => setSf((x) => ({ ...x, open: false }))}
        />
      ) : null}
    </>
  );

  return { benefits, office, socfund, dialogs };
}

/** Строка «Тариф Соцфонда» карточки (прототип sfCardKv). */
function SocfundValue({
  t,
  c,
  edit,
  busy,
  onOpen,
  onSwitch,
}: {
  t: Translate;
  c: Contractor;
  edit: boolean;
  busy: boolean;
  onOpen: () => void;
  onSwitch: (tariff: NonNullable<Contractor['socfund']['auto']>) => void;
}) {
  const s = c.socfund;
  const cur = s.tariff;
  const auto = s.auto;
  const flags = SOCFUND_FLAGS.map((k, i) => {
    const v = s.flags[k];
    // Подпись без пояснения в скобках; у госфинансирования «нет» по умолчанию (прототип sfCardKv).
    const label = t(`cp.socfund.flag.${k}`).replace(/\s*\(.*\)$/, '');
    return (
      <span key={k}>
        {i ? ' · ' : ''}
        {label}:{' '}
        {v === null ? (
          k === 'gov' ? (
            t('cp.socfund.no')
          ) : (
            <span className="text-warn-label">{t('cp.socfund.flag_unset')}</span>
          )
        ) : v ? (
          t('cp.socfund.yes')
        ) : (
          t('cp.socfund.no')
        )}
      </span>
    );
  });
  return (
    <span className="block" data-cp-socfund="">
      <span className="inline-flex flex-wrap items-center gap-1">
        {cur ? (
          <Pill
            tone={cur.id === 'spino' ? 'ok' : cur.id === 'pvtpki' ? 'info' : 'plain'}
            icon="shield"
          >
            {cur.total ? `${cur.short} · ${cur.total}` : cur.short}
          </Pill>
        ) : (
          <Pill tone="warn" icon="alert">
            {t('cp.socfund.none')}
          </Pill>
        )}
        {cur ? <Tag>{t(cur.manual ? 'cp.socfund.manual' : 'cp.socfund.auto')}</Tag> : null}{' '}
        <button type="button" data-cp-sf="" className={linkClass} onClick={onOpen}>
          {t(edit ? (cur ? 'cp.socfund.edit' : 'cp.socfund.set') : 'cp.socfund.view_rates')}
        </button>
      </span>
      <Hint>{flags}</Hint>
      {!cur && auto ? (
        <Hint>
          {auto.id
            ? t('cp.socfund.fits', { tariff: auto.short })
            : t('cp.socfund.not_set', { miss: auto.miss.join(', ') })}
        </Hint>
      ) : null}
      {cur && s.bad && !cur.manual ? (
        <span className="mt-1.5 block">
          <Note tone="warn" icon="alert">
            <span className="flex flex-wrap items-center gap-2" data-sf-bad="">
              <span className="min-w-0 flex-[1_1_220px]">
                {t('cp.socfund.bad.stale', { tariff: cur.short, why: s.badWhy })}
              </span>
              {edit && auto?.id ? (
                <button
                  type="button"
                  data-cp-sfto=""
                  className={`${buttonClass('default', 'sm')} ml-auto`}
                  disabled={busy}
                  onClick={() => onSwitch(auto)}
                >
                  {t('cp.socfund.switch', { tariff: low(auto.short) })}
                </button>
              ) : null}
            </span>
          </Note>
        </span>
      ) : null}
      {cur && s.bad && cur.manual ? (
        <span className="mt-1.5 block">
          <Note tone="warn" icon="alert">
            {t('cp.socfund.bad.manual', { why: s.badWhy })}
            {cur.reason ? `. ${t('cp.socfund.reason_line', { reason: cur.reason })}` : ''}
          </Note>
        </span>
      ) : null}
      {cur && !s.bad && cur.manual && cur.reason ? (
        <Hint>{t('cp.socfund.manual_reason_line', { reason: cur.reason })}</Hint>
      ) : null}
      {cur && auto && cur.id === auto.id
        ? auto.warn.map((w) => (
            <span key={w} className="mt-1.5 block">
              <Note tone="warn" icon="alert">
                {w}
              </Note>
            </span>
          ))
        : null}
    </span>
  );
}

/**
 * Окно «Тариф Соцфонда» из карточки (прототип sfDlg): признаки, выбор тарифа, ставки. Ручной выбор
 * вопреки условиям — с причиной и подтверждением; без права или у архивного — только просмотр.
 */
function SocfundDialog({
  c,
  edit,
  open,
  onClose,
}: {
  c: Contractor;
  edit: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const [initial] = useState<SocfundDraft>(() => ({
    ...socfundDraftOf(c.socfund.flags, c.socfund.tariff?.manual ? c.socfund.tariff.id : ''),
    reason: c.socfund.tariff?.reason ?? '',
  }));
  const [draft, setDraft] = useState(initial);
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [ask, setAsk] = useState(false);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const req = socfundRequestOf(draft);
  const check = useQuery(
    socfundCheckQuery({
      flags: req.flags,
      ...(req.tariff !== undefined ? { tariff: req.tariff } : {}),
      reason: '',
      contractorId: c.id,
      kind: c.kind,
      bases: c.bases.map((b) => b.code),
      gked: c.gked?.code ?? null,
      formCode: c.form.code,
      benefits: c.benefits.map((b) => b.code),
    }),
  ).data;

  const save = async (confirm = false) => {
    if (busy || !check) return;
    if (check.manualMismatch && !draft.reason.trim()) {
      return setReasonError(t('err.socfund_reason_required'));
    }
    if (check.manualMismatch && check.confirm && !confirm) return setAsk(true);
    setBusy(true);
    const res = await callApi(() =>
      api.api.contractors[':id'].socfund.$put({
        param: { id: c.id },
        json: { ...req, version: c.version, ...(confirm ? { confirm: true } : {}) },
      }),
    );
    setBusy(false);
    if (res.ok) {
      refresh();
      onClose();
      return toast(t('cp.socfund.saved'));
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    if (res.error.code === 'socfund_reason_required') return setReasonError(errorText(res.error));
    toast(errorText(res.error), { icon: 'alert', bad: true });
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        kind="form"
        title={t('cp.socfund.title')}
        sub={c.name}
        dirty={edit && JSON.stringify(draft) !== JSON.stringify(initial)}
        footer={
          edit ? (
            <>
              <button type="button" className={buttonClass('ghost')} onClick={onClose}>
                {t('btn.cancel')}
              </button>
              <button
                type="button"
                data-sf-save=""
                className={buttonClass('cta')}
                disabled={busy || changed || !check}
                onClick={() => void save()}
              >
                {t('btn.save')}
              </button>
            </>
          ) : (
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('btn.close')}
            </button>
          )
        }
      >
        <div className="flex flex-col gap-3" data-sf-dialog="">
          {changed ? (
            <RecordChangedNotice
              message={t('err.record_changed')}
              reloadLabel={t('form.reload')}
              onReload={() => {
                refresh();
                onClose();
              }}
            />
          ) : null}
          <SocfundFields
            idPrefix={`sfd-${c.id}`}
            draft={draft}
            check={check}
            saved={
              c.socfund.tariff
                ? {
                    id: c.socfund.tariff.id,
                    manual: c.socfund.tariff.manual,
                    reason: c.socfund.tariff.reason,
                  }
                : null
            }
            reasonError={reasonError}
            disabled={!edit}
            onChange={(v) => {
              setDraft(v);
              setReasonError(undefined);
            }}
          />
        </div>
      </Modal>
      <ConfirmDialog
        open={ask}
        onClose={() => setAsk(false)}
        title={t('cp.socfund.confirm_title')}
        text={check?.confirm ?? ''}
        ok={t('btn.save')}
        onConfirm={() => {
          setAsk(false);
          void save(true);
        }}
      />
    </>
  );
}
