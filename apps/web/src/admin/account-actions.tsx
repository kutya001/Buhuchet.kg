'use client';

import { AdminTemporaryPasswordResponse, type AdminUser } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  ConfirmDialog,
  Hint,
  Icon,
  Modal,
  PasswordText,
  useToast,
  type ActionEntry,
  type ActionItem,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { usePasswordEye } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import { accountMenu } from './accounts-menu';

/** Ключ запроса карточки пользователя: после действия карточка перечитывается. */
export const ACCOUNT_CARD_KEY = ['admin', 'account-card'] as const;

/**
 * Действия над учётной записью в Админке (прототип admin/accounts-orgs.js, accActions и
 * accResetPass): «Сбросить пароль» (окно «Пароль сброшен» с временным паролем), «Заблокировать» после
 * вопроса и «Разблокировать» сразу. Одни и те же пункты — в меню строки списка и кнопками в шапке
 * карточки пользователя; `open` добавляет в меню строки «Открыть карточку». `dialogs` ставится в
 * разметку экрана.
 */
export function useAccountActions(options: { open?: (u: AdminUser) => void } = {}): {
  actions: (u: AdminUser) => ActionEntry[];
  /** Те же пункты без «Открыть карточку» и черты — кнопки шапки карточки. */
  cardActions: (u: AdminUser) => ActionItem[];
  dialogs: ReactNode;
} {
  const t = useT();
  const eye = usePasswordEye();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const { userId } = useShell();
  const [askBlock, setAskBlock] = useState<AdminUser | null>(null);
  const [reset, setReset] = useState<{
    account: AdminUser;
    password: string;
    telegram: boolean;
    owners: AdminTemporaryPasswordResponse['ownersNotice'];
  } | null>(null);
  // Учётные записи, по которым запрос ещё идёт: повторное нажатие не шлёт второй запрос.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['list', 'accounts.list'] });
    void client.invalidateQueries({ queryKey: ACCOUNT_CARD_KEY });
  }, [client]);

  const once = async <T,>(id: string, fetch: () => Promise<T>): Promise<T | null> => {
    if (pending.has(id)) return null;
    setPending((p) => new Set(p).add(id));
    try {
      return await fetch();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(id);
        return next;
      });
    }
  };

  const setBlocked = async (u: AdminUser, blocked: boolean) => {
    const res = await once(u.id, () =>
      callApi(() =>
        api.api.admin.users[':id'][blocked ? 'block' : 'unblock'].$post({
          param: { id: u.id },
          json: { version: u.version },
        }),
      ),
    );
    if (!res) return;
    refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t(blocked ? 'accounts.block.done' : 'accounts.unblock.done'), {
      icon: blocked ? 'lock' : 'key',
    });
  };

  const resetPassword = async (u: AdminUser) => {
    const res = await once(u.id, () =>
      callApi(() => api.api.admin.users[':id']['password-reset'].$post({ param: { id: u.id } })),
    );
    if (!res) return;
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const body = AdminTemporaryPasswordResponse.safeParse(res.data);
    if (!body.success) return toast(t('err.unknown'), { bad: true });
    refresh();
    setReset({
      account: u,
      password: body.data.temporaryPassword,
      telegram: body.data.telegramNotified,
      owners: body.data.ownersNotice,
    });
  };

  const run = {
    resetPassword: (u: AdminUser) => void resetPassword(u),
    block: setAskBlock,
    unblock: (u: AdminUser) => void setBlocked(u, false),
  };
  const me = userId ?? '';
  const actions = accountMenu({ userId: me, t, run: { ...run, open: options.open } });
  const menu = accountMenu({ userId: me, t, run });
  const cardActions = (u: AdminUser) =>
    menu(u).filter((a): a is ActionItem => !('separator' in a));

  const dialogs = (
    <>
      <ConfirmDialog
        open={askBlock !== null}
        onClose={() => setAskBlock(null)}
        title={t('accounts.block.title', { login: askBlock?.login ?? '' })}
        text={t('accounts.block.text')}
        ok={t('accounts.action.block')}
        danger
        onConfirm={() => askBlock && void setBlocked(askBlock, true)}
      />
      <Modal
        open={reset !== null}
        onClose={() => setReset(null)}
        kind="message"
        title={t('staff.reset.title')}
        sub={reset ? `${reset.account.fullName} · ${reset.account.login}` : undefined}
        footer={
          <button type="button" className={buttonClass('cta')} onClick={() => setReset(null)}>
            {t('btn.done')}
          </button>
        }
      >
        <p className="m-0">
          {t('staff.reset.password')}{' '}
          <PasswordText value={reset?.password ?? ''} labels={eye} id="rp-v" />
        </p>
        <p className="m-0 text-muted">
          {t(reset?.telegram ? 'accounts.reset.sessions_tg' : 'accounts.reset.sessions')}
        </p>
        {reset?.owners ? <OwnersNotice t={t} notice={reset.owners} /> : null}
      </Modal>
    </>
  );
  return { actions, cardActions, dialogs };
}

/**
 * Сообщение владельцам организации в окне «Пароль сброшен» (прототип accResetPass): кому из них бот
 * его прислал и текст — пароль сброшен сотруднику, а не владельцу.
 */
function OwnersNotice({
  t,
  notice,
}: {
  t: Translate;
  notice: NonNullable<AdminTemporaryPasswordResponse['ownersNotice']>;
}) {
  return (
    <div data-owners-notice className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Icon name="tg" size="sm" />
        <b>{t('accounts.reset.bot')}</b>
        <span>{t('accounts.reset.owners_to', { list: notice.to.join(', ') })}</span>
      </div>
      <Box>
        <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{notice.text}</div>
      </Box>
      <Hint>{t('accounts.reset.owners_hint')}</Hint>
    </div>
  );
}
