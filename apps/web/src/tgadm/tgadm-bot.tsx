'use client';

import {
  bishkekTime,
  OUTBOX_BATCH,
  OUTBOX_MAX_TRIES,
  OUTBOX_PAUSE_MS,
  pluralForm,
} from '@buhuchet/domain';
import { AdminTelegramBot, AdminTelegramBotTopics, AdminTelegramBotView } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CheckRow,
  Hint,
  Icon,
  KeyValues,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  useToast,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { BotSamplesDialog } from './bot-samples';

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
 * очередь отправки. Ниже — «Вид сообщений и кнопки» (поток Т, задача Т1): общий переключатель
 * таблиц в сообщениях (сохраняется сразу) и примеры сообщений; «Темы в чате с ботом» (задача Т7,
 * прототип v104 `#tg-topics`) и состояние тем у бота в @BotFather — по ответу Telegram (getMe).
 */
export function TgAdmBot() {
  const t = useT();
  const toast = useToast();
  const bot = useQuery(botQuery);
  const errorText = useErrorText();
  const client = useQueryClient();
  const [token, setToken] = useState(false);
  const [samples, setSamples] = useState(false);
  const [saving, setSaving] = useState(false);
  const data = bot.data;
  const rich = data?.rich ?? true;
  const topics = data?.topics ?? false;

  /** «Таблицы и раскрывающиеся разделы в сообщениях»: сохраняется сразу (прототип `#tg-rich`). */
  const setRich = async (next: boolean) => {
    if (!data) return;
    setSaving(true);
    // Идущая проверка вебхука могла прочитать прежнее значение — её ответ переключатель не затирает
    // (на время сохранения «Проверить вебхук» недоступна).
    await client.cancelQueries({ queryKey: botQuery.queryKey });
    const show = (rich: boolean) =>
      client.setQueryData(botQuery.queryKey, (old) => (old ? { ...old, rich } : old));
    show(next);
    const res = await callApi(() => api.api.admin.telegram.bot.view.$put({ json: { rich: next } }));
    setSaving(false);
    if (!res.ok) {
      show(!next);
      return toast(errorText(res.error), { bad: true, icon: 'alert' });
    }
    show(AdminTelegramBotView.parse(res.data).rich);
    toast(t(next ? 'tgadm.view.rich_on' : 'tgadm.view.rich_off'), { icon: 'tg' });
  };

  /** «Темы в чате с ботом»: сохраняется сразу (прототип `#tg-topics`). */
  const setTopics = async (next: boolean) => {
    if (!data) return;
    setSaving(true);
    await client.cancelQueries({ queryKey: botQuery.queryKey });
    const show = (topics: boolean) =>
      client.setQueryData(botQuery.queryKey, (old) => (old ? { ...old, topics } : old));
    show(next);
    const res = await callApi(() =>
      api.api.admin.telegram.bot.topics.$put({ json: { topics: next } }),
    );
    setSaving(false);
    if (!res.ok) {
      show(!next);
      return toast(errorText(res.error), { bad: true, icon: 'alert' });
    }
    show(AdminTelegramBotTopics.parse(res.data).topics);
    toast(t(next ? 'tgadm.view.topics_on' : 'tgadm.view.topics_off'), { icon: 'tg' });
  };

  // ОТКЛОНЕНИЕ: docs/deviations.md#Т-11 — «Темы в @BotFather» по ответу Telegram, а не по переключателю.
  const topicsReady = !data ? (
    ''
  ) : data.topicsReady ? (
    <Pill tone="ok" icon="check">
      {t('tgadm.view.topics_ready_on')}
    </Pill>
  ) : (
    <span className="text-muted">
      {t(
        data.topicsReady === false
          ? 'tgadm.view.topics_ready_off'
          : 'tgadm.view.topics_ready_unknown',
      )}
    </span>
  );

  const check = async () => {
    const was = data?.ok ?? true;
    const res = await bot.refetch();
    const now = res.data;
    if (!now) return toast(t('err.unknown'), { bad: true });
    const hm = bishkekTime(new Date(now.checkedAt));
    if (now.ok)
      toast(t(was ? 'tgadm.bot.check_ok' : 'tgadm.bot.check_again', { hm }), { icon: 'check' });
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
    <div className="flex flex-col gap-3.5">
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
              disabled={bot.isFetching || saving}
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
      </div>
      <div data-tg-view="">
        <Box title={t('tgadm.view.title')}>
          <CheckRow
            plain
            checked={rich}
            disabled={!data || saving}
            onChange={(next) => void setRich(next)}
            label={t('tgadm.view.rich')}
            data-tg-rich=""
          >
            <Hint>{t('tgadm.view.rich_hint')}</Hint>
          </CheckRow>
          <CheckRow
            plain
            checked={topics}
            disabled={!data || saving}
            onChange={(next) => void setTopics(next)}
            label={t('tgadm.view.topics')}
            data-tg-topics=""
          >
            <Hint>{t('tgadm.view.topics_hint')}</Hint>
          </CheckRow>
          <KeyValues
            items={[{ id: 'topics', label: t('tgadm.view.topics_ready'), value: topicsReady }]}
          />
          <KeyValues
            items={[
              { id: 'press', label: t('tgadm.view.press'), value: t('tgadm.view.press_v') },
              { id: 'refusal', label: t('tgadm.view.refusal'), value: t('tgadm.view.refusal_v') },
              { id: 'actions', label: t('tgadm.view.actions'), value: t('tgadm.view.actions_v') },
              {
                id: 'fallback',
                label: t('tgadm.view.fallback'),
                value: t('tgadm.view.fallback_v'),
              },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonClass('default', 'sm')}
              onClick={() => setSamples(true)}
            >
              <Icon name="eye" size="sm" />
              {t('tgadm.view.samples')}
            </button>
          </div>
        </Box>
      </div>
      <BotSamplesDialog open={samples} rich={rich} onClose={() => setSamples(false)} />
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
