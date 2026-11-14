'use client';

import { CP_TG_LINK_TTL_HOURS, formatMomentRu, type CpTgStatus } from '@buhuchet/domain';
import {
  ContractorTelegram,
  PublicPageTelegramLink,
  type ContractorTelegramItem,
  type PageTelegram,
} from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  Hint,
  Icon,
  MiniTable,
  Pill,
  useToast,
  type IconName,
  type MiniRow,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';

/*
 * Telegram контрагента (доработки 13.11.2026, задача К3; прототип v92 modules/cp-telegram.js): раздел
 * «Telegram» страницы без входа (pgTgPub) и список «Telegram контрагента» блока «Страница контрагента»
 * карточки (pgTgBox, pgTgBoxClick). Кто может подтвердить, отклонить и отключить, решает сервер:
 * `manage` в ответе — причина, по которой кнопки недоступны.
 */

/** Адрес страницы без входа: `/<организация>/inn/<ИНН>`. */
export interface PageAddress {
  slug: string;
  inn: string;
}

/**
 * Раздел «Telegram» страницы контрагента. «Подключить Telegram» просит у сервера одноразовую ссылку
 * (её получает только браузер, где введён код страницы) и открывает бота в новой вкладке: вкладка
 * открывается сразу по нажатию — иначе браузер телефона её не пустит, — адрес ставится после ответа.
 * Когда клиент вернулся на страницу, она перечитывается: «ждёт подтверждения бухгалтера».
 */
