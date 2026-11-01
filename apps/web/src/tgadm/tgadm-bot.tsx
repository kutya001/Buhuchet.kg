'use client';

import {
  bishkekTime,
  OUTBOX_BATCH,
  OUTBOX_MAX_TRIES,
  OUTBOX_PAUSE_MS,
  pluralForm,
} from '@buhuchet/domain';
import { AdminTelegramBot } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Hint,
  Icon,
  KeyValues,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  useToast,
} from '@buhuchet/ui';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiFailure } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';

const botQuery = queryOptions({
  queryKey: ['admin', 'tg-bot'],
  queryFn: async () => {
    const res = await api.api.admin.telegram.bot.$get();
    if (!res.ok) throw await apiFailure(res);
    return AdminTelegramBot.parse(await res.json());
  },
  // Состояние вебхука — на момент открытия вкладки и нажатия «Проверить вебхук», не из памяти.
  staleTime: 0,
  gcTime: 0,
});

/**
 * Почему вебхук не работает (прототип: «Последняя ошибка Telegram: …» моноширинным): текст ошибки
 * Telegram или чужой адрес — моноширинным после подписи.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-30 — причины сверх «последней ошибки Telegram».
function ProblemNote({ t, bot }: { t: Translate; bot: AdminTelegramBot }) {
  if (bot.ok || !bot.problem) return null;
  const detail =
    bot.problem === 'delivery' ? bot.lastError : bot.problem === 'other_url' ? bot.actualUrl : null;
  return (
    <div data-tg-problem="">
      <Note tone="bad" icon="alert">
        <span>
          {t(`tgadm.bot.problem.${bot.problem}`)}
          {detail ? (
            <>
              {' '}
              <span className={MONO_CLASS}>{detail}</span>
            </>
          ) : null}
        </span>
      </Note>
    </div>
  );
}

/** Пауза между пачками словами: «1,2». */
const PAUSE_SECONDS = String(OUTBOX_PAUSE_MS / 1000).replace('.', ',');

/**
 * Админка → «Телеграм» → «Бот платформы» (ТЗ: адрес вебхука, состояние — работает или текст последней
 * ошибки Telegram, «Проверить вебхук»; токен не вводится и не показывается, «Заменить токен» —
 * пояснение про настройки Vercel; прототип admin/telegram.js, tab 'bot'). Справа — как работает
 * очередь отправки.
 */
export function TgAdmBot() {
  const t = useT();
  const toast = useToast();
  const bot = useQuery(botQuery);
  const [token, setToken] = useState(false);
  const data = bot.data;

  const check = async () => {
    const was = data?.ok ?? true;
    const res = await bot.refetch();
    const now = res.data;
    if (!now) return toast(t('err.unknown'), { bad: true });
    const hm = bishkekTime(new Date(now.checkedAt));
    if (now.ok) toast(t(was ? 'tgadm.bot.check_ok' : 'tgadm.bot.check_again', { hm }), { icon: 'check' });
    else toast(t('tgadm.bot.check_bad', { hm }), { bad: true });
  };

  const state = data ? (
    data.ok ? (
      <Pill tone="ok" icon="check">
        {t('tgadm.bot.ok')}
      </Pill>
    ) : (
      <Pill tone="bad" icon="alert">
        {t('tgadm.bot.bad')}
      </Pill>
    )
  ) : (
    ''
  );

  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3.5 max-[900px]:grid-cols-[minmax(0,1fr)]">
      <Box title={t('tgadm.bot.title')}>
        <KeyValues
          items={[
            {
              id: 'url',
              label: t('tgadm.bot.url'),
              value: <span className={`${MONO_CLASS} text-[12px]`}>{data?.url ?? ''}</span>,
            },
            { id: 'state', label: t('tgadm.bot.state'), value: state },
            {
              id: 'checked',
              label: t('tgadm.bot.checked'),
              value: data
                ? t('tgadm.bot.checked_at', { hm: bishkekTime(new Date(data.checkedAt)) })
                : '',
            },
          ]}
        />
        {data ? <ProblemNote t={t} bot={data} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClass('default', 'sm')}
            disabled={bot.isFetching}
            onClick={() => void check()}
          >
            <Icon name="refresh" size="sm" />
            {t('tgadm.bot.check')}
          </button>
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            onClick={() => setToken(true)}
          >
            <Icon name="key" size="sm" />
            {t('tgadm.bot.token')}
          </button>
        </div>
        <Hint>{t('tgadm.bot.hint')}</Hint>
      </Box>
      <Box title={t('tgadm.queue.title')}>
        <p className="m-0 leading-[1.55]">{t('tgadm.queue.text')}</p>
        <KeyValues
          items={[
            {
              id: 'batch',
              label: t('tgadm.queue.batch'),
              value: t(`tgadm.count.${pluralForm(OUTBOX_BATCH)}`, { n: OUTBOX_BATCH }),
            },
            {
              id: 'pause',
              label: t('tgadm.queue.pause'),
              value: t('tgadm.queue.pause_v', { s: PAUSE_SECONDS }),
            },
            {
              id: 'tries',
              label: t('tgadm.queue.tries'),
              value: t('tgadm.queue.tries_v', { n: OUTBOX_MAX_TRIES }),
            },
            {
              id: 'digest',
              label: t('tgadm.queue.digest'),
              value: t('tgadm.queue.digest_v'),
            },
          ]}
        />
      </Box>
      <Modal
        open={token}
        onClose={() => setToken(false)}
        kind="message"
        title={t('tgadm.token.title')}
        sub={t('tgadm.token.sub')}
        footer={
          <button type="button" className={buttonClass('cta')} onClick={() => setToken(false)}>
            {t('tgadm.token.ok')}
          </button>
        }
      >
        <ol className="m-0 list-decimal pl-5 leading-[1.6]">
          <li>{t('tgadm.token.step1')}</li>
          <li>{t('tgadm.token.step2')}</li>
          <li>{t('tgadm.token.step3')}</li>
          <li>{t('tgadm.token.step4')}</li>
        </ol>
        <p className="m-0 text-muted">{t('tgadm.token.note')}</p>
      </Modal>
    </div>
  );
}
