'use client';

import type { AdminOrganization } from '@buhuchet/shared';
import { ConfirmDialog, useToast, type ActionEntry, type ActionItem } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import { orgHeadActions, orgMenu } from './orgs-menu';

/** Ключ запроса карточки организации: после действия карточка перечитывается. */
export const ORG_CARD_KEY = ['admin', 'org-card'] as const;

/** Ключ плашек над списком организаций. */
export const ORGS_SUMMARY_KEY = ['admin', 'orgs-summary'] as const;
/** Плашки и столбики вкладки «Активность» (за любой период). */
export const ORG_ACTIVITY_KEY = ['admin', 'org-activity'] as const;

/**
 * После создания, блокировки и разблокировки — перечитать списки («Организации» и «Активность»),
 * плашки и открытую карточку.
 */
export function useOrgsRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['list', 'orgs.list'] });
    // Вкладка «Активность»: статус организации в списке и «из стольких» в плашке.
    void client.invalidateQueries({ queryKey: ['list', 'orgs.act'] });
    void client.invalidateQueries({ queryKey: ORG_ACTIVITY_KEY });
    void client.invalidateQueries({ queryKey: ORGS_SUMMARY_KEY });
    void client.invalidateQueries({ queryKey: ORG_CARD_KEY });
  }, [client]);
}

/**
 * Действия над организацией в Админке (прототип admin/accounts-orgs.js, orgActions): «Заблокировать»
 * после вопроса (демо-организацию стенда не блокируют) и «Разблокировать» сразу. Одни и те же пункты —
 * в меню строки списка и кнопками в шапке карточки организации; `open` добавляет в меню строки
 * «Открыть карточку». `dialogs` ставится в разметку экрана.
 */
export function useOrgActions(options: { open?: (o: AdminOrganization) => void } = {}): {
  actions: (o: AdminOrganization) => ActionEntry[];
  /** Те же пункты без «Открыть карточку» и черты — кнопки шапки карточки. */
  cardActions: (o: AdminOrganization) => ActionItem[];
  dialogs: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useOrgsRefresh();
  const [askBlock, setAskBlock] = useState<AdminOrganization | null>(null);
  // Организации, по которым запрос ещё идёт: повторное нажатие не шлёт второй запрос.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const setActive = async (o: AdminOrganization, active: boolean) => {
    if (pending.has(o.id)) return;
    setPending((p) => new Set(p).add(o.id));
    const res = await callApi(() =>
      api.api.admin.organizations[':id'][active ? 'unblock' : 'block'].$post({
        param: { id: o.id },
        json: { version: o.version },
      }),
    );
    setPending((p) => {
      const next = new Set(p);
      next.delete(o.id);
      return next;
    });
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t(active ? 'orgs.unblock.done' : 'orgs.block.done'), {
      icon: active ? 'check' : 'lock',
    });
  };

  const run = { block: setAskBlock, unblock: (o: AdminOrganization) => void setActive(o, true) };
  const actions = orgMenu({ t, run: { ...run, open: options.open } });
  const menu = orgMenu({ t, run });
  const cardActions = (o: AdminOrganization) => orgHeadActions(menu(o));

  const dialogs = (
    <ConfirmDialog
      open={askBlock !== null}
      onClose={() => setAskBlock(null)}
      title={t('orgs.block.title', { name: askBlock?.name ?? '' })}
      text={t('orgs.block.text')}
      ok={t('orgs.action.block')}
      danger
      onConfirm={() => askBlock && void setActive(askBlock, false)}
    />
  );
  return { actions, cardActions, dialogs };
}
