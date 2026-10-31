'use client';

import type { ContractorKind } from '@buhuchet/domain';
import type { Contractor, ContractorFees, ContractorRow } from '@buhuchet/shared';
import { ConfirmDialog, useToast, type ActionEntry, type GridBulkAction } from '@buhuchet/ui';
import { useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useEnablePages } from '../contractor-page/page-box';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useFeeDialogs } from '../fees/fee-dialogs';
import { feeMenuEntries, type FeeMenuContractor } from '../fees/fee-menu';
import { useErrorText, useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { BaseChangesDialog } from './base-changes';
import { closeContractorCard, openContractorCard, useContractorCardRequest } from './card-store';
import { ContractorCardWindow, type ContractorCardProps } from './contractor-card';
import { useContractorsRefresh } from './contractor-data';
import { EditContractorDialog, type BaseChanges } from './contractor-edit';
import { NewContractorDialog } from './contractor-form';
import {
  contractorMenuEntries,
  menuContractorOf,
  rowService,
  type MenuContractor,
} from './contractor-menu';
import { ResponsibleDialog, type ResponsibleTarget } from './responsible-dialogs';
import { useServiceActions, type ServiceContractor } from './service-actions';

/** Пункты карточки, которые даёт `useContractorActions` (остальное карточка берёт сама). */
type CardActions = Pick<
  ContractorCardProps,
  'actions' | 'serviceActions' | 'onResponsible' | 'onEdit' | 'onCancelPause'
>;

/** «Сменить ответственного» одному или выбранным; `done` — снять галочки списка. */
interface RespTargets {
  targets: ResponsibleTarget[];
  done?: () => void;
}

const serviceOf = (c: Contractor): ServiceContractor => ({
  id: c.id,
  name: c.name,
  regimeCode: c.regime?.code ?? null,
  tariff: c.tariff ? { amount: c.tariff.amount, period: c.tariff.period } : null,
});

/** Плата за обслуживание карточки для пунктов меню: по вкладке «Обслуживание» (долг, начисления). */
const feeOfCard = (c: Contractor, f: ContractorFees | undefined): FeeMenuContractor | null =>
  f
    ? {
        archived: c.serviceStatus === 'archived',
        oneoff: c.kind === 'oneoff',
        feeDebt: f.debt,
        charged: f.months.some((m) => m.charge > 0),
      }
    : null;

/**
 * Действия с контрагентом (прототип modules/contractors.js — cpActions, respDlg, archiveDlg, массовые
 * действия списка; modules/contractor-card.js — кнопка «Действия» карточки): пункты меню «…» строки,
 * массовые «Назначить ответственного», «Включить страницу» и «В архив», окно «Новый контрагент»,
 * пункты карточки и все их окна (`dialogs` — поставить в разметку). Карточка открывается через
 * `openContractorCard` — её рисует `ContractorCardHost` оболочки. Права — как в прототипе; сервер
 * проверяет их ещё раз.
 */
export function useContractorActions(): {
  actions: (r: ContractorRow) => ActionEntry[];
  bulk: GridBulkAction<ContractorRow>[] | undefined;
  newContractor: (kind?: ContractorKind) => void;
  card: CardActions;
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const { access } = useShell();
  const rights = {
    createCp: access.can('createCp'),
    assign: access.can('assign'),
    cpArchive: access.can('cpArchive'),
  };
  const people = rights.assign || rights.createCp;
  const pagesOn = access.feature('cppage') && access.can('cpPage');
  const service = useServiceActions({ onRegular: (id) => openContractorCard({ id }, 'pick') });
  const fee = useFeeDialogs();
  const feeRights = {
    fee: access.feature('fee') && access.can('fee'),
    tariff: access.can('tariff'),
  };
  const pages = useEnablePages();
  const [edit, setEdit] = useState<DialogSlot<string> | null>(null);
  const [bases, setBases] = useState<DialogSlot<BaseChanges> | null>(null);
  const [resp, setResp] = useState<DialogSlot<RespTargets> | null>(null);
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(null);
  const [create, setCreate] = useState<DialogSlot<ContractorKind> | null>(null);

  const removeNow = async (c: { id: string; name: string }) => {
    const res = await callApi(() => api.api.contractors[':id'].$delete({ param: { id: c.id } }));
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    closeContractorCard();
    toast(t('cp.delete.done'), { icon: 'trash' });
  };

  const menu = (
    c: MenuContractor & { name: string; responsibleId: string | null },
    serviceEntries: readonly ActionEntry[],
    card: boolean,
    feeOf: FeeMenuContractor | null,
  ) =>
    contractorMenuEntries({
      c,
      rights,
      t,
      card,
      service: serviceEntries,
      fee: feeOf
        ? feeMenuEntries({
            c: feeOf,
            rights: feeRights,
            t,
            run: { accept: () => fee.accept(c.id), remind: () => fee.remind(c.id) },
          })
        : [],
      run: {
        open: () => openContractorCard({ id: c.id }),
        edit: () => setEdit(openSlot(c.id)),
        responsible: () =>
          setResp(
            openSlot({ targets: [{ id: c.id, name: c.name, responsibleId: c.responsibleId }] }),
          ),
        pick: () => openContractorCard({ id: c.id }, 'pick'),
        remove: () => setRemove({ id: c.id, name: c.name }),
      },
    });

  const actions = (r: ContractorRow) => {
    const entries = menu(
      { ...menuContractorOf(r), name: r.name, responsibleId: r.responsible?.id ?? null },
      service.actions(
        { id: r.id, name: r.name, regimeCode: r.regimeCode, tariff: r.tariff },
        rowService(r),
      ),
      false,
      {
        archived: r.serviceStatus === 'archived',
        oneoff: r.kind === 'oneoff',
        feeDebt: r.feeDebt,
        charged: r.feeCharged ?? false,
      },
    );
    // «Открыть карточку» строки — со строкой: карточка сразу показывает название и ИНН.
    return entries.map((e) =>
      !('separator' in e) && e.id === 'open' ? { ...e, run: () => openContractorCard(r) } : e,
    );
  };

  const card: CardActions = {
    actions: (c, s, f) =>
      menu(
        {
          id: c.id,
          name: c.name,
          responsibleId: c.responsible?.id ?? null,
          archived: c.serviceStatus === 'archived',
          oneoff: c.kind === 'oneoff',
          hasReports: c.hasReports,
        },
        s ? service.actions(serviceOf(c), s) : [],
        true,
        feeOfCard(c, f),
      ),
    serviceActions: (c, s) => service.actions(serviceOf(c), s),
    onResponsible: people
      ? (c) =>
          setResp(
            openSlot({
              targets: [{ id: c.id, name: c.name, responsibleId: c.responsible?.id ?? null }],
            }),
          )
      : null,
    onEdit: rights.createCp ? (c) => setEdit(openSlot(c.id)) : null,
    onCancelPause: access.can('rollback')
      ? (c, s) => {
          const entry = service
            .actions(serviceOf(c), s)
            .find((e) => !('separator' in e) && e.id === 'cancelPause');
          if (entry && !('separator' in entry)) entry.run?.();
        }
      : null,
  };

  const bulk: GridBulkAction<ContractorRow>[] = [
    ...(people
      ? [
          {
            id: 'responsible',
            label: t('cp.bulk.responsible'),
            icon: 'user',
            run: (rows, done) =>
              setResp(
                openSlot<RespTargets>({
                  targets: rows.map((r) => ({
                    id: r.id,
                    name: r.name,
                    responsibleId: r.responsible?.id ?? null,
                  })),
                  done,
                }),
              ),
          } satisfies GridBulkAction<ContractorRow>,
        ]
      : []),
    ...(pagesOn
      ? [
          {
            id: 'page',
            label: t('cp.bulk.page'),
            icon: 'link',
            run: (rows, done) => {
              // Включена ли уже страница, список не знает: такие пропустит сервер (и скажет сколько).
              pages.open(
                rows.map((r) => ({
                  id: r.id,
                  pageOn: false,
                  archived: r.serviceStatus === 'archived',
                })),
              );
              done();
            },
          } satisfies GridBulkAction<ContractorRow>,
        ]
      : []),
    ...(rights.cpArchive
      ? [
          {
            id: 'archive',
            label: t('cp.bulk.archive'),
            icon: 'archive',
            danger: true,
            run: (rows, done) =>
              service.archive(
                rows.map((r) => ({ id: r.id, name: r.name })),
                done,
              ),
          } satisfies GridBulkAction<ContractorRow>,
        ]
      : []),
  ];

  const dialogs = (
    <>
      {service.dialogs}
      {fee.dialogs}
      {pages.dialog}
      {edit ? (
        <EditContractorDialog
          key={`edit-${edit.n}`}
          contractorId={edit.data}
          open={edit.open}
          onClose={() => setEdit(closeSlot)}
          onBases={(diff) => setBases(openSlot(diff))}
        />
      ) : null}
      {bases ? (
        <BaseChangesDialog
          key={`bases-${bases.n}`}
          changes={bases.data}
          open={bases.open}
          onClose={() => setBases(closeSlot)}
        />
      ) : null}
      {resp ? (
        <ResponsibleDialog
          key={`resp-${resp.n}`}
          targets={resp.data.targets}
          open={resp.open}
          onClose={() => setResp(closeSlot)}
          onDone={resp.data.done}
        />
      ) : null}
      <ConfirmDialog
        open={remove !== null}
        onClose={() => setRemove(null)}
        title={t('cp.delete.title', { name: remove?.name ?? '' })}
        text={t('cp.delete.text')}
        ok={t('cp.delete.ok')}
        danger
        onConfirm={() => remove && void removeNow(remove)}
      />
      {create ? (
        <NewContractorDialog
          key={`new-${create.n}`}
          open={create.open}
          kind={create.data}
          onClose={() => setCreate(closeSlot)}
          onCreated={(c) => openContractorCard({ id: c.id })}
          onUnarchived={(c) => openContractorCard({ id: c.id })}
        />
      ) : null}
    </>
  );

  return {
    actions,
    bulk: bulk.length ? bulk : undefined,
    newContractor: (kind: ContractorKind = 'regular') => setCreate(openSlot(kind)),
    card,
    dialogs,
  };
}

/**
 * Карточка контрагента для всего сайта (прототип `openCp`): одна в оболочке, открывается
 * `openContractorCard` из списка, «Показателей контрагентов», карточек отчёта и задачи. Без права
 * «Просматривать контрагентов» её нет — и ссылки на неё не показываются.
 */
export function ContractorCardHost() {
  const { access } = useShell();
  if (!access.can('cpView')) return null;
  return <CardHost />;
}

function CardHost() {
  const request = useContractorCardRequest();
  const cps = useContractorActions();
  return (
    <>
      {request ? (
        <ContractorCardWindow
          key={`cp-card-${request.n}`}
          id={request.id}
          initial={request.row}
          tab={request.tab}
          open={request.open}
          onClose={closeContractorCard}
          {...cps.card}
        />
      ) : null}
      {cps.dialogs}
    </>
  );
}
