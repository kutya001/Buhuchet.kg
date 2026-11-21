'use client';

import type { AdminOrganization, AdminUser } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import { useCallback, useState, type ReactNode } from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useAccountActions } from './account-actions';
import { AccountCard } from './account-card';
import { useLeadActions } from './lead-actions';
import { useOrgActions } from './org-actions';
import { OrgCard } from './org-card';
import type { OrgCardTab } from './org-card-model';

/**
 * Карточки Админки — пользователя и организации — и их действия (прототип v83,
 * admin/admin-cards.js): карточки открывают друг друга — организация из карточки пользователя,
 * пользователь из «Сотрудников» и владельца организации, заявка из «Основного» организации. Один
 * набор на экран: «Учётные записи» и «Организации» берут отсюда пункты меню строк и ставят `cards` в
 * разметку. Открытая позже карточка лежит поверх; вторая карточка того же вида заменяет первую
 * (прототип: `MODALS.filter(x => x.o.porg).forEach(x => x.close())`).
 */
export function useAdminCards(): {
  accountActions: (u: AdminUser) => ActionEntry[];
  orgActions: (o: AdminOrganization) => ActionEntry[];
  openAccount: (id: string, initial?: AdminUser | null) => void;
  /** `tab` — вкладка, на которой открыть (Админка → «Файлы»: «Файлы» организации). */
  openOrg: (id: string, initial?: AdminOrganization | null, tab?: OrgCardTab) => void;
  cards: ReactNode;
} {
  const [account, setAccount] = useState<DialogSlot<{
    id: string;
    initial: AdminUser | null;
  }> | null>(null);
  const [org, setOrg] = useState<DialogSlot<{
    id: string;
    initial: AdminOrganization | null;
    tab?: OrgCardTab;
  }> | null>(null);
  const openAccount = useCallback(
    (id: string, initial: AdminUser | null = null) => setAccount(openSlot({ id, initial })),
    [],
  );
  const openOrg = useCallback(
    (id: string, initial: AdminOrganization | null = null, tab?: OrgCardTab) =>
      setOrg(openSlot({ id, initial, ...(tab ? { tab } : {}) })),
    [],
  );
  const accounts = useAccountActions({ open: (u) => openAccount(u.id, u) });
  const orgs = useOrgActions({ open: (o) => openOrg(o.id, o) });
  const leads = useLeadActions();

  const cards = (
    <>
      {org ? (
        <OrgCard
          key={`org-card-${org.n}`}
          id={org.data.id}
          initial={org.data.initial}
          {...(org.data.tab ? { tab: org.data.tab } : {})}
          open={org.open}
          onClose={() => setOrg(closeSlot)}
          actions={orgs.cardActions}
          onUser={openAccount}
          onLead={leads.openCard}
          onResetOwner={(owner) =>
            accounts.resetPassword({
              id: owner.userId,
              fullName: owner.fullName,
              login: owner.login,
            })
          }
        />
      ) : null}
      {account ? (
        <AccountCard
          key={`account-card-${account.n}`}
          id={account.data.id}
          initial={account.data.initial}
          open={account.open}
          onClose={() => setAccount(closeSlot)}
          actions={accounts.cardActions}
          onOrg={(orgId) => openOrg(orgId)}
        />
      ) : null}
      {accounts.dialogs}
      {orgs.dialogs}
      {leads.dialogs}
    </>
  );
  return {
    accountActions: accounts.actions,
    orgActions: orgs.actions,
    openAccount,
    openOrg,
    cards,
  };
}
