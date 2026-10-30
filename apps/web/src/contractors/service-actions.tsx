'use client';

import { monthLabel, monthLabelGen, type TariffPeriod } from '@buhuchet/domain';
import {
  ArchiveContractorsResult,
  ContractorServiceSaved,
  ContractorUnarchived,
  type ContractorService,
  type TaxRegime,
} from '@buhuchet/shared';
import {
  buttonClass,
  CheckRow,
  ConfirmDialog,
  Pill,
  RollbackDialog,
  StatusPill,
  useToast,
  type ActionEntry,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { rollbackLabels, rollbackTitle, statusPillView } from '../status/status-view';
import { activeRegimesQuery, serviceQuery, useServiceRefresh } from './service-data';
import { PauseServiceDialog, ResumeServiceDialog, ToRegularDialog } from './service-dialogs';
import { serviceMenuEntries, servicePlanNote, type ServiceMenuAction } from './service-menu';

/** Контрагент для окон обслуживания: название, режим и текущая ставка (если видна плата). */
export interface ServiceContractor {
  id: string;
  name: string;
  regimeCode: string | null;
  tariff: { amount: number; period: TariffPeriod } | null;
}

type Dialog =
  | { kind: 'pause' | 'resume'; contractor: ServiceContractor; service: ContractorService }
  | {
      kind: 'toRegular';
      contractor: ServiceContractor;
      service: ContractorService;
      regimes: readonly TaxRegime[];
    };

/**
 * Действия обслуживания контрагента (задача 2.12; прототип cpActions, pauseDlg, resumeDlg, unpauseCp,
 * rollbackDlg('svc'), archiveDlg, unarchiveCp, toRegularDlg): пункты меню «…» (`actions`), окна
 * (`dialogs` — поставить в разметку экрана), «Вернуть из архива» по номеру (`unarchive` — его же
 * вызывает форма «Новый контрагент» при ИНН архивного, docs/decisions.md п. А-5) и «В архив»
 * выбранных в списке (`archive`). Окна открываются по свежему обслуживанию с сервера. Карточку (2.11)
 * и список (2.10) подключают их задачи; `onRegular` — после перевода в постоянное обслуживание
 * открыть выбор отчётов.
 */
export function useServiceActions(
  options: {
    onRegular?: (contractorId: string) => void;
    onUnarchived?: (card: ContractorUnarchived) => void;
  } = {},
): {
  actions: (contractor: ServiceContractor, service: ContractorService) => ActionEntry[];
  archive: (contractors: readonly { id: string; name: string }[]) => void;
  unarchive: (contractorId: string) => void;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useServiceRefresh();
  const { access } = useShell();
  const rights = {
    createCp: access.can('createCp'),
    cpPause: access.can('cpPause'),
    cpArchive: access.can('cpArchive'),
    rollback: access.can('rollback'),
  };
  const feeVisible = access.can('fee');
  const [dialog, setDialog] = useState<DialogSlot<Dialog> | null>(null);
  const [askCancel, setAskCancel] = useState<ContractorService | null>(null);
  const [askArchive, setAskArchive] = useState<readonly { id: string; name: string }[] | null>(
    null,
  );
  const [back, setBack] = useState<DialogSlot<{
    contractor: ServiceContractor;
    service: ContractorService;
  }> | null>(null);
  const [fill, setFill] = useState<ReadonlySet<string>>(() => new Set());
  const [backBusy, setBackBusy] = useState(false);
  const [backError, setBackError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const fresh = (id: string) => client.fetchQuery({ ...serviceQuery(id), staleTime: 0 });
  /** После действия: обслуживание — в кэш, карточка, списки и отчёты — перечитать. */
  const applied = (saved: ContractorServiceSaved) => {
    client.setQueryData(serviceQuery(saved.service.id).queryKey, saved.service);
    refresh();
  };
  /** Окно открывается по свежему обслуживанию: версия и запланированное — как на сервере. */
  const load = async <T,>(fetch: () => Promise<T>): Promise<T | null> => {
    if (pending) return null;
    setPending(true);
    try {
      return await fetch();
    } catch {
      toast(t('err.unknown'), { bad: true });
      return null;
    } finally {
      setPending(false);
    }
  };

  const open = async (kind: 'pause' | 'resume' | 'toRegular', contractor: ServiceContractor) => {
    if (kind === 'toRegular') {
      const data = await load(() =>
        Promise.all([fresh(contractor.id), client.fetchQuery(activeRegimesQuery)]),
      );
      if (data) {
        setDialog(openSlot<Dialog>({ kind, contractor, service: data[0], regimes: data[1] }));
      }
      return;
    }
    const service = await load(() => fresh(contractor.id));
    if (service) setDialog(openSlot<Dialog>({ kind, contractor, service }));
  };

  const cancelPause = async (service: ContractorService) => {
    const res = await callApi(() =>
      api.api.contractors[':id'].pause.cancel.$post({
        param: { id: service.id },
        json: { version: service.version },
      }),
    );
    if (!res.ok) {
      refresh();
      return toast(errorText(res.error), { bad: true });
    }
    const saved = ContractorServiceSaved.safeParse(res.data);
    if (saved.success) applied(saved.data);
    else refresh();
    toast(t('svc.cancel.done'), { icon: 'check' });
  };

  const rollback = async (reason: string) => {
    if (!back) return;
    setBackBusy(true);
    const { service } = back.data;
    const res = await callApi(() =>
      api.api.contractors[':id'].pause.rollback.$post({
        param: { id: service.id },
        json: { reason, fill: [...fill], version: service.version },
      }),
    );
    setBackBusy(false);
    if (!res.ok) return setBackError(errorText(res.error));
    const saved = ContractorServiceSaved.safeParse(res.data);
    if (saved.success) applied(saved.data);
    else refresh();
    setBack(closeSlot);
    toast(t('svc.rollback.done'), { icon: 'history' });
  };

  const archive = async (list: readonly { id: string }[]) => {
    const res = await callApi(() =>
      api.api.contractors.archive.$post({ json: { ids: list.map((c) => c.id) } }),
    );
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    if (!ArchiveContractorsResult.safeParse(res.data).success) {
      return toast(t('err.unknown'), { bad: true });
    }
    // Остаток денег контрагента при архивировании предложат задачи денег (2.20, 2.21).
    toast(t('svc.archive.done'), { icon: 'archive' });
  };

  const unarchive = async (contractorId: string) => {
    const res = await callApi(() =>
      api.api.contractors[':id'].unarchive.$post({ param: { id: contractorId }, json: {} }),
    );
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const card = ContractorUnarchived.safeParse(res.data);
    if (!card.success) return toast(t('err.unknown'), { bad: true });
    client.setQueryData(serviceQuery(contractorId).queryKey, card.data.service);
    toast(
      card.data.kind === 'oneoff'
        ? t('svc.unarchive.done')
        : t('svc.unarchive.done_open', { n: card.data.effect.open }),
      { icon: 'refresh' },
    );
    options.onUnarchived?.(card.data);
  };

  const actions = (contractor: ServiceContractor, service: ContractorService) => {
    const run: Record<ServiceMenuAction, (s: ContractorService) => void> = {
      toRegular: () => void open('toRegular', contractor),
      cancelPause: setAskCancel,
      changeResume: () => void open('resume', contractor),
      pause: () => void open('pause', contractor),
      resume: () => void open('resume', contractor),
      rollback: (s) => {
        // Откат — по свежему обслуживанию: пропущенные месяцы отмечены «досоздать» все сразу.
        void load(() => fresh(s.id)).then((next) => {
          if (!next) return;
          setFill(new Set(next.skipped));
          setBackError(undefined);
          setBack(openSlot({ contractor, service: next }));
        });
      },
      archive: () => setAskArchive([{ id: contractor.id, name: contractor.name }]),
      unarchive: () => void unarchive(contractor.id),
    };
    return serviceMenuEntries({ service, rights, t, run });
  };

  const dialogProps = (d: DialogSlot<Dialog>) => ({
    key: `svc-${d.data.kind}-${d.n}`,
    name: d.data.contractor.name,
    service: d.data.service,
    open: d.open,
    onClose: () => setDialog(closeSlot),
    onDone: applied,
  });

  const skipped = back?.data.service.skipped ?? [];
  const dialogs = (
    <>
      {dialog?.data.kind === 'pause' ? <PauseServiceDialog {...dialogProps(dialog)} /> : null}
      {dialog?.data.kind === 'resume' ? (
        <ResumeServiceDialog
          {...dialogProps(dialog)}
          tariff={feeVisible ? dialog.data.contractor.tariff : null}
        />
      ) : null}
      {dialog?.data.kind === 'toRegular' ? (
        <ToRegularDialog
          {...dialogProps(dialog)}
          regimeCode={dialog.data.contractor.regimeCode}
          regimes={dialog.data.regimes}
          feeVisible={feeVisible}
          onDone={(saved) => {
            applied(saved);
            options.onRegular?.(saved.service.id);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={askCancel !== null}
        onClose={() => setAskCancel(null)}
        title={t('svc.cancel.title')}
        text={
          askCancel?.plannedPause?.resume
            ? t('svc.cancel.text_resume', {
                month: monthLabelGen(askCancel.plannedPause.from),
                resume: monthLabelGen(askCancel.plannedPause.resume),
              })
            : t('svc.cancel.text', {
                month: askCancel?.plannedPause ? monthLabelGen(askCancel.plannedPause.from) : '',
              })
        }
        ok={t('svc.cancel.ok')}
        onConfirm={() => askCancel && void cancelPause(askCancel)}
      />
      <ConfirmDialog
        open={askArchive !== null}
        onClose={() => setAskArchive(null)}
        title={
          askArchive && askArchive.length > 1
            ? t('svc.archive.title_many', { n: askArchive.length })
            : t('svc.archive.title_one', { name: askArchive?.[0]?.name ?? '' })
        }
        text={t('svc.archive.text')}
        ok={t('svc.archive.ok')}
        danger
        onConfirm={() => askArchive && void archive(askArchive)}
      />
      {back ? (
        <RollbackDialog
          key={`svc-back-${back.n}`}
          open={back.open}
          onClose={() => setBack(closeSlot)}
          title={rollbackTitle(t, 'service', 'paused', 'active')}
          sub={back.data.contractor.name}
          consequences={t('svc.rollback.note')}
          extra={
            skipped.length ? (
              <div className="flex flex-col gap-1">
                <div className="text-[12px] font-semibold text-muted">
                  {t('svc.rollback.skipped')}
                </div>
                {skipped.map((m) => (
                  <CheckRow
                    key={m}
                    kind="check"
                    data-service-fill={m}
                    checked={fill.has(m)}
                    onChange={(on) =>
                      setFill((f) => {
                        const next = new Set(f);
                        if (on) next.add(m);
                        else next.delete(m);
                        return next;
                      })
                    }
                    label={t('svc.rollback.month', { month: monthLabel(m) })}
                  />
                ))}
              </div>
            ) : null
          }
          busy={backBusy}
          error={backError}
          labels={rollbackLabels(t)}
          onConfirm={(reason) => void rollback(reason)}
        />
      ) : null}
    </>
  );

  return {
    actions,
    archive: (list) => setAskArchive(list),
    unarchive: (id) => void unarchive(id),
    dialogs,
  };
}

/**
 * Блок «Статус обслуживания» карточки контрагента (прототип contractor-card: метка статуса, «Периоды
 * обслуживания: 01.2026–10.2026, 05.2027–…»; ui/status-scale.js `svcPlanNote`): запланированная
 * приостановка — жёлтой меткой и кнопкой «Отменить приостановку» (с правом «Откат статусов»),
 * запланированное возобновление — синей. Карточку (2.11) собирает её задача.
 */
export function ServiceStatusBlock({
  service,
  onCancelPause,
}: {
  service: ContractorService;
  /** «Отменить приостановку» у отметки; null — кнопки нет (нет прав). */
  onCancelPause: (() => void) | null;
}) {
  const t = useT();
  const pill = statusPillView(t, 'service', service.status);
  const plan = servicePlanNote(t, service);
  return (
    <div data-service-block="" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={pill.label} tone={pill.tone} icon={pill.icon} />
        {service.kind === 'regular' ? (
          <span className="text-[12.5px] text-muted">
            {service.periodsText
              ? t('svc.periods', { text: service.periodsText })
              : t('svc.periods.none')}
          </span>
        ) : null}
      </div>
      {plan ? (
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            size="sm"
            tone={plan.kind === 'pause' ? 'warn' : 'info'}
            icon={plan.kind === 'pause' ? 'pause' : 'play'}
          >
            {plan.text}
          </Pill>
          {plan.kind === 'pause' && onCancelPause ? (
            <button
              type="button"
              data-service-unpause=""
              className={buttonClass('default', 'sm')}
              onClick={onCancelPause}
            >
              {t('svc.menu.cancel_pause')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
