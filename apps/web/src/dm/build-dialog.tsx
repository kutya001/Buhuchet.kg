'use client';

import {
  DM_BUILD_DEPTH,
  DM_BUILD_MAX,
  type DmBuildJoin,
  type DmBuildState,
  dmBuildFill,
  dmBuildPathText,
  dmBuildPlan,
  dmBuildSql,
  dmBuildStart,
} from '@buhuchet/domain';
import type { DmSchemaTable } from '@buhuchet/shared';
import {
  buttonClass,
  CHECKBOX_CLASS,
  Field,
  Icon,
  inputClass,
  Modal,
  Note,
  Tag,
  useToast,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import '../admin/techdocs.css';
import './sql-editor.css';
import { useT } from '../l10n/provider';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { buildStore, type BuildRequest } from './build-store';
import { fieldKind, type SchemaIndex } from './console-assist';
import { consoleSchemaQuery } from './console-data';
import { consoleOpen } from './console-store';
import { sqlTokens } from './sql-highlight';

/** Название вкладки сборки: «Сборка: …», не длиннее 60 знаков (прототип `dmcBuild` `#dmb-go`). */
export function buildTabName(prefix: (list: string) => string, names: readonly string[]): string {
  const n = prefix(names.join(', '));
  return n.length > 60 ? `${n.slice(0, 59)}…` : n;
}

/**
 * Окно «Собрать запрос» (блок 6, пункт 2; прототип v167 `dmcBuild`): карточка каждой таблицы плана —
 * связь, промежуточная ли, выбор пути, поля галочками; «Какие строки», задвоение сумм с «Считать итоги
 * отдельно», предпросмотр SELECT; «Открыть в консоли» — вкладка «Сборка: …». Ставится в разметку
 * экрана; рисует окно только первый смонтированный хост (`build-store.ts`).
 */
export function BuildHost() {
  const id = useMemo(() => Symbol('build-host'), []);
  useEffect(() => buildStore.claim(id), [id]);
  const host = useSyncExternalStore(
    buildStore.subscribe,
    () => buildStore.isHost(id),
    () => false,
  );
  const req = useSyncExternalStore(buildStore.subscribe, buildStore.get, () => null);
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const [ready, setReady] = useState<{
    n: number;
    index: SchemaIndex;
    state: DmBuildState;
    cut: boolean;
  } | null>(null);

  // Новая просьба: карта базы, начальное состояние; нет описания или таблиц — уведомление, окна нет.
  const n = host && req?.open ? req.n : 0;
  useEffect(() => {
    if (!n || !req) return;
    let live = true;
    void client
      .fetchQuery(consoleSchemaQuery)
      .catch(() => null)
      .then((index) => {
        if (!live) return;
        if (!index || !index.tables.size) {
          buildStore.close();
          return toast(t('dm.b.no_db'), { icon: 'alert', bad: true });
        }
        const start = dmBuildStart(index.tables, req.names);
        if (!start.state.names.length) {
          buildStore.close();
          return toast(t(req.method ? 'dm.b.no_method_tables' : 'dm.b.no_tables'), {
            icon: 'alert',
            bad: true,
          });
        }
        setReady({ n: req.n, index, ...start });
      });
    return () => {
      live = false;
    };
    // Только по номеру просьбы: остальное в ней не меняется.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  if (!host || !req || !ready || ready.n !== req.n) return null;
  return (
    <BuildWindow
      key={ready.n}
      req={req}
      index={ready.index}
      initial={ready.state}
      cut={ready.cut}
    />
  );
}

function BuildWindow({
  req,
  index,
  initial,
  cut,
}: {
  req: BuildRequest;
  index: SchemaIndex;
  initial: DmBuildState;
  cut: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const { userId } = useShell();
  const schema = index.tables;
  const [st, setSt] = useState(initial);
  const plan = useMemo(() => dmBuildPlan(schema, st), [schema, st]);
  // Поля по умолчанию у таблиц, которые только что попали в план (прототип `fill`).
  const filled = useMemo(() => dmBuildFill(st, plan), [st, plan]);
  const sql = useMemo(() => dmBuildSql(schema, filled, plan), [schema, filled, plan]);
  const title = (name: string) => schema.get(name)?.title || name;
  const none = plan.steps.filter((s) => s.none);
  const free = [...schema.values()]
    .filter((x) => !filled.names.includes(x.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const update = (f: (s: DmBuildState) => DmBuildState) => setSt((s) => f(dmBuildFill(s, plan)));
  const remove = (name: string) =>
    update((s) => {
      const fields = { ...s.fields };
      delete fields[name];
      return { ...s, names: s.names.filter((x) => x !== name), fields };
    });

  const go = () => {
    if (!sql) return;
    consoleOpen(userId ?? '', {
      sql,
      name: buildTabName((list) => t('dm.b.name', { list }), filled.names),
      src: 'build',
      ...(req.notes ? { notes: req.notes } : {}),
    });
    buildStore.close();
    const href = tabHref('dm', 'con');
    if (path !== href) router.push(href);
  };

  return (
    <Modal
      open={req.open}
      onClose={() => buildStore.close()}
      title={t('dm.b.title')}
      sub={t(req.method ? 'dm.b.sub_method' : 'dm.b.sub', {
        n: filled.names.length,
        max: DM_BUILD_MAX,
        method: req.method ?? '',
      })}
      size="wide"
      kind="form"
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={() => buildStore.close()}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            className={buttonClass('cta')}
            disabled={!sql}
            data-dm-b-go=""
            onClick={go}
          >
            <Icon name="code" size="sm" />
            {t('dm.con.api.open')}
          </button>
        </>
      }
    >
      <div
        className="grid items-start gap-3 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        data-dm-b=""
      >
        <div className="flex min-w-0 flex-col gap-2.5">
          {cut ? (
            <Note tone="warn" icon="alert">
              <span data-dm-b-cut="">{t('dm.b.cut', { max: DM_BUILD_MAX })}</span>
            </Note>
          ) : null}
          {plan.joins.map((j) => (
            <TableCard
              key={j.t}
              j={j}
              table={schema.get(j.t)!}
              parentTitle={j.parent ? title(j.parent) : ''}
              st={filled}
              step={plan.steps.find((s) => s.t === j.t)}
              canRemove={filled.names.includes(j.t) && filled.names.length > 1}
              onRemove={() => remove(j.t)}
              onPath={(k) => update((s) => ({ ...s, choice: { ...s.choice, [j.t]: k } }))}
              onField={(f, on) =>
                update((s) => {
                  const list = s.fields[j.t] ?? [];
                  const next = on
                    ? list.includes(f)
                      ? list
                      : [...list, f]
                    : list.filter((x) => x !== f);
                  return { ...s, fields: { ...s.fields, [j.t]: next } };
                })
              }
            />
          ))}
          {none.map((s) => (
            <Note key={s.t} tone="bad" icon="alert">
              <div className="flex flex-wrap items-center gap-2" data-dm-b-none={s.t}>
                <span className="min-w-0 flex-1">
                  {t('dm.b.none', { name: s.t, depth: DM_BUILD_DEPTH })}
                </span>
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => remove(s.t)}
                >
                  {t('dm.b.none_del')}
                </button>
              </div>
            </Note>
          ))}
          {filled.names.length < DM_BUILD_MAX ? (
            <AddTable
              free={free}
              onAdd={(name) => update((s) => ({ ...s, names: [...s.names, name] }))}
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2.5">
          <section className="flex flex-col gap-1.5 rounded-xl border border-line bg-raised p-3">
            <h3 className="m-0 text-[14px] font-semibold">{t('dm.b.rows')}</h3>
            {(['left', 'inner'] as const).map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="dm-b-kind"
                  className={CHECKBOX_CLASS}
                  checked={filled.kind === k}
                  data-dm-b-kind={k}
                  onChange={() => update((s) => ({ ...s, kind: k }))}
                />
                <span>{t(`dm.b.${k}`)}</span>
              </label>
            ))}
            <span className="text-[12px] text-muted">{t('dm.b.alive')}</span>
          </section>
          {plan.dbl ? (
            <Note tone="warn" icon="alert">
              <div className="flex flex-col items-start gap-2" data-dm-b-dbl="">
                <span>
                  <b>{t('dm.b.dbl')}</b>{' '}
                  {t('dm.b.dbl_text', {
                    list: plan.many.map((j) => `«${title(j.t)}»`).join(` ${t('dm.b.and')} `),
                  })}
                  {plan.sepOk ? ` ${t('dm.b.dbl_sep')}` : ''}
                </span>
                {plan.sepOk ? (
                  <button
                    type="button"
                    className={buttonClass(filled.sep ? 'cta' : 'default', 'sm')}
                    aria-pressed={filled.sep}
                    data-dm-b-sep=""
                    onClick={() => update((s) => ({ ...s, sep: !s.sep }))}
                  >
                    {t(filled.sep ? 'dm.b.sep_on' : 'dm.b.sep')}
                  </button>
                ) : null}
              </div>
            </Note>
          ) : null}
          <section className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-raised p-3">
            <h3 className="m-0 text-[14px] font-semibold">{t('dm.con.query')}</h3>
            <pre className="td-code m-0 max-h-[420px] overflow-auto" data-dm-b-sql="">
              {sqlTokens(sql).map((x, i) =>
                x.kind === 'plain' ? (
                  x.text
                ) : (
                  <i key={i} className={`not-italic dmsql-${x.kind}`} data-sql={x.kind}>
                    {x.text}
                  </i>
                ),
              )}
            </pre>
          </section>
        </div>
      </div>
    </Modal>
  );
}

function TableCard({
  j,
  table,
  parentTitle,
  st,
  step,
  canRemove,
  onRemove,
  onPath,
  onField,
}: {
  j: DmBuildJoin;
  table: DmSchemaTable;
  parentTitle: string;
  st: DmBuildState;
  step: ReturnType<typeof dmBuildPlan>['steps'][number] | undefined;
  canRemove: boolean;
  onRemove: () => void;
  onPath: (k: number) => void;
  onField: (f: string, on: boolean) => void;
}) {
  const t = useT();
  const pathId = useId();
  const picked = st.fields[j.t] ?? [];
  const link = `${j.alias}.${j.col} = ${j.parentAlias}.${j.pcol}`;
  return (
    <section
      className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-raised p-3"
      data-dm-b-table={j.t}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <b>{table.title || j.t}</b>
        <span className="font-mono text-faint">{`${j.t} ${j.alias}`}</span>
        {j.via ? <Tag>{t('dm.b.via')}</Tag> : null}
        {table.orgVisible ? null : <Tag>{t('dm.con.closed')}</Tag>}
        <span className="flex-1" />
        {canRemove ? (
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            title={t('dm.b.del')}
            aria-label={t('dm.b.del')}
            data-dm-b-del={j.t}
            onClick={onRemove}
          >
            <Icon name="x" size="sm" />
          </button>
        ) : null}
      </div>
      <span className="text-[12px] text-muted" data-dm-b-link="">
        {j.parent ? (
          <>
            {j.via ? `${t('dm.b.via_hint', { name: table.title || j.t })} ` : ''}
            {t(j.many ? 'dm.b.link_many' : 'dm.b.link', { link, parent: parentTitle })}
          </>
        ) : (
          t('dm.b.first')
        )}
      </span>
      {step && !step.none && step.paths.length > 1 ? (
        <Field
          id={pathId}
          label={t('dm.b.path', { n: step.paths.length })}
          hint={t('dm.b.path_hint')}
          full
        >
          <select
            id={pathId}
            className={inputClass()}
            value={step.pick}
            data-dm-b-path={j.t}
            onChange={(e) => onPath(Number(e.target.value))}
          >
            {step.paths.map((p, i) => (
              <option key={i} value={i}>
                {dmBuildPathText(p)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 min-[600px]:grid-cols-2">
        {table.fields.map((f) => (
          <label
            key={f.name}
            className="flex min-w-0 cursor-pointer items-center gap-1.5 text-[12.5px]"
          >
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={picked.includes(f.name)}
              data-dm-b-field={`${j.t}.${f.name}`}
              onChange={(e) => onField(f.name, e.target.checked)}
            />
            <span className="font-mono">{f.name}</span>
            <span className="truncate text-faint">
              {f.title || fieldKind(f, { money: t('dm.con.money') })}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function AddTable({
  free,
  onAdd,
}: {
  free: readonly DmSchemaTable[];
  onAdd: (name: string) => void;
}) {
  const t = useT();
  const id = useId();
  return (
    <Field id={id} label={t('dm.b.add')}>
      <select
        id={id}
        className={inputClass()}
        value=""
        data-dm-b-add=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
        }}
      >
        <option value="">—</option>
        {free.map((x) => (
          <option key={x.name} value={x.name}>
            {x.title ? `${x.name} · ${x.title}` : x.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
