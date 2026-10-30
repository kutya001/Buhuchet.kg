'use client';

import {
  formatMomentRu,
  pageCodeText,
  pageLinkText,
  pluralForm,
  whatsAppLink,
  type PageSection,
} from '@buhuchet/domain';
import { ContractorPage, ContractorPagesEnabled } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CHECKBOX_CLASS,
  ConfirmDialog,
  Field,
  Hint,
  Icon,
  inputClass,
  KeyValues,
  MONO_CLASS,
  Modal,
  Note,
  Pill,
  useToast,
  type IconName,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, callApi, type ApiResult } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { contractorPageQuery } from './page-data';

/*
 * Блок «Страница контрагента» на вкладке «Основное» карточки контрагента (задача 2.42; прототип
 * modules/cp-page.js — pgBox, pgMount, pgOffDlg, pgCodeDlg, waDlg с `page`). Карточки контрагента
 * ещё нет — блок подключит задача 2.11 (правило стыков), «Включить страницу» у выбранных в списке —
 * задача списка контрагентов (`useEnablePages`).
 */

type Action = 'enable' | 'disable' | 'code' | 'copied' | 'sent';

/** Кнопка блока; недоступная — с причиной: нажатие показывает её (прототип `data-why`). */
function PageButton({
  icon,
  label,
  why,
  cta = false,
  onClick,
  data,
}: {
  icon: IconName;
  label: string;
  why: string | null;
  cta?: boolean;
  onClick: () => void;
  data: string;
}) {
  const toast = useToast();
  return (
    <button
      type="button"
      data-cp-page-action={data}
      className={`${buttonClass(cta ? 'cta' : 'default', 'sm')} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:shadow-none`}
      aria-disabled={why ? true : undefined}
      title={why ?? label}
      onClick={() => (why ? toast(why, { icon: 'lock', bad: true }) : onClick())}
    >
      <Icon name={icon} size="sm" />
      <span>{label}</span>
    </button>
  );
}

