'use client';

import { formatDateRu } from '@buhuchet/domain';
import {
  SeriesActionResult,
  SeriesTasks,
  type SeriesRuleBody,
  type TaskSeriesInfo,
} from '@buhuchet/shared';
import { ConfirmDialog, Modal, Pill, useToast, type ActionEntry } from '@buhuchet/ui';
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { MiniScale } from '../status/status-line';
import { SeriesRuleDialog } from './series-dialog';
import { useTasksRefresh } from './tasks-data';

/** Серия, с которой действуют: строка «Повтор» карточки задачи и название задачи для окон. */
export interface SeriesRef {
  info: TaskSeriesInfo;
  title: string;
}

/** «Все задачи серии»: срок, исполнитель, статус — новые сверху; и сама серия. */
export const seriesTasksQuery = (id: string) =>
  queryOptions({
    queryKey: ['tasks', 'series', id, 'tasks'],
    queryFn: async () => {
      const res = await api.api['task-series'][':id'].tasks.$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return SeriesTasks.parse(await res.json());
    },
  });

/** Что меню строки вкладки «Повторы» знает о серии без запроса. */
export type SeriesMenuRow = Pick<TaskSeriesInfo, 'state' | 'manage' | 'refusal'>;

/** Почему кнопки «Изменить повтор», «Остановить», «Возобновить» неактивны (прототип `taskBossWhy`). */
export function seriesBossWhy(t: Translate, info: SeriesMenuRow): string | null {
  if (info.manage) return null;
  return info.refusal ?? t('err.series_author_only');
}

/**
 * Действия с серией (прототип modules/task-series.js: `tsEditRule`, `tsStopDlg`, `tsResume`,
 * `tsListDlg`): «Изменить повтор» — окно «Повтор» по правилу серии; «Остановить повтор» — после вопроса;
 * «Возобновить» — сразу (исполнитель заблокирован, контрагент в архиве — отказ с причиной); «Все задачи
 * серии» — окно со списком. Права проверяет сервер, кнопки — по `manage` и `refusal` серии.
 */
