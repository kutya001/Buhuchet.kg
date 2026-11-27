'use client';

import {
  bishkekDate,
  dmSqlFormat,
  dmSqlRunText,
  dmSqlStatements,
  formatMomentRu,
  monthOf,
  type DmRewriteNote,
} from '@buhuchet/domain';
import {
  DM_CONSOLE_QUERY_NAME_MAX,
  DM_CONSOLE_QUERY_TEXT_MAX,
  isRecordChanged,
  type DmConsoleInput,
  type DmConsoleQuery,
  type DmConsoleRun,
} from '@buhuchet/shared';
import {
  buttonClass,
  ConfirmDialog,
  EmptyState,
  Field,
  FormGrid,
  Hint,
  Icon,
  inputClass,
  Modal,
  Note,
  PHONE_QUERY,
  RecordChangedNotice,
  useMediaQuery,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { schemaHash } from '../admin/techdocs-model';
import { fetchApiMethods, techDocsStore } from '../admin/techdocs-data';
import { useMethodCard, MethodBadge } from '../admin/techdocs-method';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useListExport } from '../lists/export';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { consoleParamNames, consoleParamType } from './console-assist';
import {
  checkConsole,
  consoleHistoryQuery,
  consolePlanOf,
  consoleQueriesQuery,
  consoleQueryOf,
  consoleResultOf,
  consoleSchemaQuery,
  createConsoleQuery,
  deleteConsoleQuery,
  explainConsole,
  exportConsole,
  runConsole,
  stopConsole,
  updateConsoleQuery,
} from './console-data';
import {
  consoleHasMoney,
  consolePlanLines,
  consoleResult,
  consoleParamsToSend,
} from './console-model';
import {
  consoleOpen,
  consoleStore,
  useConsoleState,
  type ConsoleState,
  type ConsoleTab as Tab,
} from './console-store';
import { useMethodConsole } from './method-console';
import type { DmOutResult } from './out-model';
import { OutTable } from './out-table';
import { SqlEditor, type SqlEditorApi } from './sql-editor';

/** «Сохранить в шаблон»: окно шаблона с запросом вкладки (его ставит экран модуля, `tpl-actions.tsx`). */
export type ConsoleToTemplate = (o: { tab: Tab; last: DmOutResult | null }) => void;

/** Ответ под редактором (прототип `t.res`): живёт в памяти страницы, в браузер не пишется. */
type ConsoleRes =
  | { kind: 'rows'; result: DmOutResult; key: string; body: DmConsoleInput }
  | { kind: 'error'; text: string }
  | { kind: 'plan'; plan: unknown }
  | { kind: 'busy' };

const results = new Map<string, ConsoleRes>();
const resListeners = new Set<() => void>();
let resVersion = 0;
function setRes(id: string, r: ConsoleRes | null) {
  if (r) results.set(id, r);
  else if (!results.delete(id)) return;
  resVersion += 1;
  for (const l of resListeners) l();
}
const resSubscribe = (l: () => void) => {
  resListeners.add(l);
  return () => void resListeners.delete(l);
};
const useResVersion = () =>
  useSyncExternalStore(
    resSubscribe,
    () => resVersion,
    () => resVersion,
  );

/** Столбцы последнего запуска вкладки — для окна шаблона. */
function lastRows(id: string): DmOutResult | null {
  const r = results.get(id);
  return r?.kind === 'rows' ? r.result : null;
}

const tabName = (t: Translate, tab: Tab) => tab.name || t('dm.con.tab.name', { n: tab.n });

