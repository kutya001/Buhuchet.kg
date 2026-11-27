'use client';

import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { bracketMatching } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import { Compartment, EditorState, Prec, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  hoverTooltip,
  keymap,
  lineNumbers,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  dmSqlNoAliasMarks,
  dmSqlQuickMarks,
  type DmSqlMark,
  type UiTextKey,
} from '@buhuchet/domain';
import type { DmConsoleProblem } from '@buhuchet/shared';
import type { FieldControl } from '@buhuchet/ui';
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import {
  assistAt,
  fieldIsMoney,
  hoverAt,
  schemaMarks,
  type AssistTexts,
  type HoverTarget,
  type SchemaIndex,
  type SchemaMark,
} from './console-assist';
import { sqlTokens } from './sql-highlight';
import './sql-editor.css';

/** Что редактор даёт экрану: выделение, текст и правка (консоль: «Выполнить», «Форматировать»). */
export interface SqlEditorApi {
  selection(): { from: number; to: number };
  replace(from: number, to: number, text: string): void;
  focus(): void;
}

/** Проверка по ходу набора на сервере (разборщик PostgreSQL); ничего не выполняет. */
export type SqlCheck = (query: string) => Promise<DmConsoleProblem[]>;

/** Ошибка текста для списка под редактором: строка и причина словами. */
interface Problem {
  from: number;
  line: number;
  message: string;
}

// Тексты быстрой проверки — как у прототипа (`dmcIssues`); комментарий прототип не проверяет.
const QUICK_KEY: Record<DmSqlMark['code'], UiTextKey> = {
  unclosed_string: 'dm.con.q.unclosed',
  unclosed_quoted: 'dm.con.q.unclosed',
  unclosed_comment: 'err.dm_sql_unclosed',
  unclosed_paren: 'dm.con.q.paren',
  extra_paren: 'dm.con.q.extra',
};

const schemaMarkText = (t: Translate, m: SchemaMark) =>
  m.code === 'no_table'
    ? t('dm.con.no_table', { table: m.table })
    : m.code === 'no_field'
      ? t('dm.con.no_field', { field: m.field ?? '', table: m.table })
      : t('dm.con.org_closed', { table: m.table });

/** Подсветка тем же разбором, что поле шаблона до 27.11 (`sqlTokens`): тот же цвет и метки `data-sql`. */
const MARKS = Object.fromEntries(
  (['keyword', 'table', 'param', 'string', 'number', 'comment'] as const).map((k) => [
    k,
    Decoration.mark({ class: `dmsql-${k}`, attributes: { 'data-sql': k } }),
  ]),
);

function paint(text: string): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  let at = 0;
  for (const tok of sqlTokens(text)) {
    const mark = tok.kind === 'plain' ? undefined : MARKS[tok.kind];
    if (mark && tok.text) b.add(at, at + tok.text.length, mark);
    at += tok.text.length;
  }
  return b.finish();
}

const highlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = paint(view.state.doc.toString());
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = paint(u.state.doc.toString());
    }
  },
  { decorations: (v) => v.decorations },
);

/** Карточка таблицы или поля при наведении (прототип `dmcCard`, `dmcFieldCard`): только текстом. */
function hoverDom(
  t: Translate,
  target: HoverTarget,
  index: SchemaIndex,
  onSchema: ((table: string) => void) | undefined,
): HTMLElement {
  const el = (tag: string, cls?: string, text?: string) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const box = el('div', 'dmsql-card');
  box.dataset.dmConCard =
    target.kind === 'field' ? `${target.table.name}.${target.field.name}` : target.table.name;
  const head = el('div', 'dmsql-card-head');
  const tag = (text: string) => head.append(' ', el('span', 'dmsql-tag', text));
  const desc = (text: string | null) =>
    box.append(
      text
        ? el('p', undefined, text.length > 260 ? `${text.slice(0, 260)}…` : text)
        : el('p', 'dmsql-faint', t('dm.con.no_desc')),
    );
  if (target.kind === 'field') {
    const f = target.field;
    head.append(
      el('b', undefined, f.title || f.name),
      ' ',
      el('span', 'dmsql-mono dmsql-faint', `${target.table.name}.${f.name}`),
    );
    tag(f.type);
    if (fieldIsMoney(f)) tag(t('dm.con.money_tag'));
    if (!target.table.orgVisible) tag(t('dm.con.closed'));
    box.append(head);
    desc(f.description);
    if (f.ref) box.append(el('div', 'dmsql-rel dmsql-mono', `→ ${f.ref.table}.${f.ref.field}`));
  } else {
    const tb = target.table;
    head.append(
      el('b', undefined, tb.title || tb.name),
      ' ',
      el('span', 'dmsql-mono dmsql-faint', tb.name),
    );
    if (!tb.orgVisible) tag(t('dm.con.closed'));
    box.append(head);
    desc(tb.description);
    const out = tb.fields
      .filter((f) => f.ref)
      .map((f) => t('dm.con.ref_by', { table: f.ref!.table, field: f.name }));
    const inc = index.incoming.get(tb.name) ?? [];
    const lines = [...out, ...inc.slice(0, 6).map((x) => `← ${x.table}.${x.field}`)];
    if (inc.length > 6) lines.push(t('dm.con.more_refs', { n: inc.length - 6 }));
    if (lines.length) {
      const rel = el('div', 'dmsql-rel dmsql-mono');
      lines.forEach((l, i) => {
        if (i) rel.append(el('br'));
        rel.append(l);
      });
      box.append(rel);
    }
  }
  if (onSchema) {
    const btn = el('button', 'dmsql-link', t('dm.con.schema')) as HTMLButtonElement;
    btn.type = 'button';
    btn.dataset.dmConSchema = target.table.name;
    btn.addEventListener('click', () => onSchema(target.table.name));
    box.append(btn);
  }
  return box;
}

