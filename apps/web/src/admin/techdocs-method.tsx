'use client';

import type { UiTextKey } from '@buhuchet/domain';
import type { AdminApiMethodCard, ApiDocFieldRow } from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  Hint,
  Icon,
  KeyValues,
  linkButtonClass,
  MiniTable,
  Modal,
  MONO_CLASS,
  Note,
  Pill,
  useWindow,
  type CardTab,
  type KeyValueItem,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ApiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useCopyText } from '../kb/video/video-copy';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { apiMethodCardQuery, apiSchemaFieldsQuery } from './techdocs-data';
import {
  codeHref,
  codePlace,
  METHOD_CARD_TABS,
  METHOD_TAB_ICONS,
  methodClass,
  queryKind,
  responseTone,
  schemaHash,
  sqlTokens,
  typeParts,
  type MethodCardTab,
} from './techdocs-model';
import './techdocs.css';

const H4 = 'm-0 mt-1.5 text-[13px] font-[650]';
const FAINT = 'text-faint';

/** Метка метода HTTP (прототип tdMth). */
export function MethodBadge({ method, title = false }: { method: string; title?: boolean }) {
  return <span className={`${methodClass(method)}${title ? ' td-mth-title' : ''}`}>{method}</span>;
}

/** Тип поля: имена известных схем Zod — ссылки на окно их полей (прототип tdTypeHtml). */
function FieldType({
  field,
  known,
  onSchema,
}: {
  field: ApiDocFieldRow;
  known: ReadonlySet<string>;
  onSchema: (name: string) => void;
}) {
  return (
    <span className={MONO_CLASS}>
      {typeParts(field.type, known).map((part, i) =>
        part.schema ? (
          <button
            key={i}
            type="button"
            data-td-schema={part.text}
            className={`${linkButtonClass()} ${MONO_CLASS}`}
            onClick={() => onSchema(part.text)}
          >
            {part.text}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
      {field.nullable ? <span className={FAINT}> | null</span> : null}
    </span>
  );
}

/** Таблица полей запроса, ответа или схемы (прототип tdFieldsTbl). */
function FieldsTable({
  t,
  fields,
  known,
  onSchema,
}: {
  t: Translate;
  fields: readonly ApiDocFieldRow[];
  known: ReadonlySet<string>;
  onSchema: (name: string) => void;
}) {
  if (!fields.length) return <span className={FAINT}>{t('tdocs.f.none')}</span>;
  return (
    <MiniTable
      label={t('tdocs.f.name')}
      empty={t('tdocs.f.none')}
      columns={[
        { key: 'name', label: t('tdocs.f.name') },
        { key: 'type', label: t('tdocs.f.type') },
        { key: 'req', label: t('tdocs.f.req') },
        { key: 'c', label: t('tdocs.f.c') },
        { key: 'd', label: t('tdocs.f.d') },
      ]}
      rows={fields.map((f) => ({
        key: f.name,
        cells: {
          name: <span className={MONO_CLASS}>{f.name}</span>,
          type: <FieldType field={f} known={known} onSchema={onSchema} />,
          req: f.required ? t('tdocs.f.yes') : <span className={FAINT}>{t('tdocs.f.no')}</span>,
          c: f.constraints,
          d: f.description,
        },
        wide: ['d'],
        blank: [...(f.constraints ? [] : ['c']), ...(f.description ? [] : ['d'])],
      }))}
    />
  );
}

/** Шапка блока кода: подпись слева, «Копировать» справа (прототип `.td-code-h`). */
function CodeHead({
  t,
  children,
  onCopy,
}: {
  t: Translate;
  children: ReactNode;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      {children}
      <span className="flex-1" />
      <button type="button" className={buttonClass('default', 'sm')} onClick={onCopy}>
        <Icon name="copy" size="sm" />
        {t('tdocs.copy')}
      </button>
    </div>
  );
}

interface TabProps {
  t: Translate;
  card: AdminApiMethodCard;
  known: ReadonlySet<string>;
  onSchema: (name: string) => void;
  onCopy: (text: string) => void;
  /** Перейти на вкладку «Схема базы» по адресу её страницы. */
  onGo: (hash: string) => void;
}

/** «Запрос» (прототип tdReqHtml): параметры адреса и строки запроса, заголовки, тело с примером. */
function RequestTab({ t, card, known, onSchema, onCopy }: TabProps) {
  const { params, query, headers, body } = card.request;
  if (!params && !query && !headers && !body) {
    return <p className="m-0 text-muted">{t('tdocs.req.none')}</p>;
  }
  const part = (key: 'params' | 'query' | 'headers', p: typeof params) =>
    p ? (
      <>
        <h4 className={H4}>
          {t(`tdocs.req.${key}`)}
          {p.schema ? (
            <>
              {' · '}
              <span className={MONO_CLASS}>{p.schema}</span>
            </>
          ) : null}
        </h4>
        <FieldsTable t={t} fields={p.fields} known={known} onSchema={onSchema} />
      </>
    ) : null;
  return (
    <>
      {part('params', params)}
      {part('query', query)}
      {part('headers', headers)}
      {body ? (
        <>
          <h4 className={H4}>
            {t('tdocs.req.body')}
            {body.schema ? (
              <>
                {' · '}
                <span className={MONO_CLASS}>{body.schema}</span>
              </>
            ) : null}
            {body.contentType ? (
              <span className={`${FAINT} font-normal`}> {body.contentType}</span>
            ) : null}
          </h4>
          <FieldsTable t={t} fields={body.fields} known={known} onSchema={onSchema} />
          {body.example ? (
            <>
              <CodeHead t={t} onCopy={() => onCopy(body.example ?? '')}>
                <b>{t('tdocs.req.example')}</b>
              </CodeHead>
              <pre className="td-code" data-td-example="">
                {body.example}
              </pre>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/** «Ответы» (прототип tdResHtml): код, описание, схема; успешный ответ раскрыт. */
function ResponsesTab({ t, card, known, onSchema }: TabProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {card.responses.map((r) => (
        <details key={r.code} className="td-r" open={r.code.startsWith('2')}>
          <summary>
            <Pill size="sm" tone={responseTone(r.code)}>
              <span className={MONO_CLASS}>{r.code}</span>
            </Pill>
            <span className="min-w-0 flex-1">{r.description}</span>
            {r.schema ? <span className={`${MONO_CLASS} ${FAINT}`}>{r.schema}</span> : null}
          </summary>
          <div className="td-r-b">
            {r.fields ? (
              <FieldsTable t={t} fields={r.fields} known={known} onSchema={onSchema} />
            ) : (
              <span className={FAINT}>
                {t(r.schema ? 'tdocs.res.unparsed' : 'tdocs.res.noschema')}
              </span>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/** «Таблицы» (прототип tdTblHtml): что метод читает и что меняет, представления, «Показать на схеме». */
function TablesTab({ t, card, onGo }: TabProps) {
  const button = (x: { name: string; ru: string }) => (
    <button
      key={x.name}
      type="button"
      data-td-table={x.name}
      title={t('tdocs.tbl.open')}
      className="flex min-h-11 cursor-pointer items-center gap-[9px] rounded-lg border border-line bg-raised px-2.5 py-[7px] text-left text-ink hover:bg-row-hover"
      onClick={() => onGo(schemaHash.table(x.name))}
    >
      <Icon name="db" size="sm" />
      <span className="flex min-w-0 flex-col">
        <b className="text-[13px] font-semibold">{x.ru}</b>
        <span className={`${MONO_CLASS} ${FAINT} text-[11.5px]`}>{x.name}</span>
      </span>
    </button>
  );
  const column = (title: string, list: AdminApiMethodCard['reads']) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h4 className={H4}>{title}</h4>
      {list.length ? list.map(button) : <span className={FAINT}>—</span>}
    </div>
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
        {column(t('tdocs.tbl.reads', { n: card.reads.length }), card.reads)}
        {column(t('tdocs.tbl.writes', { n: card.writes.length }), card.writes)}
      </div>
      {card.views.length ? (
        <>
          <h4 className={H4}>{t('tdocs.tbl.views')}</h4>
          <ul className="td-ul">
            {card.views.map((v) => (
              <li key={v.name}>
                <code>app.{v.name}</code>
                {' — '}
                {t('tdocs.tbl.view', { tables: v.reads.join(', ') || '—' })}{' '}
                <span className={FAINT}>{t('tdocs.tbl.mig', { mig: v.migration })}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {card.reads.length || card.writes.length ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-td-show=""
            className={buttonClass('default', 'sm')}
            onClick={() => onGo(schemaHash.method(card.id))}
          >
            <Icon name="db" size="sm" />
            {t('tdocs.action.show')}
          </button>
          <Hint>{t('tdocs.tbl.show.hint')}</Hint>
        </div>
      ) : null}
    </>
  );
}

/** Функции продукта, которые задают контекст запроса (прототип TD_CTX). */
const CONTEXT_FN = {
  org: 'withOrgContext',
  user: 'withUserContext',
  admin: 'requirePlatformAdmin',
} as const;

/** «SQL» (прототип tdSqlHtml): контекст выполнения, функции базы, правила RLS, запросы метода. */
function SqlTab({ t, card, onCopy, onGo }: TabProps) {
  const contexts = [
    ...card.contexts.filter((c): c is 'org' | 'user' => c === 'org' || c === 'user'),
    ...(card.access === 'admin' ? (['admin'] as const) : []),
  ];
  return (
    <>
      <Box title={t('tdocs.sql.ctx')}>
        {contexts.length ? (
          <ul className="td-ul">
            {contexts.map((c) => (
              <li key={c}>
                <b>{t(`tdocs.sql.ctx.${c}`)}</b>
                {' — '}
                <span className={MONO_CLASS}>{CONTEXT_FN[c]}</span>
                {': '}
                {t(`tdocs.sql.ctx.${c}.text`)}
              </li>
            ))}
          </ul>
        ) : (
          <span className={FAINT}>{t('tdocs.sql.ctx.none')}</span>
        )}
        {card.functions.length ? (
          <>
            <h4 className={H4}>{t('tdocs.sql.fns')}</h4>
            <div className="flex flex-wrap gap-1.5">
              {card.functions.map((fn) => (
                <button
                  key={fn}
                  type="button"
                  data-td-fn={fn}
                  title={t('tdocs.sql.fn.open')}
                  className="cursor-pointer rounded-md border-0 bg-label-bg px-2 py-0.5 font-mono text-[11.5px] text-label hover:bg-row-hover"
                  onClick={() => onGo(schemaHash.fn(fn))}
                >
                  app.{fn}
                </button>
              ))}
            </div>
          </>
        ) : null}
        {card.rls.length ? (
          <details className="td-rls">
            <summary>{t('tdocs.sql.rls', { n: card.rls.length })}</summary>
            <ul className="td-ul">
              {card.rls.map((x) => (
                <li key={x.name}>
                  <b>{x.ru}</b> <code>{x.name}</code>
                  {' — '}
                  {x.rule || '—'}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Box>
      {card.queries.length ? (
        card.queries.map((q, i) => {
          const kind = queryKind(q.kind);
          return (
            <div key={i} data-td-query={kind.key} className="flex flex-col gap-1.5">
              <CodeHead t={t} onCopy={() => onCopy(q.text)}>
                <b>{i + 1}.</b>
                <span title={t(`tdocs.sql.kind.${kind.key}.title`)}>
                  <Pill size="sm" tone={kind.tone}>
                    {t(`tdocs.sql.kind.${kind.key}`)}
                  </Pill>
                </span>
                {card.filtered && kind.key !== 'view' ? (
                  <span title={t('tdocs.sql.filtered.title')}>
                    <Pill size="sm">{t('tdocs.sql.filtered')}</Pill>
                  </span>
                ) : null}
                <span className={`${MONO_CLASS} ${FAINT} text-[11.5px] [overflow-wrap:anywhere]`}>
                  {codePlace(q.file, q.line)} · {q.fn}
                </span>
              </CodeHead>
              <pre className="td-code">
                {kind.key === 'code'
                  ? q.text
                  : sqlTokens(q.text).map((x, j) =>
                      x.kind ? (
                        <i key={j} className={x.kind}>
                          {x.text}
                        </i>
                      ) : (
                        x.text
                      ),
                    )}
              </pre>
            </div>
          );
        })
      ) : (
        <p className="m-0 text-muted">{t('tdocs.sql.none')}</p>
      )}
    </>
  );
}

/** «Код» (прототип tdCodeHtml): файлы продукта на коммите снимка, ссылки открывают их на GitHub. */
function CodeTab({ t, card }: TabProps) {
  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-lg border border-line">
        {card.code.map((c, i) => {
          const href = codeHref(card.repo, card.commit, c.file, c.line);
          const inner = (
            <>
              <Icon name={c.db ? 'db' : 'code'} />
              <div className="min-w-0 flex-1">
                <div className={`${MONO_CLASS} [overflow-wrap:anywhere]`}>
                  {codePlace(c.file, c.line)}
                </div>
                <div className="text-[12px] text-muted">
                  {c.what} · <span className={MONO_CLASS}>{c.fn}</span>
                </div>
              </div>
              {href ? <Icon name="link" size="sm" /> : null}
            </>
          );
          const row =
            'flex items-center gap-2.5 border-b border-line bg-raised px-3 py-2 text-ink no-underline last:border-b-0';
          return href ? (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={t('tdocs.code.open')}
              className={`${row} hover:bg-row-hover`}
            >
              {inner}
            </a>
          ) : (
            <div key={i} className={row}>
              {inner}
            </div>
          );
        })}
      </div>
      <Hint>{t('tdocs.code.hint', { commit: card.commit })}</Hint>
    </>
  );
}

/** Доступ словами (прототип tdMethod): у метода с правом — названия прав. */
function accessLine(t: Translate, card: AdminApiMethodCard): string {
  if (card.access === 'perm') {
    return t('tdocs.card.acc.perm', { perms: card.permissions.map((p) => `«${p}»`).join(', ') });
  }
  const key = (['admin', 'public', 'employee'] as const).find((k) => k === card.access);
  return t(`tdocs.card.acc.${key ?? 'session'}`);
}

/** Метод и адрес из номера метода «GET /admin/users» — название окна, пока карточка грузится. */
function idParts(id: string): { method: string; path: string } {
  const at = id.indexOf(' ');
  return at > 0 ? { method: id.slice(0, at), path: id.slice(at + 1) } : { method: '', path: id };
}

/**
 * Окно полей схемы Zod (прототип tdSchemaDlg): ссылка на вложенную схему открывает её поверх —
 * «Готово» возвращает к прежней.
 */
function SchemaDialog({
  names,
  onClose,
  onSchema,
}: {
  names: readonly string[];
  onClose: () => void;
  onSchema: (name: string) => void;
}) {
  const t = useT();
  const name = names[names.length - 1] ?? '';
  const query = useQuery({ ...apiSchemaFieldsQuery(name), enabled: name !== '' });
  const known = useMemo(() => new Set(query.data?.schemas ?? []), [query.data]);
  return (
    <Modal
      open={names.length > 0}
      onClose={onClose}
      size="mid"
      title={<span className={MONO_CLASS}>{name}</span>}
      label={name}
      sub={t('tdocs.zod.sub')}
      footer={
        <>
          <div className="flex-1" />
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('btn.done')}
          </button>
        </>
      }
    >
      <div data-td-zod={name}>
        {query.isError ? <Note tone="bad">{t('tdocs.zod.load_error')}</Note> : null}
        {query.data ? (
          <FieldsTable t={t} fields={query.data.fields} known={known} onSchema={onSchema} />
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Вкладка карточки. Переход на страницу схемы закрывает окно: с другой вкладки модуля — как переход с
 * заменой записи истории (`leave`: «Назад» не вернёт к окну), на «Схеме базы» — обычным закрытием.
 */
function MethodTabs({
  tab,
  leaves,
  onGo,
  ...rest
}: Omit<TabProps, 't'> & { tab: MethodCardTab; leaves: boolean }) {
  const t = useT();
  const { close, leave } = useWindow();
  const props: TabProps = {
    ...rest,
    t,
    onGo: (hash) => {
      if (leaves) leave();
      else close();
      onGo(hash);
    },
  };
  return (
    <div data-td-tab={tab} className="flex min-w-0 flex-col gap-2.5">
      {tab === 'req' ? <RequestTab {...props} /> : null}
      {tab === 'res' ? <ResponsesTab {...props} /> : null}
      {tab === 'tbl' ? <TablesTab {...props} /> : null}
      {tab === 'sql' ? <SqlTab {...props} /> : null}
      {tab === 'code' ? <CodeTab {...props} /> : null}
    </div>
  );
}

/**
 * Карточка метода API (ТЗ «Админка» → «Техническая документация»; прототип v83 admin/techdocs.js,
 * tdMethod): вкладки «Запрос», «Ответы», «Таблицы», «SQL», «Код». Только просмотр: метод из Админки не
 * вызывается. Таблица, «Показать на схеме» и функция базы закрывают окно и ведут на вкладку «Схема
 * базы».
 */
function MethodCard({
  id,
  open,
  onClose,
  onGo,
  leaves,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onGo: (hash: string) => void;
  /** Переход на схему уводит на другую вкладку модуля (с заменой записи истории). */
  leaves: boolean;
}) {
  const t = useT();
  const [tab, setTab] = useState<MethodCardTab>('req');
  const [schemas, setSchemas] = useState<readonly string[]>([]);
  const query = useQuery(apiMethodCardQuery(id));
  const card = query.data;
  const copier = useCopyText();
  const known = useMemo(() => new Set(card?.schemas ?? []), [card]);
  const missing = query.error instanceof ApiFailure && query.error.status === 404;
  const head = card ? { method: card.method, path: card.path } : idParts(id);
  const counts: Partial<Record<MethodCardTab, number>> = card
    ? {
        res: card.responses.length,
        tbl: card.reads.length + card.writes.length,
        sql: card.queries.length,
        code: card.code.length,
      }
    : {};
  const tabs: CardTab[] = METHOD_CARD_TABS.map((k) => ({
    id: k,
    label: t(`tdocs.card.tab.${k}` as UiTextKey),
    icon: METHOD_TAB_ICONS[k],
    ...(counts[k] ? { count: { value: counts[k] } } : {}),
  }));
  const info: KeyValueItem[] = card
    ? [
        { id: 'sec', label: t('tdocs.card.section'), value: card.section },
        { id: 'acc', label: t('tdocs.card.access'), value: accessLine(t, card) },
        ...(card.rate ? [{ id: 'rate', label: t('tdocs.card.rate'), value: card.rate }] : []),
        ...(card.description
          ? [{ id: 'desc', label: t('tdocs.card.desc'), value: card.description, wide: true }]
          : []),
      ]
    : [];
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        kind="card"
        size="wide"
        label={id}
        title={
          <>
            {head.method ? <MethodBadge method={head.method} title /> : null}{' '}
            <span className={`${MONO_CLASS} text-[16px] font-semibold break-all`}>{head.path}</span>
          </>
        }
        sub={card?.summary}
        tabs={{
          items: tabs,
          active: tab,
          onSelect: (next) => setTab(next as MethodCardTab),
          label: t('tdocs.card.tabs'),
        }}
        footer={
          <>
            <Hint>{t('tdocs.card.readonly')}</Hint>
            <div className="flex-1" />
            <button type="button" className={buttonClass('cta')} onClick={onClose}>
              {t('btn.done')}
            </button>
          </>
        }
      >
        <div data-td-method={id} className="flex min-w-0 flex-col gap-2.5">
          {query.isError ? (
            <Note tone="bad">{t(missing ? 'tdocs.card.none' : 'tdocs.card.load_error')}</Note>
          ) : null}
          {card ? (
            <>
              <KeyValues items={info} />
              <MethodTabs
                tab={tab}
                card={card}
                known={known}
                leaves={leaves}
                onSchema={(name) => setSchemas((list) => [...list, name])}
                onCopy={(text) => void copier.copy(text, t('tdocs.copied'))}
                onGo={onGo}
              />
            </>
          ) : null}
        </div>
      </Modal>
      <SchemaDialog
        names={open ? schemas : []}
        onClose={() => setSchemas((list) => list.slice(0, -1))}
        onSchema={(name) => setSchemas((list) => [...list, name])}
      />
      {copier.node}
    </>
  );
}

/**
 * Карточка метода для экрана: `open(id)` открывает её (новая карточка заменяет открытую, прототип:
 * закрыть окна `td`), `node` ставится в разметку экрана. `onGo` — переход на страницу схемы (окно при
 * этом закрывается); `leaves` — переход уводит на другую вкладку модуля.
 */
export function useMethodCard(onGo: (hash: string) => void, leaves: boolean) {
  const [slot, setSlot] = useState<DialogSlot<string> | null>(null);
  const open = useCallback((id: string) => setSlot(openSlot(id)), []);
  const close = useCallback(() => setSlot(closeSlot), []);
  const node = slot ? (
    <MethodCard
      key={`method-${slot.n}`}
      id={slot.data}
      open={slot.open}
      onClose={close}
      onGo={onGo}
      leaves={leaves}
    />
  ) : null;
  return { open, close, isOpen: slot?.open ?? false, node };
}