export function useSeriesActions(onOpenTask?: (id: string) => void): {
  edit: (s: SeriesRef) => void;
  stop: (s: SeriesRef) => void;
  resume: (s: SeriesRef) => void;
  list: (s: SeriesRef) => void;
  /** Пункты меню строки вкладки «Повторы» (прототип `tsActions`); `load` — свежая серия для окна. */
  menu: (
    row: SeriesMenuRow,
    nearest: (() => void) | null,
    load: () => Promise<SeriesRef>,
  ) => ActionEntry[];
  node: ReactNode;
} {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useTasksRefresh();
  const [ruleDlg, setRuleDlg] = useState<DialogSlot<SeriesRef> | null>(null);
  const [stopAsk, setStopAsk] = useState<SeriesRef | null>(null);
  const [tasks, setTasks] = useState<DialogSlot<SeriesRef> | null>(null);
  const [busy, setBusy] = useState(false);

  const refused = (s: SeriesRef) => {
    const why = seriesBossWhy(t, s.info);
    if (why) toast(why, { bad: true });
    return !!why;
  };

  const done = (res: Awaited<ReturnType<typeof callApi>>, ok: (made: boolean) => string) => {
    refresh();
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return false;
    }
    const parsed = SeriesActionResult.safeParse(res.data);
    toast(ok(parsed.success && parsed.data.made), { icon: 'repeat' });
    return true;
  };

  const saveRule = async (s: SeriesRef, rule: SeriesRuleBody, start: string) => {
    setBusy(true);
    const res = await callApi(() =>
      api.api['task-series'][':id'].rule.$put({
        param: { id: s.info.id },
        json: { rule, start, version: s.info.version },
      }),
    );
    setBusy(false);
    if (done(res, () => t('task.series.toast.edited'))) setRuleDlg(closeSlot);
  };

  const stopNow = async (s: SeriesRef) => {
    const res = await callApi(() =>
      api.api['task-series'][':id'].stop.$post({
        param: { id: s.info.id },
        json: { version: s.info.version },
      }),
    );
    done(res, () => t('task.series.toast.stopped'));
  };

  const resume = async (s: SeriesRef) => {
    if (refused(s)) return;
    const res = await callApi(() =>
      api.api['task-series'][':id'].resume.$post({
        param: { id: s.info.id },
        json: { version: s.info.version },
      }),
    );
    done(res, (made) => t(made ? 'task.series.toast.resumed_made' : 'task.series.toast.resumed'));
  };

  const edit = (s: SeriesRef) => {
    if (!refused(s)) setRuleDlg(openSlot(s));
  };
  const stop = (s: SeriesRef) => {
    if (!refused(s)) setStopAsk(s);
  };
  const list = (s: SeriesRef) => setTasks(openSlot(s));

  /** Свежая серия перед действием из меню списка: правило и версия — с сервера, не из строки. */
  const withFresh = (load: () => Promise<SeriesRef>, run: (s: SeriesRef) => void) => {
    load().then(run, () => toast(t('err.unknown'), { bad: true }));
  };

  const menu = (
    row: SeriesMenuRow,
    nearest: (() => void) | null,
    load: () => Promise<SeriesRef>,
  ): ActionEntry[] => {
    const why = seriesBossWhy(t, row) ?? undefined;
    const off = !row.manage;
    const reason = off && why ? { reason: why } : {};
    const entries: ActionEntry[] = [];
    if (nearest)
      entries.push({ id: 'open', icon: 'task', label: t('task.series.act.open'), run: nearest });
    entries.push({
      id: 'edit',
      icon: 'edit',
      label: t('task.series.act.edit'),
      disabled: off,
      ...reason,
      run: () => withFresh(load, edit),
    });
    if (row.state === 'active')
      entries.push({
        id: 'stop',
        icon: 'ban',
        label: t('task.series.act.stop'),
        danger: true,
        disabled: off,
        ...reason,
        run: () => withFresh(load, stop),
      });
    if (row.state === 'stopped')
      entries.push({
        id: 'resume',
        icon: 'repeat',
        label: t('task.series.act.resume'),
        disabled: off,
        ...reason,
        run: () => withFresh(load, (s) => void resume(s)),
      });
    entries.push({
      id: 'all',
      icon: 'list',
      label: t('task.series.act.all'),
      run: () => withFresh(load, list),
    });
    return entries;
  };

  const node = (
    <>
      {ruleDlg ? (
        <SeriesRuleDialog
          key={`series-rule-${ruleDlg.n}`}
          open={ruleDlg.open}
          onClose={() => setRuleDlg(closeSlot)}
          rule={ruleDlg.data.info.rule}
          start={ruleDlg.data.info.start}
          term={ruleDlg.data.info.term}
          busy={busy}
          onDone={(rule, start) => void saveRule(ruleDlg.data, rule, start)}
        />
      ) : null}
      <ConfirmDialog
        open={stopAsk !== null}
        onClose={() => setStopAsk(null)}
        title={t('task.series.stop.title')}
        text={t('task.series.stop.text', { title: stopAsk?.title ?? '' })}
        ok={t('task.series.act.stop')}
        danger
        onConfirm={() => stopAsk && void stopNow(stopAsk)}
      />
      {tasks ? (
        <SeriesTasksDialog
          key={`series-tasks-${tasks.n}`}
          open={tasks.open}
          series={tasks.data}
          onClose={() => setTasks(closeSlot)}
          onOpen={(id) => {
            setTasks(closeSlot);
            onOpenTask?.(id);
          }}
        />
      ) : null}
    </>
  );

  return { edit, stop, resume: (s) => void resume(s), list, menu, node };
}