/**
 * Редактор запроса «Витрины данных» на CodeMirror 6 (доработки 27.11.2026: консоль запросов, блок 3;
 * этап 1, П5; прототип v166 `dmcAssist`): подсветка и номера строк — как у прежнего поля шаблона,
 * подсказки по карте базы (Ctrl+Пробел — вручную; Enter и Tab — вставить, Esc — закрыть), карточка
 * таблицы и поля при наведении, ошибки по ходу набора подчёркнуты и списком под полем: кавычки и
 * скобки — сразу, неизвестные таблицы и поля — по карте, остальное — проверкой на сервере через
 * ~500 мс после набора (разборщик в браузер не идёт). Ctrl+Enter — `onRun`. Стоит и в консоли, и в
 * окне шаблона вместо `SqlField`: значение — обычная строка, как раньше.
 */
export function SqlEditor({
  control,
  value,
  onChange,
  readOnly = false,
  maxLength,
  schema,
  org = false,
  check,
  onRun,
  onSchema,
  apiRef,
  label,
  tall = false,
}: {
  control?: FieldControl;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  maxLength?: number;
  /** Карта базы для подсказок; нет — только подсветка и проверка. */
  schema?: SchemaIndex | null;
  /** Шаблон «Для организаций»: таблицы, закрытые роли организаций, — ошибкой. */
  org?: boolean;
  check?: SqlCheck;
  onRun?: () => void;
  onSchema?: (table: string) => void;
  apiRef?: Ref<SqlEditorApi | null>;
  label?: string;
  /** Консоль: поле выше. */
  tall?: boolean;
}) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  // Обработчики и знания — в ссылке: расширения редактора создаются один раз.
  const live = useRef({ onChange, onRun, onSchema, schema, org, check, t, maxLength });
  useLayoutEffect(() => {
    live.current = { onChange, onRun, onSchema, schema, org, check, t, maxLength };
  });
  const ro = useMemo(() => new Compartment(), []);
  const attrs = useMemo(() => new Compartment(), []);

  const contentAttrs = useMemo(
    () => ({
      'data-dm-ed-query': '',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocorrect: 'off',
      'aria-multiline': 'true',
      ...(control?.id ? { id: control.id } : {}),
      ...(control?.['aria-describedby'] ? { 'aria-describedby': control['aria-describedby'] } : {}),
      ...(control?.['aria-invalid'] ? { 'aria-invalid': 'true' } : {}),
      ...(control?.['aria-required'] ? { 'aria-required': 'true' } : {}),
      ...(label ? { 'aria-label': label } : {}),
    }),
    [control, label],
  );

  useEffect(() => {
    const texts = (): AssistTexts => {
      const tr = live.current.t;
      return {
        noDesc: tr('dm.con.no_desc'),
        money: tr('dm.con.money'),
        closed: tr('dm.con.closed'),
        keyword: tr('dm.con.kw'),
        join: tr('dm.con.join'),
        alias: (table) => tr('dm.con.alias', { table }),
        fn: (name) => tr(`dm.con.fn.${name}` as UiTextKey),
      };
    };
    const complete = (ctx: CompletionContext): CompletionResult | null => {
      const index = live.current.schema;
      if (!index) return null;
      const got = assistAt(ctx.state.doc.toString(), ctx.pos, index, texts(), {
        force: ctx.explicit,
        org: live.current.org,
      });
      if (!got) return null;
      const typed = ctx.state.doc.sliceString(got.from, ctx.pos).toLowerCase();
      const items = ctx.explicit
        ? got.items
        : got.items.filter((x) => x.apply.toLowerCase() !== typed);
      if (!items.length) return null;
      return {
        from: got.from,
        // Свой порядок и поиск по-русски: CodeMirror список не пересортировывает и не отсеивает.
        filter: false,
        options: items.map<Completion>((x, i) => ({
          label: x.label,
          detail: x.detail,
          apply: x.apply,
          type: x.type === 'field' ? 'property' : x.type === 'table' ? 'class' : x.type,
          boost: -i,
        })),
      };
    };
    const lint = async (v: EditorView): Promise<Diagnostic[]> => {
      const text = v.state.doc.toString();
      const tr = live.current.t;
      const diags: Diagnostic[] = [];
      const push = (from: number, to: number, message: string) =>
        diags.push({
          from,
          to: Math.min(Math.max(to, from + 1), text.length),
          severity: 'error',
          message,
        });
      const quick = dmSqlQuickMarks(text);
      for (const m of quick) push(m.from, m.to, tr(QUICK_KEY[m.code]));
      const index = live.current.schema;
      if (!quick.length && index) {
        for (const m of schemaMarks(text, index, { org: live.current.org }))
          push(m.from, m.to, schemaMarkText(tr, m));
      }
      if (!quick.length) {
        for (const m of dmSqlNoAliasMarks(text)) push(m.from, m.to, tr('dm.con.q.no_alias'));
      }
      const server = live.current.check;
      if (!quick.length && server && text.trim()) {
        try {
          for (const p of await server(text)) push(p.from, p.to, p.message);
        } catch {
          // Проверка не ответила: подчёркивать нечем, «Выполнить» скажет сама.
        }
      }
      // Ответ к прежнему тексту не нужен: CodeMirror сам его отбросит, список — тоже.
      if (v.state.doc.toString() === text) {
        diags.sort((a, b) => a.from - b.from);
        setProblems(
          diags.slice(0, 5).map((d) => ({
            from: d.from,
            line: v.state.doc.lineAt(Math.min(d.from, text.length)).number,
            message: d.message,
          })),
        );
      }
      return diags;
    };
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        sql({ dialect: PostgreSQL }),
        highlight,
        EditorView.lineWrapping,
        ro.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        attrs.of(EditorView.contentAttributes.of(contentAttrs)),
        autocompletion({
          override: [complete],
          activateOnTyping: true,
          icons: false,
          maxRenderedOptions: 40,
        }),
        linter(lint, { delay: 500 }),
        hoverTooltip((v, pos) => {
          const index = live.current.schema;
          if (!index) return null;
          const target = hoverAt(v.state.doc.toString(), pos, index);
          if (!target) return null;
          return {
            pos: target.from,
            end: target.to,
            above: false,
            create: () => ({ dom: hoverDom(live.current.t, target, index, live.current.onSchema) }),
          };
        }),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                live.current.onRun?.();
                return !!live.current.onRun;
              },
            },
            { key: 'Tab', run: acceptCompletion },
            { key: 'Mod-Space', run: startCompletion },
            { key: 'Ctrl-Space', run: startCompletion },
            { key: 'Escape', run: closeCompletion },
          ]),
        ),
        keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
        EditorState.transactionFilter.of((tr) => {
          const max = live.current.maxLength;
          return max && tr.docChanged && tr.newDoc.length > max ? [] : tr;
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) live.current.onChange?.(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current! });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Редактор создаётся один раз; значение, «только чтение» и подписи меняются ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Значение сменили снаружи («Форматировать», «Открыть в консоли», «Перечитать») — заменить текст.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc.toString();
    if (doc !== value) v.dispatch({ changes: { from: 0, to: doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: ro.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly, ro]);

  useEffect(() => {
    view.current?.dispatch({
      effects: attrs.reconfigure(EditorView.contentAttributes.of(contentAttrs)),
    });
  }, [contentAttrs, attrs]);

  useImperativeHandle(
    apiRef,
    () => ({
      selection: () => {
        const r = view.current?.state.selection.main;
        return r ? { from: r.from, to: r.to } : { from: 0, to: 0 };
      },
      replace: (from, to, text) => {
        const v = view.current;
        if (!v) return;
        v.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from, head: from + text.length },
        });
        v.focus();
      },
      focus: () => view.current?.focus(),
    }),
    [],
  );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        ref={host}
        className={`dmsql min-w-0 ${tall ? 'dmsql-tall' : ''} ${readOnly ? 'dmsql-ro' : ''}`}
        data-dm-ed-sql=""
      />
      {problems.length ? (
        <ul
          className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px] text-danger"
          data-dm-con-errs=""
        >
          {problems.map((p, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-left text-danger hover:underline"
                onClick={() => {
                  const v = view.current;
                  if (!v) return;
                  v.dispatch({ selection: { anchor: p.from }, scrollIntoView: true });
                  v.focus();
                }}
              >
                {t('dm.con.err_line', { n: p.line, error: p.message })}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