/** Значение параметра в полоске: введённое, иначе по имени — месяц или дата сегодня (прототип `pars`). */
function paramValue(tab: Tab, k: string): string {
  const v = tab.params[k];
  if (v !== undefined) return v;
  const today = bishkekDate(new Date());
  const type = consoleParamType(k);
  return type === 'month' ? monthOf(today) : type === 'date' ? today : '';
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * «Витрина данных» → «Консоль» Админки (доработки 27.11.2026: консоль запросов, блоки 1, 3, 4; этап 1,
 * П4–П6; прототип v166 `renderDmCon`, `dmcSide`, `dmcRun`, `dmcResDraw`, `dmcPhone`): слева «База»,
 * «Методы API», «Заготовки», «Мои запросы» с «Историей»; справа вкладки запросов, кнопки, редактор,
 * параметры и результат. На телефоне — «Мои запросы», запуск и результат; писать запросы — на ПК.
 */
export function ConsoleTab({ toTemplate }: { toTemplate: ConsoleToTemplate }) {
  const { userId } = useShell();
  const phone = useMediaQuery(PHONE_QUERY);
  const state = useConsoleState(userId ?? '');
  useResVersion();
  const tab = state.tabs[state.cur] ?? state.tabs[0]!;
  // «Создать шаблон на основе» (П6) и «Сохранить в шаблон» из другого места: окно — сразу после перехода.
  useEffect(() => {
    const id = consoleStore.takeToTemplate();
    const at = id ? consoleStore.get().tabs.find((x) => x.id === id) : null;
    if (at) toTemplate({ tab: at, last: lastRows(at.id) });
  }, [state.toTemplate, toTemplate]);
  const run = useConsoleRun(tab);
  return phone ? (
    <ConsolePhone tab={tab} run={run} />
  ) : (
    <ConsolePc
      state={state}
      tab={tab}
      run={run}
      onTemplate={() => toTemplate({ tab, last: lastRows(tab.id) })}
    />
  );
}

/** «Выполнить», «Остановить», «План запроса» вкладки (прототип `dmcRun`, `dmcPlan`, `dmcPick`). */
function useConsoleRun(tab: Tab) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);
  const editor = useRef<SqlEditorApi | null>(null);

  /** Что уходит в базу: выделенный текст или оператор под курсором; один оператор и все параметры. */
  const pick = (): DmConsoleInput | null => {
    const sel = editor.current?.selection() ?? { from: 0, to: 0 };
    const text = dmSqlRunText(tab.sql, sel.from, sel.to);
    if (!text) {
      toast(t('dm.con.no_stmt'), { icon: 'alert', bad: true });
      return null;
    }
    if (dmSqlStatements(text).length > 1) {
      setRes(tab.id, { kind: 'error', text: t('dm.con.one_stmt') });
      return null;
    }
    const values = Object.fromEntries(consoleParamNames(text).map((k) => [k, paramValue(tab, k)]));
    const params = consoleParamsToSend(text, values);
    const miss = Object.keys(params).find((k) => params[k] === null);
    if (miss) {
      setRes(tab.id, { kind: 'error', text: t('dm.con.param_missing', { name: miss }) });
      return null;
    }
    const names = Object.keys(params);
    const types = tab.types
      ? Object.fromEntries(names.flatMap((k) => (tab.types?.[k] ? [[k, tab.types[k]]] : [])))
      : {};
    return Object.keys(types).length ? { query: text, params, types } : { query: text, params };
  };

  const go = async (plan: boolean) => {
    if (running) return;
    const body = pick();
    if (!body) return;
    const id = tab.id;
    setRunning(id);
    setRes(id, { kind: 'busy' });
    const res = await (plan ? explainConsole(body) : runConsole(body));
    setRunning(null);
    if (!plan) void client.invalidateQueries({ queryKey: consoleHistoryQuery.queryKey });
    if (!res.ok) return setRes(id, { kind: 'error', text: errorText(res.error) });
    if (plan) {
      const parsed = consolePlanOf(res.data);
      return setRes(
        id,
        parsed.success
          ? { kind: 'plan', plan: parsed.data.plan }
          : { kind: 'error', text: t('err.unknown') },
      );
    }
    const parsed = consoleResultOf(res.data);
    if (!parsed.success) return setRes(id, { kind: 'error', text: t('err.unknown') });
    setRes(id, {
      kind: 'rows',
      result: consoleResult(parsed.data, (name) => t('dm.con.som', { name })),
      key: `${id}:${Date.now()}`,
      body,
    });
  };

  const stop = async () => {
    const n = await stopConsole();
    if (!n) toast(t('dm.con.stop_idle'), { icon: 'info' });
  };

  return {
    editor,
    running: running === tab.id,
    busy: running !== null,
    run: () => void go(false),
    plan: () => void go(true),
    stop: () => void stop(),
  };
}

type Run = ReturnType<typeof useConsoleRun>;