export function PageTelegramBody({
  telegram,
  address,
  what,
}: {
  telegram: PageTelegram;
  address: PageAddress;
  /** Пояснение раздела из «Текстов элементов экрана»: есть — своего текста раздел не показывает. */
  what: string;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (!asked) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [asked, router]);

  const full = telegram.full ? t('err.cp_tg_full') : null;
  const connect = async () => {
    if (full) return toast(full, { icon: 'lock', bad: true });
    if (busy) return;
    setBusy(true);
    const tab = window.open('about:blank', '_blank');
    // Адрес — под адресом страницы: cookie этой ссылки браузер отправляет только туда.
    const res = await callApi(() =>
      fetch(`/${address.slug}/inn/${address.inn}/telegram`, { method: 'POST' }),
    );
    setBusy(false);
    if (!res.ok) {
      tab?.close();
      toast(errorText(res.error), { bad: true });
      // Страница выключена или мест уже нет — показать, как есть сейчас.
      router.refresh();
      return;
    }
    const { url } = PublicPageTelegramLink.parse(res.data);
    setAsked(true);
    if (tab) {
      tab.opener = null;
      tab.location.replace(url);
    } else {
      window.location.assign(url);
    }
  };

  return (
    <>
      {what ? null : <p className="m-0 leading-[1.5]">{t('pub.tg.text')}</p>}
      {telegram.on || telegram.wait ? (
        <div className="flex flex-wrap gap-1.5" data-pub-tg-state="">
          {telegram.on ? (
            <Pill tone="ok" size="sm" icon="check">
              {t('pub.tg.on', { n: telegram.on })}
            </Pill>
          ) : null}
          {telegram.wait ? (
            <Pill tone="warn" size="sm" icon="hourglass">
              {t('pub.tg.wait', { n: telegram.wait })}
            </Pill>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-pub-tg-connect=""
          className={`${buttonClass('cta')} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:shadow-none`}
          aria-disabled={full ? true : undefined}
          title={full ?? undefined}
          disabled={busy}
          onClick={() => void connect()}
        >
          <Icon name="tg" size="sm" />
          {t('pub.tg.connect')}
        </button>
      </div>
      <span className="text-[11.5px] leading-[1.4] text-faint">
        {t('pub.tg.hint', { hours: CP_TG_LINK_TTL_HOURS })}
      </span>
    </>
  );
}

/** Итог раздела «Telegram» в свёрнутом заголовке на телефоне (прототип pgTgPub). */
export function pageTelegramSum(t: Translate, telegram: PageTelegram): string {
  if (telegram.on) return t('pub.tg.sum.on', { n: telegram.on });
  return telegram.wait ? t('pub.tg.sum.wait') : '';
}

/** Список «Telegram контрагента» карточки; функция «Страница контрагента» выключена — null. */
export const contractorTelegramQuery = (contractorId: string) =>
  queryOptions({
    queryKey: ['contractor-page', contractorId, 'telegram'],
    queryFn: async (): Promise<ContractorTelegram | null> => {
      const res = await api.api.contractors[':id'].page.telegram.$get({
        param: { id: contractorId },
      });
      if (res.ok) return ContractorTelegram.parse(await res.json());
      const failure = await apiFailure(res);
      if (failure.error.code === 'cppage_off') return null;
      throw failure;
    },
  });

const STATUS_PILL: Record<CpTgStatus, { tone: 'warn' | 'ok' | 'plain'; icon: IconName }> = {
  wait: { tone: 'warn', icon: 'hourglass' },
  on: { tone: 'ok', icon: 'check' },
  no: { tone: 'plain', icon: 'ban' },
  off: { tone: 'plain', icon: 'ban' },
};

type Decision = 'approve' | 'reject' | 'unlink';

/**
 * Список «Telegram контрагента» в блоке «Страница контрагента» (прототип pgTgBox): запросы и
 * подключения с кнопками «Подтвердить», «Отклонить», «Отключить». Показан, пока раздел «Telegram»
 * страницы включён или в списке есть строки; подтверждение и отключение — через окно с вопросом.
 */
export function ContractorTelegramBox({ contractorId }: { contractorId: string }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const query = useQuery(contractorTelegramQuery(contractorId));
  const [ask, setAsk] = useState<{ item: ContractorTelegramItem; action: Decision } | null>(null);
  const data = query.data;
  if (!data || (!data.sectionOn && data.items.length === 0)) return null;

  const key = contractorTelegramQuery(contractorId).queryKey;
  const manage = data.manage ? t(`err.${data.manage}`) : null;
  // Подтвердить можно, только пока раздел «Telegram» страницы действует (то же проверяет сервер).
  const whyNot = (action: Decision) =>
    manage ?? (action === 'approve' && !data.sectionOn ? t('err.cp_tg_section_off') : null);
  const run = async (item: ContractorTelegramItem, action: Decision) => {
    const res = await callApi(() =>
      api.api.contractors[':id'].page.telegram[':linkId'].$post({
        param: { id: contractorId, linkId: item.id },
        json: { action, version: item.version },
      }),
    );
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      void client.invalidateQueries({ queryKey: key });
      return;
    }
    client.setQueryData(key, ContractorTelegram.parse(res.data));
    // Решение пишется в историю контрагента.
    void client.invalidateQueries({ queryKey: ['contractors', 'history', contractorId] });
    toast(t(`cppage.tg.toast.${action}`, { name: item.name }), { icon: 'tg' });
  };
  const press = (item: ContractorTelegramItem, action: Decision) => {
    const why = whyNot(action);
    if (why) return toast(why, { icon: 'lock', bad: true });
    if (action === 'reject') return void run(item, action);
    setAsk({ item, action });
  };
  const button = (item: ContractorTelegramItem, action: Decision, icon: IconName) => (
    <button
      key={action}
      type="button"
      data-cp-tg-action={action}
      className={`${buttonClass(action === 'approve' ? 'cta' : 'default', 'sm')} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:shadow-none`}
      aria-disabled={whyNot(action) ? true : undefined}
      title={whyNot(action) ?? undefined}
      onClick={() => press(item, action)}
    >
      <Icon name={icon} size="sm" />
      <span>{t(`cppage.tg.btn.${action}`)}</span>
    </button>
  );
  const rows: MiniRow[] = data.items.map((item) => {
    const pill = STATUS_PILL[item.status];
    const actions =
      item.status === 'wait'
        ? [button(item, 'approve', 'check'), button(item, 'reject', 'x')]
        : item.status === 'on'
          ? [button(item, 'unlink', 'ban')]
          : [];
    return {
      key: item.id,
      wide: ['act'],
      blank: actions.length ? [] : ['act'],
      cells: {
        name: <b>{item.name}</b>,
        at: formatMomentRu(new Date(item.requestedAt)),
        status: (
          <>
            <span>
              <Pill tone={pill.tone} size="sm" icon={pill.icon}>
                {t(`cppage.tg.status.${item.status}`)}
              </Pill>
            </span>
            {item.decidedAt ? (
              <Hint>
                {item.byClient ? t('cppage.tg.by_client') : (item.decidedBy ?? '')}
                {item.byClient || item.decidedBy ? ', ' : ''}
                {formatMomentRu(new Date(item.decidedAt))}
              </Hint>
            ) : null}
          </>
        ),
        act: (
          <span className="flex flex-wrap gap-1.5 md:flex-nowrap md:justify-end">{actions}</span>
        ),
      },
    };
  });

  return (
    <div
      data-cp-tg=""
      data-cp-tg-ready={query.isFetching ? undefined : ''}
      className="flex flex-col gap-2 border-t border-line pt-2.5"
    >
      <h4 className="m-0 flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-ink">
        <Icon name="tg" size="sm" className="text-info" />
        <span>{t('cppage.tg.title')}</span>
        {data.wait ? (
          <Pill tone="warn" size="sm" icon="hourglass">
            {t('cppage.tg.wait', { n: data.wait })}
          </Pill>
        ) : null}
        <span className="grow" />
        <span className="text-[11.5px] font-normal text-faint">
          {t('cppage.tg.count', { n: data.on, max: data.max })}
        </span>
      </h4>
      {data.items.length ? (
        <MiniTable
          label={t('cppage.tg.title')}
          empty=""
          columns={[
            { key: 'name', label: t('cppage.tg.col.name') },
            { key: 'at', label: t('cppage.tg.col.at') },
            { key: 'status', label: t('cppage.tg.col.status') },
            { key: 'act', label: '' },
          ]}
          rows={rows}
        />
      ) : (
        <Hint>{t('cppage.tg.empty')}</Hint>
      )}
      <Hint>{t('cppage.tg.hint')}</Hint>
      <ConfirmDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={ask ? t(`cppage.tg.${ask.action === 'unlink' ? 'unlink' : 'approve'}.title`) : ''}
        text={
          ask
            ? t(`cppage.tg.${ask.action === 'unlink' ? 'unlink' : 'approve'}.text`, {
                name: ask.item.name,
                contractor: data.contractor,
              })
            : ''
        }
        ok={ask ? t(`cppage.tg.btn.${ask.action}`) : ''}
        danger={ask?.action === 'unlink'}
        onConfirm={() => {
          if (ask) void run(ask.item, ask.action);
        }}
      />
    </div>
  );
}
