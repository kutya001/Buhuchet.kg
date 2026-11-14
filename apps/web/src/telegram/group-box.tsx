'use client';

import { bishkekDate, bishkekTime, formatDateRu, GROUP_LINK_MINUTES } from '@buhuchet/domain';
import { TelegramGroupLinkResponse, TelegramGroupResponse } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CheckRow,
  ConfirmDialog,
  Hint,
  Icon,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  useToast,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';

export const telegramGroupQuery = queryOptions({
  queryKey: ['telegram', 'group'],
  queryFn: async () => {
    const res = await api.api.telegram.group.$get();
    if (!res.ok) throw await apiFailure(res);
    return TelegramGroupResponse.parse(await res.json());
  },
});

/** Пока открыто окно со ссылкой — как часто проверять, подключил ли владелец группу, мс. */
const POLL_MS = 3000;

/**
 * «Общий чат фирмы в Telegram» в «Моя организация» → «Настройки» (поток Т, задача Т8; прототип v105
 * modules/tg-group.js — `tgGrpHtml`, `tgGrpMount`, `tgGrpLinkDlg`): подключённая группа, «Сводка дня в
 * группу», «Отключить группу»; без группы — «Подключить группу» одноразовой ссылкой. Видят все
 * сотрудники, меняет только владелец (сервер проверяет сам). Блок стоит, только когда включены
 * «Напоминания в Telegram». «Показать пример» и «В макете: бота удалили» прототипа — только макет.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-12
export function TelegramGroupBox() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const query = useQuery(telegramGroupQuery);
  const [busy, setBusy] = useState(false);
  const [opened, setLink] = useState<{
    url: string;
    until: string;
    version: number | null;
  } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const data = query.data;
  const g = data?.group ?? null;
  const own = data?.canEdit === true;
  // Окно со ссылкой открыто: группа подключилась (новая версия записи) — окно закрывается само
  // (состояние сбрасывается прямо при отрисовке, как советует React, а не в эффекте).
  const connected = opened !== null && g !== null && !g.gone && g.version !== opened.version;
  if (connected) setLink(null);
  const link = connected ? null : opened;

  useEffect(() => {
    if (!link) return;
    const timer = setInterval(
      () => void client.invalidateQueries({ queryKey: telegramGroupQuery.queryKey }),
      POLL_MS,
    );
    return () => clearInterval(timer);
  }, [link, client]);

  if (!data) return null;

  const failed = (error: Parameters<typeof errorText>[0]) => {
    void client.invalidateQueries({ queryKey: telegramGroupQuery.queryKey });
    toast(errorText(error), { bad: true, icon: 'alert' });
  };
  const saved = (body: unknown) => {
    const next = TelegramGroupResponse.safeParse(body);
    if (next.success) client.setQueryData(telegramGroupQuery.queryKey, next.data);
  };

  const openLink = async () => {
    if (busy || !own) return;
    setBusy(true);
    const res = await callApi(() => api.api.telegram.group.link.$post());
    setBusy(false);
    if (!res.ok) return failed(res.error);
    const body = TelegramGroupLinkResponse.parse(res.data);
    setLink({
      url: body.url,
      until: bishkekTime(new Date(body.expiresAt)),
      version: g && !g.gone ? g.version : null,
    });
  };

  const setSummary = async (on: boolean) => {
    if (busy || !g || !own) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.telegram.group.$put({ json: { version: g.version, summary: on } }),
    );
    setBusy(false);
    if (!res.ok) return failed(res.error);
    saved(res.data);
    toast(t(on ? 'tggrp.summary_on' : 'tggrp.summary_off'), { icon: 'tg' });
  };

  const unlink = async () => {
    setConfirmOff(false);
    if (busy || !g || !own) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.telegram.group.unlink.$post({ json: { version: g.version } }),
    );
    setBusy(false);
    if (!res.ok) return failed(res.error);
    saved(res.data);
    toast(t('tggrp.off_done'), { icon: 'tg' });
  };

  const linkButton = (label: string, cta = false) => (
    <button
      type="button"
      className={buttonClass(cta ? 'cta' : 'default', 'sm')}
      disabled={!own || busy || !data.bot}
      onClick={() => void openLink()}
      data-tggrp-link=""
    >
      <Icon name="tg" size="sm" />
      {label}
    </button>
  );

  return (
    <Box title={t('tggrp.title')}>
      <div data-tggrp="" className="flex flex-col gap-2">
        <Hint>{t('tggrp.intro')}</Hint>
        {!g ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="grow text-[12.5px] text-muted">
              {t(own ? 'tggrp.none' : 'tggrp.none_owner_only')}
            </span>
            {linkButton(t('tggrp.link'))}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              {g.gone ? (
                <Pill tone="bad" icon="alert">
                  {t('tggrp.gone')}
                </Pill>
              ) : (
                <Pill tone="ok" icon="check">
                  {t('tggrp.linked')}
                </Pill>
              )}
              <b data-tggrp-title="" className="min-w-0 [overflow-wrap:anywhere]">
                {g.title}
              </b>
              <div className="grow" />
              <span className="text-[12px] text-muted">
                {t('tggrp.by', {
                  name: g.linkedByName ?? '—',
                  date: formatDateRu(bishkekDate(new Date(g.linkedAt))),
                })}
              </span>
            </div>
            {g.gone ? (
              <>
                <Note icon="info">{t('tggrp.gone_note')}</Note>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="grow" />
                  <button
                    type="button"
                    className={buttonClass('default', 'sm')}
                    disabled={!own || busy}
                    onClick={() => setConfirmOff(true)}
                  >
                    {t('tggrp.forget')}
                  </button>
                  {linkButton(t('tggrp.relink'), true)}
                </div>
              </>
            ) : (
              <>
                <CheckRow
                  checked={g.summary}
                  disabled={!own || busy}
                  onChange={(on) => void setSummary(on)}
                  label={t('tggrp.summary')}
                  data-tggrp-summary=""
                >
                  <Hint>
                    {t('tggrp.summary_hint', { time: data.time })}
                    {own ? '' : ` ${t('tggrp.owner_only')}`}
                  </Hint>
                </CheckRow>
                {own ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="grow" />
                    <button
                      type="button"
                      className={buttonClass('danger', 'sm')}
                      disabled={busy}
                      onClick={() => setConfirmOff(true)}
                      data-tggrp-off=""
                    >
                      {t('tggrp.off')}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title={t('tggrp.off_title')}
        text={g?.gone ? t('tggrp.off_text_gone') : t('tggrp.off_text', { title: g?.title ?? '' })}
        ok={t('tggrp.off_ok')}
        danger
        onConfirm={() => void unlink()}
      />
      <GroupLinkDialog
        link={link}
        replace={g && !g.gone ? g.title : null}
        onClose={() => setLink(null)}
      />
    </Box>
  );
}

/** Окно «Подключить общий чат фирмы» (прототип `tgGrpLinkDlg`): шаги, ссылка, до какого времени она действует. */
function GroupLinkDialog({
  link,
  replace,
  onClose,
}: {
  link: { url: string; until: string } | null;
  replace: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast(t('tggrp.dlg_copied'), { icon: 'copy' });
    } catch {
      // Буфер обмена недоступен: ссылку видно, её можно открыть или выделить.
    }
  };
  return (
    <Modal
      open={link !== null}
      onClose={onClose}
      kind="message"
      size="mid"
      title={t('tggrp.dlg_title')}
      sub={t('tggrp.dlg_sub')}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('default')} onClick={copy}>
            <Icon name="copy" size="sm" />
            {t('tggrp.dlg_copy')}
          </button>
          {link ? (
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass('cta')}
              data-tggrp-open=""
            >
              <Icon name="tg" size="sm" />
              {t('tggrp.dlg_open')}
            </a>
          ) : null}
        </>
      }
    >
      {link ? (
        <div data-tggrp-dialog="" className="flex flex-col gap-2.5">
          <ol className="ml-[18px] grid list-decimal gap-1">
            <li>{t('tggrp.dlg_step1')}</li>
            <li>{t('tggrp.dlg_step2')}</li>
            <li>{t('tggrp.dlg_step3')}</li>
          </ol>
          <span className={`[overflow-wrap:anywhere] ${MONO_CLASS}`} data-tggrp-url="">
            {link.url}
          </span>
          {replace ? <Note icon="info">{t('tggrp.dlg_replace', { title: replace })}</Note> : null}
          <Note icon="info">
            {t('tggrp.dlg_note', { time: link.until, minutes: GROUP_LINK_MINUTES })}
          </Note>
        </div>
      ) : null}
    </Modal>
  );
}