function ConsolePc({
  state,
  tab,
  run,
  onTemplate,
}: {
  state: ConsoleState;
  tab: Tab;
  run: Run;
  onTemplate: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const schema = useQuery(consoleSchemaQuery);
  const [mineDlg, setMineDlg] = useState<DialogSlot<null> | null>(null);
  const res = results.get(tab.id) ?? null;
  const rows = res?.kind === 'rows' ? res : null;
  const xl = useListExport(
    useCallback(() => exportConsole(rows?.body ?? { query: '', params: {} }), [rows]),
  );

  const insert = (text: string) => {
    const e = run.editor.current;
    if (!e) return;
    const sel = e.selection();
    e.replace(sel.from, sel.to, text);
  };
  const showSchema = (table: string) => {
    techDocsStore.go(schemaHash.table(table));
    router.push(tabHref('tdocs', 'db'));
  };
  const format = () => {
    const e = run.editor.current;
    if (!e) return;
    const sel = e.selection();
    if (sel.to > sel.from)
      e.replace(sel.from, sel.to, dmSqlFormat(tab.sql.slice(sel.from, sel.to)));
    else e.replace(0, tab.sql.length, dmSqlFormat(tab.sql));
  };

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-3.5" data-dm-con="">
      <ConsoleSide state={state} onInsert={insert} onSchema={showSchema} />
      <section className="flex min-w-0 flex-col gap-2">
        <ConsoleTabs state={state} />
        <div className="flex flex-wrap items-center gap-1.5" data-dm-con-bar="">
          <button
            type="button"
            className={buttonClass('cta')}
            title={t('dm.con.run_title')}
            disabled={run.busy}
            data-dm-con-run=""
            onClick={run.run}
          >
            <Icon name="play" size="sm" />
            {t('dm.con.run')}
          </button>
          <button
            type="button"
            className={buttonClass('default')}
            disabled={!run.running}
            title={run.running ? undefined : t('dm.con.stop_idle')}
            data-dm-con-stop=""
            onClick={run.stop}
          >
            {t('dm.con.stop')}
          </button>
          <button
            type="button"
            className={buttonClass('default')}
            disabled={run.busy}
            data-dm-con-plan=""
            onClick={run.plan}
          >
            {t('dm.con.plan')}
          </button>
          <button
            type="button"
            className={buttonClass('default')}
            data-dm-con-fmt=""
            onClick={format}
          >
            {t('dm.con.format')}
          </button>
          <button
            type="button"
            className={buttonClass('default')}
            disabled={!rows || xl.exporting}
            title={rows ? undefined : t('dm.con.xl_wait')}
            data-dm-con-xl=""
            onClick={() => void xl.run()}
          >
            <Icon name="download" size="sm" />
            {t('dm.con.xl')}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            className={buttonClass('default')}
            data-dm-con-mine=""
            onClick={() => setMineDlg(openSlot(null))}
          >
            {t('dm.con.save_mine')}
          </button>
          <button
            type="button"
            className={buttonClass('default')}
            data-dm-con-tpl=""
            onClick={onTemplate}
          >
            <Icon name="layers" size="sm" />
            {t('dm.con.save_tpl')}
          </button>
        </div>
        <TabNotes tab={tab} />
        <SqlEditor
          key={tab.id}
          value={tab.sql}
          maxLength={DM_CONSOLE_QUERY_TEXT_MAX}
          schema={schema.data ?? null}
          check={checkConsole}
          onChange={(sql) => {
            consoleStore.patch(tab.id, { sql });
            setRes(tab.id, null);
          }}
          onRun={run.run}
          onSchema={showSchema}
          apiRef={run.editor}
          label={t('dm.con.query')}
          tall
        />
        <ParamStrip tab={tab} />
        <ConsoleResult res={res} />
      </section>
      {mineDlg ? (
        <MineDialog
          key={`dm-con-mine-${mineDlg.n}`}
          tab={tab}
          open={mineDlg.open}
          onClose={() => setMineDlg(closeSlot)}
        />
      ) : null}
    </div>
  );
}