export function ContractorPageBox({ contractorId }: { contractorId: string }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const query = useQuery(contractorPageQuery(contractorId));
  const [confirm, setConfirm] = useState<'disable' | 'code' | null>(null);
  const [whatsApp, setWhatsApp] = useState(false);
  const page = query.data;
  if (!page) return null;

  const why = (code: ContractorPage['manage']) => (code ? t(`err.${code}`) : null);
  const manage = why(page.manage);
  const send = why(page.send);
  const put = (data: unknown) =>
    client.setQueryData(contractorPageQuery(contractorId).queryKey, ContractorPage.parse(data));

  const run = async (action: Action): Promise<ContractorPage | null> => {
    const param = { param: { id: contractorId } };
    const path = api.api.contractors[':id'].page;
    const res = await callApi(() =>
      action === 'enable'
        ? path.enable.$post(param)
        : action === 'disable'
          ? path.disable.$post(param)
          : action === 'code'
            ? path.code.$post(param)
            : action === 'copied'
              ? path.copied.$post(param)
              : path.sent.$post(param),
    );
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      void client.invalidateQueries({ queryKey: contractorPageQuery(contractorId).queryKey });
      return null;
    }
    put(res.data);
    return ContractorPage.parse(res.data);
  };

  const enable = async () => {
    const was = page.enabled;
    const next = await run('enable');
    if (!next) return;
    toast(
      was ? t('cppage.toast.already') : t('cppage.toast.on', { code: pageCodeText(next.code!) }),
      { icon: was ? 'info' : 'link' },
    );
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(page.link!);
    } catch {
      // Буфер обмена недоступен (нет разрешения): ссылку видно в блоке, её можно выделить.
      return;
    }
    toast(t('cppage.toast.copied'), { icon: 'copy' });
    void run('copied');
  };
  const toggleSection = async (section: PageSection, shown: boolean) => {
    const hidden = shown
      ? page.hiddenSections.filter((s) => s !== section)
      : [...page.hiddenSections, section];
    const res = await callApi(() =>
      api.api.contractors[':id'].page.sections.$put({
        param: { id: contractorId },
        json: { hiddenSections: hidden, version: page.version! },
      }),
    );
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      void client.invalidateQueries({ queryKey: contractorPageQuery(contractorId).queryKey });
      return;
    }
    put(res.data);
    toast(t(shown ? 'cppage.toast.shown' : 'cppage.toast.hidden'));
  };

  const items: KeyValueItem[] = page.enabled
    ? [
        {
          id: 'link',
          label: t('cppage.link'),
          wide: true,
          value: (
            <a
              href={page.link!}
              target="_blank"
              rel="noopener noreferrer"
              data-cp-page-link=""
              title={t('cppage.link_title')}
              className={`${MONO_CLASS} text-link underline-offset-2 hover:underline`}
            >
              {pageLinkText(page.link!)}
            </a>
          ),
        },
        {
          id: 'code',
          label: t('cppage.code'),
          value: (
            <b data-cp-page-code="" className={`${MONO_CLASS} text-[16px] tracking-[.06em]`}>
              {pageCodeText(page.code!)}
            </b>
          ),
        },
        {
          id: 'last',
          label: t('cppage.last'),
          value: page.lastOpenAt ? (
            <>
              {formatMomentRu(new Date(page.lastOpenAt))}
              {page.lastDevice ? (
                <span className="text-[11.5px] text-faint"> · {page.lastDevice}</span>
              ) : null}
            </>
          ) : (
            <span className="text-faint">{t('cppage.last_none')}</span>
          ),
        },
      ]
    : [];

  return (
    <Box
      title={t('cppage.title')}
      actions={
        page.enabled ? (
          <Pill tone="ok" icon="check">
            {t('cppage.state.on')}
          </Pill>
        ) : (
          <Pill icon="ban">{t('cppage.state.off')}</Pill>
        )
      }
    >
      <div data-cp-page="" className="contents">
        {page.enabled ? (
          <>
            <KeyValues items={items} />
            {page.sections.length > 0 ? (
              <SectionsRow
                t={t}
                page={page}
                disabled={manage !== null}
                onToggle={(s, shown) => void toggleSection(s, shown)}
              />
            ) : null}
          </>
        ) : (
          <Hint>{t(page.archived ? 'cppage.archived_hint' : 'cppage.off_hint')}</Hint>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {page.enabled ? (
            <>
              <PageButton
                data="copy"
                icon="copy"
                label={t('cppage.btn.copy')}
                why={send}
                onClick={() => void copy()}
              />
              <PageButton
                data="wa"
                icon="chat"
                label={t('cppage.btn.wa')}
                why={send}
                onClick={() => setWhatsApp(true)}
              />
              <div className="grow" />
              <PageButton
                data="code"
                icon="refresh"
                label={t('cppage.btn.code')}
                why={manage}
                onClick={() => setConfirm('code')}
              />
              <PageButton
                data="off"
                icon="ban"
                label={t('cppage.btn.off')}
                why={manage}
                onClick={() => setConfirm('disable')}
              />
            </>
          ) : page.archived ? null : (
            <>
              <div className="grow" />
              <PageButton
                data="on"
                icon="link"
                label={t('cppage.btn.on')}
                why={manage}
                cta
                onClick={() => void enable()}
              />
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm === 'disable'}
        onClose={() => setConfirm(null)}
        title={t('cppage.off.title')}
        text={t('cppage.off.text')}
        ok={t('cppage.btn.off')}
        danger
        onConfirm={() =>
          void run('disable').then((next) => {
            if (next) toast(t('cppage.toast.off'), { icon: 'ban' });
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'code'}
        onClose={() => setConfirm(null)}
        title={t('cppage.code.title')}
        text={t('cppage.code.text')}
        ok={t('cppage.btn.code')}
        onConfirm={() =>
          void run('code').then((next) => {
            if (next)
              toast(t('cppage.toast.code', { code: pageCodeText(next.code!) }), { icon: 'link' });
          })
        }
      />
      {page.whatsApp ? (
        <PageWhatsAppDialog
          open={whatsApp}
          onClose={() => setWhatsApp(false)}
          message={page.whatsApp}
          onSent={() =>
            void run('sent').then((next) => {
              if (next) toast(t('cppage.toast.logged'), { icon: 'chat' });
            })
          }
        />
      ) : null}
    </Box>
  );
}

/** «Разделы страницы»: галочки разделов организации у этого контрагента (прототип `pg-secs`). */
function SectionsRow({
  t,
  page,
  disabled,
  onToggle,
}: {
  t: Translate;
  page: ContractorPage;
  disabled: boolean;
  onToggle: (section: PageSection, shown: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-faint">{t('cppage.sections')}</span>
      <span className="flex flex-wrap gap-x-4 gap-y-1.5">
        {page.sections.map((s) => (
          <label key={s} className="inline-flex items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              data-cp-page-section={s}
              checked={!page.hiddenSections.includes(s)}
              disabled={disabled}
              onChange={(e) => onToggle(s, e.target.checked)}
            />
            {t(`org.page.section.${s}`)}
          </label>
        ))}
      </span>
      <Hint>{t('cppage.sections_hint')}</Hint>
    </div>
  );
}

/**
 * «Отправить ссылку в WhatsApp» (прототип waDlg, `page`): текст по шаблону waPage справочника
 * платформы со ссылкой и кодом, его можно поправить; «Открыть WhatsApp» открывает сообщение на номер
 * контрагента, нажатие пишется в историю.
 */
function PageWhatsAppDialog({
  open,
  onClose,
  message,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  message: NonNullable<ContractorPage['whatsApp']>;
  onSent: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(message.text);
  const [shown, setShown] = useState(open);
  // Окно открылось снова — текст по шаблону заново.
  if (shown !== open) {
    setShown(open);
    if (open) setText(message.text);
  }
  const noPhone = message.phone.replace(/\D/g, '') === '';
  const footer: ReactNode = (
    <>
      <button type="button" className={buttonClass('ghost')} onClick={onClose}>
        {t('btn.cancel')}
      </button>
      <a
        className={`${buttonClass('cta')} ${noPhone ? 'pointer-events-none opacity-50' : ''}`}
        href={noPhone ? undefined : whatsAppLink(message.phone, text)}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={noPhone ? true : undefined}
        data-cp-page-wa-go=""
        onClick={() => {
          if (noPhone) return;
          onSent();
          onClose();
        }}
      >
        <Icon name="chat" size="sm" />
        {t('cppage.wa.go')}
      </a>
    </>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('cppage.wa.title')}
      sub={`${message.contractor} · ${message.phoneText}`}
      kind="form"
      size="mid"
      footer={footer}
    >
      <div className="flex flex-col gap-3">
        {noPhone ? <Note tone="bad">{t('cppage.wa.no_phone')}</Note> : null}
        <Field id="cp-page-wa-text" label={t('cppage.wa.text')} hint={t('cppage.wa.hint')} full>
          {(control) => (
            <textarea
              {...control}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={`${inputClass({ multiline: true })} min-h-[150px]`}
            />
          )}
        </Field>
        <Note>{t('cppage.wa.note', { phone: message.phoneText })}</Note>
      </div>
    </Modal>
  );
}

/** Контрагент, выбранный в списке: включена ли у него страница и в архиве ли он. */
export interface PageTarget {
  id: string;
  pageOn: boolean;
  archived: boolean;
}

/**
 * «Включить страницу» у выбранных в списке контрагентов (ТЗ «Массово…»; прототип pgEnable): уже
 * включённые и архивные пропускаются сразу; у нескольких — подтверждение «Включить страницу у N…» с
 * «Пропущено: …», у каждого свой код. Сервер ещё раз проверяет область и архив и отвечает, сколько
 * включено. Подключит задача списка контрагентов: `const { open, dialog } = useEnablePages(); …
 * open(выбранные)`.
 */
export function useEnablePages(onDone?: () => void) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [ask, setAsk] = useState<{ ids: string[]; skip: number } | null>(null);
  const cps = (n: number) => t(`cppage.cps.${pluralForm(n)}`);

  const send = async (ids: string[], skip: number) => {
    const res: ApiResult<unknown> = await callApi(() =>
      api.api['contractor-pages'].enable.$post({ json: { ids } }),
    );
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const result = ContractorPagesEnabled.parse(res.data);
    void client.invalidateQueries({ queryKey: ['contractor-page'] });
    onDone?.();
    const skipped = skip + result.skipped;
    if (result.enabled === 0) {
      return toast(t(ids.length + skip > 1 ? 'cppage.toast.bulk_none' : 'cppage.toast.already'), {
        icon: 'info',
      });
    }
    if (ids.length === 1 && skip === 0) {
      const page = await client.fetchQuery(contractorPageQuery(ids[0]!));
      return toast(t('cppage.toast.on', { code: pageCodeText(page?.code ?? '') }), {
        icon: 'link',
      });
    }
    const done = t('cppage.toast.bulk', { n: result.enabled, cps: cps(result.enabled) });
    toast(skipped ? `${done}. ${t('cppage.toast.bulk_skip', { n: skipped })}` : done, {
      icon: 'link',
    });
  };

  const open = (targets: readonly PageTarget[]) => {
    const ids = targets.filter((c) => !c.archived && !c.pageOn).map((c) => c.id);
    const skip = targets.length - ids.length;
    if (ids.length === 0) {
      return toast(t(targets.length > 1 ? 'cppage.toast.bulk_none' : 'cppage.toast.already'), {
        icon: 'info',
      });
    }
    if (ids.length > 1) return setAsk({ ids, skip });
    void send(ids, skip);
  };
  const dialog = (
    <ConfirmDialog
      open={ask !== null}
      onClose={() => setAsk(null)}
      title={ask ? t('cppage.bulk.title', { n: ask.ids.length, cps: cps(ask.ids.length) }) : ''}
      text={
        ask?.skip
          ? `${t('cppage.bulk.text')} ${t('cppage.bulk.skip', { n: ask.skip })}`
          : t('cppage.bulk.text')
      }
      ok={t('cppage.btn.on')}
      onConfirm={() => {
        if (ask) void send(ask.ids, ask.skip);
      }}
    />
  );
  return { open, dialog };
}