/** «Все задачи серии» (прототип `tsListDlg`): новые сверху, строка открывает задачу. */
function SeriesTasksDialog({
  open,
  series,
  onClose,
  onOpen,
}: {
  open: boolean;
  series: SeriesRef;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const query = useQuery(seriesTasksQuery(series.info.id));
  const data = query.data;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="mid"
      title={t('task.series.act.all')}
      sub={`${data?.title ?? series.title} · ${data?.text ?? series.info.text}`}
    >
      <div data-series-tasks="" className="flex flex-col">
        {query.isError ? <Pill tone="bad">{t('err.unknown')}</Pill> : null}
        {data && !data.items.length ? (
          <p className="m-0 text-muted">{t('task.series.list.empty')}</p>
        ) : null}
        {data?.items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-series-task={item.id}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 border-0 border-b border-line bg-transparent px-1 py-2 text-left text-ink last:border-b-0 hover:bg-row-hover"
            onClick={() => onOpen(item.id)}
          >
            <span className="min-w-[86px] tabular-nums">{formatDateRu(item.dueDate)}</span>
            <span className="min-w-0 flex-1 truncate">{item.executor ?? '—'}</span>
            <MiniScale t={t} input={{ scale: 'task', status: item.status, history: [] }} />
          </button>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Строка «Повтор» в карточке задачи (блок 4, пункт 2; прототип `tsCardHtml`): правило словами, «·
 * следующая <дата>», «остановлен» / «закончился» с причиной; «Все задачи серии · N», «Изменить
 * повтор», «Остановить повтор» или «Возобновить» — постановщику и владельцу, постановщику без права
 * «Ставить задачи» — неактивные с подсказкой.
 */
export function SeriesCardRow({
  series,
  actions,
}: {
  series: SeriesRef;
  actions: ReturnType<typeof useSeriesActions>;
}) {
  const t = useT();
  const { info } = series;
  const why = seriesBossWhy(t, info);
  const show = info.manage || !!info.refusal;
  const link =
    'cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-link hover:underline disabled:cursor-not-allowed disabled:text-faint disabled:no-underline max-md:min-h-9';
  const off = !info.manage;
  const title = off && why ? why : undefined;
  return (
    <div
      data-task-series={info.state}
      className="flex items-start gap-2 rounded-xl border border-line bg-info-bg px-3 py-2.5 text-[13px]"
    >
      <span className="mt-px text-info-label" aria-hidden="true">
        ↻
      </span>
      <span className="min-w-0 flex-1">
        <b>{t('task.series.card.label')}</b> {info.text}
        {info.next ? ` · ${t('task.series.card.next', { date: formatDateRu(info.next) })}` : ''}
        {info.state !== 'active' ? (
          <>
            {' · '}
            <Pill tone={info.state === 'finished' ? 'plain' : 'warn'}>
              {t(info.state === 'stopped' ? 'task.series.card.stopped' : 'task.series.card.finished')}
            </Pill>
            {info.stopText ? <span className="ml-1 text-muted">{info.stopText}</span> : null}
          </>
        ) : null}
        <span className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1">
          <button
            type="button"
            data-series-all=""
            className={link}
            onClick={() => actions.list(series)}
          >
            {t('task.series.card.all', { n: info.count })}
          </button>
          {show ? (
            <>
              <button
                type="button"
                data-series-edit=""
                className={link}
                disabled={off}
                title={title}
                onClick={() => actions.edit(series)}
              >
                {t('task.series.act.edit')}
              </button>
              {info.state === 'active' ? (
                <button
                  type="button"
                  data-series-stop=""
                  className={link}
                  disabled={off}
                  title={title}
                  onClick={() => actions.stop(series)}
                >
                  {t('task.series.act.stop')}
                </button>
              ) : info.state === 'stopped' ? (
                <button
                  type="button"
                  data-series-resume=""
                  className={link}
                  disabled={off}
                  title={title}
                  onClick={() => actions.resume(series)}
                >
                  {t('task.series.act.resume')}
                </button>
              ) : null}
            </>
          ) : null}
        </span>
      </span>
    </div>
  );
}

/** Серия по номеру — свежая, перед действием из меню вкладки «Повторы». */
export async function seriesById(
  client: QueryClient,
  id: string,
): Promise<SeriesRef> {
  const data = await client.fetchQuery({ ...seriesTasksQuery(id), staleTime: 0 });
  return { info: data.series, title: data.title };
}