/** Вкладки запросов (прототип `.dmc-tabs`): выбрать, закрыть, новая. */
function ConsoleTabs({ state }: { state: ConsoleState }) {
  const t = useT();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line pb-1" data-dm-con-tabs="">
      {state.tabs.map((x, i) => {
        const on = i === state.cur;
        const name = tabName(t, x);
        return (
          <div
            key={x.id}
            className={`inline-flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-lg border border-line px-2 py-1 text-[13px] ${on ? 'bg-pane font-semibold text-ink' : 'bg-pane-alt text-muted'}`}
            data-dm-con-tab={i}
            aria-current={on ? 'true' : undefined}
          >
            <button
              type="button"
              className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 font-[inherit] text-inherit"
              title={name}
              onClick={() => consoleStore.select(i)}
            >
              {name}
            </button>
            <button
              type="button"
              className="inline-flex cursor-pointer border-0 bg-transparent p-0 text-inherit opacity-60 hover:opacity-100"
              title={t('dm.con.tab.close')}
              aria-label={t('dm.con.tab.close')}
              data-dm-con-close={i}
              onClick={() => {
                setRes(x.id, null);
                consoleStore.close(i);
              }}
            >
              <Icon name="x" size="sm" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={buttonClass('ghost', 'sm')}
        title={t('dm.con.tab.new')}
        aria-label={t('dm.con.tab.new')}
        data-dm-con-new=""
        onClick={consoleStore.add}
      >
        <Icon name="plus" size="sm" />
      </button>
    </div>
  );
}

/** Над редактором: запрос метода API (что заменено, что заменить) и шаблон, из которого открыт запрос. */
/** Пометки перестройки метода API словами словаря (`dm.con.rw.<код>`). */
const rewriteText = (t: Translate, list: readonly DmRewriteNote[]) =>
  list.map((x) => t(`dm.con.rw.${x.code}`, x.vars)).join('; ');

function TabNotes({ tab }: { tab: Tab }) {
  const t = useT();
  const n = tab.notes;
  return (
    <>
      {n ? (
        <Note tone="warn" icon="alert">
          <span data-dm-con-notes="">
            <b>{`${t('dm.con.warn')}.`}</b> {t('dm.con.from', { method: n.from })}
            {n.changed.length ? (
              <>
                <br />
                <span data-dm-con-changed="">
                  {t('dm.con.changed', { list: rewriteText(t, n.changed) })}
                </span>
              </>
            ) : null}
            {n.replace.length ? (
              <>
                <br />
                <span data-dm-con-replace="">
                  {t('dm.con.replace', { list: rewriteText(t, n.replace) })}
                </span>
              </>
            ) : null}
          </span>
        </Note>
      ) : null}
      {tab.tpl ? (
        <Hint>
          <span data-dm-con-tpl-of="">
            {t(tab.tpl.builtin ? 'dm.con.tpl_sys' : 'dm.con.tpl_of', { name: tab.tpl.name })}
          </span>
        </Hint>
      ) : null}
    </>
  );
}

/** Полоска параметров `:имя` (прототип `#dmc-pars`): значение уходит в базу данными. */
function ParamStrip({ tab, readOnly = false }: { tab: Tab; readOnly?: boolean }) {
  const t = useT();
  const names = consoleParamNames(tab.sql);
  if (!names.length) return null;
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2" data-dm-con-pars="">
      {names.map((k) => (
        <div key={k} className="min-w-[150px] max-md:min-w-0 max-md:flex-[1_1_100%]">
          <Field id={`dmcp-${tab.id}-${k}`} label={`:${k}`}>
            {(c) => (
              <input
                {...c}
                type={consoleParamType(k)}
                className={inputClass()}
                value={paramValue(tab, k)}
                readOnly={readOnly}
                data-dm-con-par={k}
                onChange={(e) => {
                  consoleStore.patch(tab.id, { params: { ...tab.params, [k]: e.target.value } });
                }}
              />
            )}
          </Field>
        </div>
      ))}
      <Hint>{t('dm.con.par_hint')}</Hint>
    </div>
  );
}

/** Результат под редактором (прототип `dmcResDraw`): таблица «как в Excel» «Вывода», ошибка, план. */
function ConsoleResult({ res }: { res: ConsoleRes | null }) {
  const t = useT();
  if (!res) return null;
  let body: ReactNode;
  if (res.kind === 'busy') body = <div className="min-h-[80px]" aria-busy="true" />;
  else if (res.kind === 'error') {
    body = (
      <Note tone="bad" icon="alert" alert>
        <span className="break-words whitespace-pre-wrap" data-dm-con-error="">
          {res.text}
        </span>
      </Note>
    );
  } else if (res.kind === 'plan') body = <PlanView plan={res.plan} />;
  else {
    body = (
      <>
        {consoleHasMoney(res.result) ? <Hint>{t('dm.con.money_note')}</Hint> : null}
        <OutTable result={res.result} run={res.key} />
      </>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2" data-dm-con-res={res.kind}>
      {body}
    </div>
  );
}

/** «План запроса»: узлы плана базы деревом — вид операции, таблица, оценка строк и стоимости. */
function PlanView({ plan }: { plan: unknown }) {
  const t = useT();
  const lines = consolePlanLines(plan);
  return (
    <section
      className="flex flex-col gap-1.5 rounded-xl border border-line bg-raised px-4 py-3"
      data-dm-con-plan-view=""
    >
      <Hint>{t('dm.con.plan_hint')}</Hint>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-[12.5px]">
        {lines.map((x, i) => (
          <li key={i} style={{ paddingLeft: x.depth * 16 }}>
            <b>{x.type}</b>
            {x.relation ? <span className="text-violet">{` ${x.relation}`}</span> : null}
            <span className="text-faint">
              {` · ${t('dm.con.plan_rows', { n: x.rows })} · ${t('dm.con.plan_cost', { n: x.cost })}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SIDES = ['db', 'api', 'pre', 'mine'] as const;

/** Левая панель (прототип `dmcSide`). */
function ConsoleSide({
  state,
  onInsert,
  onSchema,
}: {
  state: ConsoleState;
  onInsert: (text: string) => void;
  onSchema: (table: string) => void;
}) {
  const t = useT();
  return (
    <aside
      className="sticky top-3 flex max-h-[calc(100vh-170px)] min-w-0 flex-col gap-2 rounded-xl border border-line bg-raised p-3"
      data-dm-con-side={state.side}
    >
      <SmallTabs
        items={SIDES.map((k) => ({ id: k, label: t(`dm.con.side.${k}`) }))}
        active={state.side}
        onSelect={(k) => consoleStore.setSide(k as ConsoleState['side'])}
        mark="data-dm-con-sidetab"
      />
      {state.side === 'pre' ? null : (
        <input
          className={inputClass()}
          value={state.q}
          placeholder={t(
            `dm.con.q.${state.side === 'api' ? 'api' : state.side === 'mine' ? 'mine' : 'db'}`,
          )}
          aria-label={t(
            `dm.con.q.${state.side === 'api' ? 'api' : state.side === 'mine' ? 'mine' : 'db'}`,
          )}
          data-dm-con-q=""
          onChange={(e) => consoleStore.setQ(e.target.value)}
        />
      )}
      <div className="flex min-h-[120px] flex-col gap-1.5 overflow-auto text-[13px]">
        {state.side === 'db' ? (
          <DbSide q={state.q} onInsert={onInsert} onSchema={onSchema} />
        ) : null}
        {state.side === 'api' ? <ApiSide q={state.q} /> : null}
        {state.side === 'pre' ? (
          <EmptyState icon="book" title={t('dm.con.pre.title')} text={t('dm.con.pre.text')} />
        ) : null}
        {state.side === 'mine' ? <MineSide state={state} /> : null}
      </div>
    </aside>
  );
}

function SmallTabs({
  items,
  active,
  onSelect,
  mark,
}: {
  items: readonly { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  mark: string;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex flex-wrap gap-0.5 self-start rounded-lg bg-pane-alt p-0.5"
    >
      {items.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={active === x.id}
          {...{ [mark]: x.id }}
          onClick={() => onSelect(x.id)}
          className={`min-h-7 cursor-pointer rounded-md border-0 px-2.5 py-0.5 font-[inherit] text-[12.5px] font-semibold ${active === x.id ? 'bg-raised text-ink shadow-btn' : 'bg-transparent text-muted hover:text-ink'}`}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

const LINK =
  'cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-link hover:underline';
const MONO = 'font-mono';

/** «База»: группы → таблицы → поля; нажатие вставляет имя в запрос (прототип `dmcSide` `db`). */
function DbSide({
  q,
  onInsert,
  onSchema,
}: {
  q: string;
  onInsert: (text: string) => void;
  onSchema: (table: string) => void;
}) {
  const t = useT();
  const schema = useQuery(consoleSchemaQuery);
  const s = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const index = schema.data;
    if (!index) return [];
    const hit = (x: string | null) => !!x && x.toLowerCase().includes(s);
    const tables = [...index.tables.values()].filter(
      (x) =>
        !s ||
        x.name.includes(s) ||
        hit(x.title) ||
        x.fields.some((f) => f.name.includes(s) || hit(f.title)),
    );
    return index.groups
      .map((g) => ({ g, list: tables.filter((x) => (x.group ?? '') === g) }))
      .filter((x) => x.list.length);
  }, [schema.data, s]);
  if (schema.isError) return <Note tone="bad">{t('grid.load_error')}</Note>;
  if (!schema.data) return <div className="min-h-[80px]" aria-busy="true" />;
  if (!groups.length) return <span className="text-faint">{t('dm.con.nothing')}</span>;
  return (
    <div data-dm-con-db="">
      {groups.map(({ g, list }) => (
        <details key={g || '-'} open={!!s} className="py-0.5">
          <summary className="cursor-pointer font-semibold">
            {g || t('dm.con.group_other')}{' '}
            <span className="font-normal text-faint">{list.length}</span>
          </summary>
          {list.map((x) => (
            <details key={x.name} className="ml-2" data-dm-con-table={x.name}>
              <summary className="cursor-pointer py-0.5">
                <button
                  type="button"
                  className={`${LINK} ${MONO}`}
                  title={t('dm.con.insert')}
                  onClick={() => onInsert(x.name)}
                >
                  {x.name}
                </button>{' '}
                <span className="text-faint">{x.title ?? ''}</span>
                {x.orgVisible ? null : (
                  <span className="ml-1 rounded bg-label-bg px-1 text-[11px]">
                    {t('dm.con.closed')}
                  </span>
                )}
              </summary>
              <ul className="my-0.5 ml-2.5 flex list-none flex-col gap-0.5 p-0">
                {x.fields.map((f) => (
                  <li key={f.name}>
                    <button
                      type="button"
                      className={`${LINK} ${MONO}`}
                      onClick={() => onInsert(f.name)}
                    >
                      {f.name}
                    </button>{' '}
                    <span className="text-faint">{f.type}</span>{' '}
                    <span className={f.title ? undefined : 'text-faint'}>
                      {f.title ?? t('dm.con.no_desc')}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={`${LINK} inline-flex items-center gap-1`}
                onClick={() => onSchema(x.name)}
              >
                <Icon name="db" size="sm" />
                {t('dm.con.schema')}
              </button>
            </details>
          ))}
        </details>
      ))}
    </div>
  );
}

const API_FILTERS = JSON.stringify({ m: { type: 'enum', vals: ['GET'] } });

/** «Методы API»: методы чтения; кнопки передают запрос в консоль, сами ничего не выполняют (блок 5). */
function ApiSide({ q }: { q: string }) {
  const t = useT();
  const router = useRouter();
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);
  const list = useQuery({
    queryKey: ['dm', 'console', 'api', debounced],
    queryFn: () =>
      fetchApiMethods({
        page: '1',
        size: '100',
        filters: API_FILTERS,
        ...(debounced ? { q: debounced, qcols: 'p,sum' } : {}),
      }),
    staleTime: Infinity,
  });
  const card = useMethodCard((hash) => {
    techDocsStore.go(hash);
    router.push(tabHref('tdocs', 'db'));
  }, true);
  const toConsole = useMethodConsole();
  if (list.isError) return <Note tone="bad">{t('grid.load_error')}</Note>;
  if (!list.data) return <div className="min-h-[80px]" aria-busy="true" />;
  return (
    <div className="flex flex-col" data-dm-con-api="">
      <Hint>{t('dm.con.api.hint')}</Hint>
      {list.data.items.length ? null : <span className="text-faint">{t('dm.con.nothing')}</span>}
      {list.data.items.map((m) => (
        <div
          key={m.id}
          className="flex flex-col gap-1 border-b border-line py-1.5"
          data-dm-con-method={m.id}
        >
          <button
            type="button"
            className={`${LINK} text-ink`}
            title={t('dm.con.api.card')}
            onClick={() => card.open(m.id)}
          >
            <MethodBadge method={m.method} /> <span className={MONO}>{m.path}</span>
          </button>
          {m.summary ? <span className="text-faint">{m.summary}</span> : null}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={buttonClass('default', 'sm')}
              data-dm-con-mo=""
              onClick={() => void toConsole(m.id, false, false)}
            >
              {t('dm.con.api.open')}
            </button>
            <button
              type="button"
              className={buttonClass('default', 'sm')}
              data-dm-con-mt=""
              onClick={() => void toConsole(m.id, true, false)}
            >
              {t('dm.con.api.tpl')}
            </button>
          </div>
        </div>
      ))}
      {card.node}
    </div>
  );
}

/** «Мои запросы» и «История» (блок 4, пункты 1–2; прототип `dmcSide` `mine`). */
function MineSide({ state }: { state: ConsoleState }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const { userId } = useShell();
  const mine = useQuery(consoleQueriesQuery);
  const hist = useQuery(consoleHistoryQuery);
  const [ask, setAsk] = useState<DmConsoleQuery | null>(null);
  const s = state.q.trim().toLowerCase();
  const mineList = (mine.data ?? [])
    .filter((x) => !s || x.name.toLowerCase().includes(s) || x.query.toLowerCase().includes(s))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const histList = (hist.data ?? []).filter((x) => !s || x.query.toLowerCase().includes(s));

  const remove = async (x: DmConsoleQuery) => {
    setAsk(null);
    const res = await deleteConsoleQuery(x.id, x.version);
    void client.invalidateQueries({ queryKey: consoleQueriesQuery.queryKey });
    if (!res.ok && res.status !== 404)
      return toast(errorText(res.error), { icon: 'alert', bad: true });
    consoleStore.forgetMine(x.id);
    toast(t('dm.con.mine.deleted'), { icon: 'trash' });
  };

  return (
    <div className="flex flex-col gap-1" data-dm-con-minebox="">
      <SmallTabs
        items={[
          { id: 'mine', label: t('dm.con.mine.tab', { n: mineList.length }) },
          { id: 'hist', label: t('dm.con.hist.tab', { n: histList.length }) },
        ]}
        active={state.mineTab}
        onSelect={(k) => consoleStore.setMineTab(k as 'mine' | 'hist')}
        mark="data-dm-con-mq"
      />
      {state.mineTab === 'mine' ? (
        mine.isError ? (
          <Note tone="bad">{t('grid.load_error')}</Note>
        ) : mineList.length ? (
          mineList.map((x) => (
            <div
              key={x.id}
              className="flex flex-col gap-0.5 border-b border-line py-1.5"
              data-dm-con-mine-row={x.id}
            >
              <button
                type="button"
                className={`${LINK} font-semibold`}
                onClick={() =>
                  consoleOpen(userId ?? '', {
                    sql: x.query,
                    params: paramsOf(x.params),
                    name: x.name,
                    mine: { id: x.id, version: x.version },
                  })
                }
              >
                {x.name}
              </button>
              <span className={`${MONO} truncate text-faint`}>{oneLine(x.query)}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-faint">{formatMomentRu(new Date(x.updatedAt))}</span>
                <span className="flex-1" />
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  title={t('dm.con.mine.del')}
                  aria-label={t('dm.con.mine.del')}
                  data-dm-con-mdel=""
                  onClick={() => setAsk(x)}
                >
                  <Icon name="trash" size="sm" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <span className="text-faint">{t('dm.con.mine.none')}</span>
        )
      ) : hist.isError ? (
        <Note tone="bad">{t('grid.load_error')}</Note>
      ) : histList.length ? (
        histList.map((x) => <HistRow key={x.id} t={t} x={x} userId={userId ?? ''} />)
      ) : (
        <span className="text-faint">{t('dm.con.hist.none')}</span>
      )}
      <ConfirmDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={t('dm.con.mine.del_title')}
        text={t('dm.con.mine.del_text', { name: ask?.name ?? '' })}
        ok={t('dm.con.mine.del')}
        danger
        onConfirm={() => ask && void remove(ask)}
      />
    </div>
  );
}

const paramsOf = (p: Record<string, string | null>) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? '']));

function HistRow({ t, x, userId }: { t: Translate; x: DmConsoleRun; userId: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-1.5" data-dm-con-hist-row={x.id}>
      <button
        type="button"
        className={`${LINK} ${MONO} truncate`}
        title={x.query}
        onClick={() =>
          consoleOpen(userId, {
            sql: x.query,
            params: paramsOf(x.params),
            name: t('dm.con.from_hist'),
          })
        }
      >
        {oneLine(x.query)}
      </button>
      <span className="text-faint">
        {formatMomentRu(new Date(x.at))}
        {` · ${t(`dm.con.outcome.${x.outcome}`)}`}
        {x.action === 'dm_console_export' ? ` · ${t('dm.con.xl')}` : ''}
        {x.rows !== null ? ` · ${t('dm.con.hist.rows', { n: x.rows })}` : ''}
      </span>
    </div>
  );
}

/** «Сохранить в Мои запросы» (блок 4, пункт 2; прототип `dmcMineDlg`): видит только автор. */
function MineDialog({ tab, open, onClose }: { tab: Tab; open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const own = tab.mine;
  const [name, setName] = useState(() => tabName(t, tab));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const close = onClose;

  const save = async (asNew: boolean) => {
    const n = name.trim();
    if (!n) return setError(t('dm.con.mine.name_req'));
    if (!tab.sql.trim()) return toast(t('dm.con.no_stmt'), { icon: 'alert', bad: true });
    if (tab.sql.length > DM_CONSOLE_QUERY_TEXT_MAX) {
      return toast(t('dm.con.mine.too_long', { n: DM_CONSOLE_QUERY_TEXT_MAX }), {
        icon: 'alert',
        bad: true,
      });
    }
    const params = Object.fromEntries(
      consoleParamNames(tab.sql).map((k) => {
        const v = paramValue(tab, k);
        return [k, v.trim() ? v : null];
      }),
    );
    setBusy(true);
    const body = { name: n, query: tab.sql, params };
    const res =
      own && !asNew
        ? await updateConsoleQuery(own.id, { ...body, version: own.version })
        : await createConsoleQuery(body);
    setBusy(false);
    if (!res.ok) {
      if (isRecordChanged(res.error)) return setChanged(true);
      if (res.status === 404 && own) {
        consoleStore.forgetMine(own.id);
        return toast(errorText(res.error), { icon: 'alert', bad: true });
      }
      return toast(errorText(res.error), { icon: 'alert', bad: true });
    }
    const saved = consoleQueryOf(res.data);
    void client.invalidateQueries({ queryKey: consoleQueriesQuery.queryKey });
    if (saved.success) {
      consoleStore.patch(tab.id, {
        name: n,
        mine: { id: saved.data.id, version: saved.data.version },
      });
    }
    consoleStore.setSide('mine');
    consoleStore.setMineTab('mine');
    close();
    toast(t('dm.con.mine.saved'), { icon: 'check' });
  };

  /** «Перечитать»: свежая версия записи; текст вкладки остаётся, сохранить — снова кнопкой. */
  const reload = async () => {
    if (!own) return;
    setReloading(true);
    try {
      const list = await client.fetchQuery({ ...consoleQueriesQuery, staleTime: 0 });
      const fresh = list.find((x) => x.id === own.id);
      if (fresh) {
        consoleStore.patch(tab.id, { mine: { id: fresh.id, version: fresh.version } });
        setName(fresh.name);
      } else consoleStore.forgetMine(own.id);
      setChanged(false);
    } catch {
      toast(t('err.unknown'), { icon: 'alert', bad: true });
    } finally {
      setReloading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      kind="form"
      title={t(own ? 'dm.con.mine.title_edit' : 'dm.con.mine.title')}
      sub={t('dm.con.mine.sub')}
      dirty={false}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={close}>
            {t('btn.cancel')}
          </button>
          {own ? (
            <button
              type="button"
              className={buttonClass('default')}
              disabled={busy}
              data-dm-con-mine-new=""
              onClick={() => void save(true)}
            >
              {t('dm.con.mine.as_new')}
            </button>
          ) : null}
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={busy}
            data-dm-con-mine-ok=""
            onClick={() => void save(false)}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5" data-dm-con-mine-dlg="">
        {changed ? (
          <RecordChangedNotice
            message={t('err.record_changed')}
            reloadLabel={t('form.reload')}
            onReload={() => void reload()}
            reloading={reloading}
          />
        ) : null}
        <FormGrid>
          <Field id="dcm-n" label={t('dm.con.mine.name')} required full error={error}>
            {(c) => (
              <input
                {...c}
                className={inputClass()}
                value={name}
                maxLength={DM_CONSOLE_QUERY_NAME_MAX}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  setError(undefined);
                }}
              />
            )}
          </Field>
        </FormGrid>
      </div>
    </Modal>
  );
}

/** Телефон (блок 1, пункт 6; прототип `dmcPhone`): «Мои запросы», запуск и результат. */
function ConsolePhone({ tab, run }: { tab: Tab; run: Run }) {
  const t = useT();
  const { userId } = useShell();
  const mine = useQuery(consoleQueriesQuery);
  const list = mine.data ?? [];
  const res = results.get(tab.id) ?? null;
  return (
    <div className="flex flex-col gap-2.5" data-dm-con-phone="">
      <Note icon="info">{t('dm.con.phone_note')}</Note>
      <section className="flex flex-col gap-1.5 rounded-xl border border-line bg-raised p-3">
        {list.length ? (
          list.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border bg-pane p-2 text-left font-[inherit] text-ink ${tab.mine?.id === x.id ? 'border-accent' : 'border-line'}`}
              data-dm-con-pm={x.id}
              onClick={() =>
                consoleOpen(userId ?? '', {
                  sql: x.query,
                  params: paramsOf(x.params),
                  name: x.name,
                  mine: { id: x.id, version: x.version },
                })
              }
            >
              <b>{x.name}</b>
              <span className={`${MONO} max-w-full truncate text-faint`}>{oneLine(x.query)}</span>
            </button>
          ))
        ) : (
          <span className="text-faint">{t('dm.con.phone_none')}</span>
        )}
      </section>
      {tab.mine ? (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-3">
            <h3 className="m-0 text-[15px] font-semibold">{tabName(t, tab)}</h3>
            <SqlEditor
              key={tab.id}
              value={tab.sql}
              readOnly
              apiRef={run.editor}
              label={t('dm.con.query')}
            />
            <ParamStrip tab={tab} />
            <button
              type="button"
              className={`${buttonClass('cta')} justify-center`}
              disabled={run.busy}
              data-dm-con-run=""
              onClick={run.run}
            >
              <Icon name="play" size="sm" />
              {t('dm.con.run')}
            </button>
          </section>
          <ConsoleResult res={res} />
        </>
      ) : null}
    </div>
  );
}
