'use client';

import {
  RD_MAX_BYTES,
  RD_MAX_FILES,
  type PhoneCodeOption,
  type RdKey,
  type RdKind,
} from '@buhuchet/domain';
import { FileUploadTicket, RegdocsRecognized, type RegdocsResult } from '@buhuchet/shared';
import {
  BetaBadge,
  buttonClass,
  Icon,
  iconButtonClass,
  linkButtonClass,
  MONO_CLASS,
  Modal,
  Note,
  Pill,
  pillClass,
  type FieldMark,
} from '@buhuchet/ui';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { fileSizeText } from '../files/files-data';
import { useErrorText, useT } from '../l10n/provider';
import type { ContractorDraft } from './contractor-form-model';
import {
  altValueText,
  docsText,
  needs,
  RD_FIELDS,
  rdDateText,
  regdocsSummary,
  sourceOf,
  sourceText,
  type RdField,
  type RdNeed,
  type RegdocsPrefill,
  type RegdocsState,
} from './contractor-regdocs-model';

/*
 * «Новый контрагент из свидетельства и выписки» (Бета; ТЗ «Создание контрагента из свидетельства и
 * выписки (Бета)»; прототип modules/contractor-regdocs.js — regDocsDlg, rdRun, rdHead, rdGkBox, rdMarks):
 * окно загрузки PDF и «Распознать», сводка над заполненной формой, подсказки ГКЭД и подписи у полей.
 * PDF кладётся в хранилище, читает и распознаёт его сервер; файлы прикрепятся к контрагенту при
 * сохранении формы.
 */

type RowState = 'new' | 'busy' | 'ok' | 'bad';

/** Файл в окне (прототип `st.files`): `local` — не PDF или больше 10 МБ, на сервер не уходит. */
interface Row {
  key: number;
  file: File;
  /** Имя в хранилище и в «Файлах» контрагента: у PDF без расширения — с «.pdf». */
  name: string;
  state: RowState;
  msg: string;
  local: boolean;
  id?: string;
  kind?: RdKind | null;
  issued?: string;
}

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

/** Контрагент с тем же ИНН (прототип rdRun, `dup`): вне области сотрудника — без номера, как в форме. */
interface Duplicate {
  inn: string;
  id: string | null;
  name: string;
  archived: boolean;
}

export function RegdocsDialog({
  open,
  onClose,
  onFill,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  /** Распознано или «Заполнить вручную»: форма «Новый контрагент» из документов. */
  onFill: (pre: RegdocsPrefill) => void;
  /** «Открыть» контрагента с тем же ИНН. */
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [rows, setRows] = useState<Row[]>([]);
  const current = useRef<Row[]>([]);
  const seq = useRef(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [dup, setDup] = useState<{ d: Duplicate; open: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const commit = (next: Row[]) => {
    current.current = next;
    setRows(next);
  };
  const patch = (keys: readonly number[], p: Partial<Row>) =>
    commit(current.current.map((r) => (keys.includes(r.key) ? { ...r, ...p } : r)));

  const addFiles = (list: FileList | null) => {
    if (!list || busy) return;
    const next = [...current.current];
    for (const f of Array.from(list)) {
      if (next.some((x) => x.file.name === f.name && x.file.size === f.size)) continue;
      const bad = !isPdf(f) || f.size > RD_MAX_BYTES;
      // ОТКЛОНЕНИЕ: docs/deviations.md#А-10 — в прототипе число файлов не ограничено.
      const many = !bad && next.filter((x) => !x.local).length >= RD_MAX_FILES;
      next.push({
        key: ++seq.current,
        file: f,
        name: /\.pdf$/i.test(f.name) ? f.name : `${f.name}.pdf`,
        state: bad || many ? 'bad' : 'new',
        msg: bad ? t('cp.rd.err.size') : many ? t('cp.rd.err.many', { n: RD_MAX_FILES }) : '',
        local: bad || many,
      });
    }
    commit(next);
    setErr('');
  };

  /** Начать загрузку на сервере и положить файл в хранилище по подписанной ссылке. */
  const upload = async (r: Row): Promise<{ id: string } | { error: string }> => {
    const started = await callApi(() =>
      api.api.contractors.regdocs.uploads.$post({ json: { name: r.name, size: r.file.size } }),
    );
    if (!started.ok) {
      return {
        error:
          started.error.code === 'regdocs_file' ? t('cp.rd.err.size') : errorText(started.error),
      };
    }
    const ticket = FileUploadTicket.parse(started.data);
    try {
      const put = await fetch(ticket.upload.url, {
        method: ticket.upload.method,
        headers: ticket.upload.headers,
        body: r.file,
      });
      if (!put.ok) return { error: t('cp.rd.err.upload') };
    } catch {
      return { error: t('cp.rd.err.upload') };
    }
    return { id: ticket.id };
  };

  /** Загрузить ещё не загруженные; не загрузившийся получает ошибку. */
  const uploadAll = async (todo: readonly Row[]) => {
    for (const r of todo) {
      if (r.id) continue;
      const res = await upload(r);
      if ('id' in res) patch([r.key], { id: res.id });
      else patch([r.key], { state: 'bad', msg: res.error, kind: null });
    }
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    const todo = current.current.filter((r) => !r.local);
    patch(
      todo.map((r) => r.key),
      { state: 'busy', msg: '' },
    );
    await uploadAll(todo);
    const sent = current.current.filter((r) => !r.local && r.id && r.state === 'busy');
    if (!sent.length) {
      setBusy(false);
      setErr(current.current.length ? t('cp.rd.err.none') : '');
      return;
    }
    const res = await callApi(() =>
      api.api.contractors.regdocs.recognize.$post({ json: { files: sent.map((r) => r.id!) } }),
    );
    setBusy(false);
    if (!res.ok) {
      patch(
        sent.map((r) => r.key),
        { state: 'new' },
      );
      setErr(errorText(res.error));
      return;
    }
    const out = RegdocsRecognized.parse(res.data);
    for (const f of out.files) {
      const r = sent.find((x) => x.id === f.id);
      if (!r) continue;
      patch(
        [r.key],
        f.state === 'ok'
          ? { state: 'ok', kind: f.kind, issued: f.issued, msg: '' }
          : { state: 'bad', kind: null, msg: t(`cp.rd.err.${f.error ?? 'read'}`) },
      );
    }
    if (out.error === 'same') {
      const kind = t(`cp.rd.kind.${out.sameKind ?? 'svid'}`).toLocaleLowerCase('ru');
      setErr(t('cp.rd.err.same', { kind }));
      return;
    }
    if (out.error === 'diff') return setErr(t('cp.rd.err.diff'));
    if (out.error === 'none' || !out.result) return setErr(t('cp.rd.err.none'));
    if (out.duplicate) return setDup({ d: out.duplicate, open: true });
    const ok = current.current.filter((r) => r.state === 'ok' && r.id && r.kind);
    onFill({
      files: ok.map((r) => ({ id: r.id!, name: r.name })),
      result: out.result,
      docs: ok.map((r) => ({ kind: r.kind!, issued: r.issued ?? '' })),
    });
  };

  // «Заполнить вручную» (прототип `rd-man`): форма без распознавания; загруженные файлы прикрепятся.
  const manual = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    const todo = current.current.filter((r) => !r.local);
    const fresh = todo.filter((r) => !r.id && r.state !== 'bad');
    patch(
      fresh.map((r) => r.key),
      { state: 'busy' },
    );
    // Форма открывается всегда, как в прототипе: прикрепятся те, что загрузились.
    await uploadAll(todo);
    patch(
      current.current.filter((r) => r.state === 'busy').map((r) => r.key),
      { state: 'new' },
    );
    setBusy(false);
    onFill({
      files: current.current
        .filter((r) => !r.local && r.id)
        .map((r) => ({ id: r.id!, name: r.name })),
      result: null,
      docs: [],
    });
  };

  const drop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer.files);
  };

  const label = (r: Row) =>
    r.state === 'ok' && r.kind ? (
      <Pill tone="ok" size="sm" icon="check">
        {r.issued
          ? t('cp.rd.state.ok_date', {
              kind: t(`cp.rd.kind.${r.kind}`),
              date: rdDateText(r.issued),
            })
          : t(`cp.rd.kind.${r.kind}`)}
      </Pill>
    ) : r.state === 'bad' ? (
      <Pill tone="bad" size="sm" icon="alert">
        {t('cp.rd.state.bad')}
      </Pill>
    ) : (
      <span
        className={`${pillClass('sm')} bg-faint-pill-bg text-label shadow-[inset_0_0_0_1px_var(--bu-border)]`}
      >
        {t(r.state === 'busy' ? 'cp.rd.state.busy' : 'cp.rd.state.new')}
      </span>
    );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        kind="form"
        size="mid"
        dirty={rows.length > 0}
        title={
          <>
            {t('cp.rd.title')} <BetaBadge label={t('cp.rd.beta')} />
          </>
        }
        sub={t('cp.rd.sub')}
        footer={
          <>
            <button type="button" className={buttonClass('ghost')} onClick={onClose}>
              {t('btn.cancel')}
            </button>
            <button
              type="button"
              className={buttonClass('default')}
              disabled={busy}
              data-rd-manual=""
              onClick={() => void manual()}
            >
              {t('cp.rd.manual')}
            </button>
            <button
              type="button"
              className={buttonClass('cta')}
              disabled={busy || !rows.some((r) => r.state !== 'bad')}
              data-rd-go=""
              onClick={() => void run()}
            >
              {t(busy ? 'cp.rd.going' : 'cp.rd.go')}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3.5" data-rd="">
          {/* у «Бета-версии» снизу ещё 10 точек (прототип `.note.beta`) */}
          <div className="mb-2.5">
            <BetaNote />
          </div>
          <label
            tabIndex={0}
            className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed px-4 py-[22px] text-center outline-none ${over ? 'border-accent text-ink' : 'border-line bg-pane-alt text-muted hover:border-accent hover:text-ink focus-visible:border-accent focus-visible:text-ink'}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                input.current?.click();
              }
            }}
            data-rd-drop=""
          >
            <Icon name="upload" size="lg" />
            <span>
              <b>{t('cp.rd.drop')}</b> {t('cp.rd.drop_or')}
            </span>
            <span className="text-[11.5px] leading-[1.4] text-faint">{t('cp.rd.drop_hint')}</span>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              data-rd-input=""
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {rows.length ? (
            <ul className="m-0 mt-2.5 flex list-none flex-col p-0" data-rd-files="">
              {rows.map((r) => (
                <li
                  key={r.key}
                  data-rd-file={r.state}
                  className="flex min-w-0 items-center gap-2.5 border-b border-line px-0.5 py-[9px] last:border-b-0 hover:bg-row-hover"
                >
                  <Icon name="file" className="flex-none text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink">{r.file.name}</div>
                    <div className="truncate text-xs text-faint">
                      {fileSizeText(t, r.file.size)}
                      {r.msg ? (
                        <>
                          {' · '}
                          <span className="text-danger">{r.msg}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {label(r)}
                  <button
                    type="button"
                    className={iconButtonClass('sm')}
                    disabled={busy}
                    aria-label={t('cp.rd.remove', { name: r.file.name })}
                    title={t('cp.rd.remove_title')}
                    onClick={() => {
                      commit(current.current.filter((x) => x.key !== r.key));
                      setErr('');
                    }}
                  >
                    <Icon name="trash" size="sm" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {err ? (
            <div className="mt-2.5">
              <Note tone="bad" alert>
                <span data-rd-err="">{err}</span>
              </Note>
            </div>
          ) : null}
          <div className="mt-2.5 text-[11.5px] leading-[1.4] text-faint">{t('cp.rd.hint')}</div>
        </div>
      </Modal>
      {dup ? (
        <Modal
          open={dup.open}
          onClose={() => setDup({ ...dup, open: false })}
          kind="message"
          title={t('cp.rd.dup.title')}
          footer={
            <>
              <button
                type="button"
                className={buttonClass('ghost')}
                onClick={() => setDup({ ...dup, open: false })}
              >
                {t('btn.cancel')}
              </button>
              {/* ОТКЛОНЕНИЕ: docs/deviations.md#А-10 — контрагент вне области сотрудника не открывается. */}
              {dup.d.id ? (
                <button
                  type="button"
                  className={buttonClass('cta')}
                  data-rd-dup-open=""
                  onClick={() => {
                    setDup({ ...dup, open: false });
                    onOpen(dup.d.id!);
                  }}
                >
                  {t('cp.rd.dup.open')}
                </button>
              ) : null}
            </>
          }
        >
          <p className="m-0 leading-[1.55] text-muted" data-rd-dup="">
            {t(dup.d.archived ? 'cp.rd.dup.text_archived' : 'cp.rd.dup.text', {
              inn: dup.d.inn,
              name: dup.d.name,
            })}
          </p>
        </Modal>
      ) : null}
    </>
  );
}

/** «Бета-версия. Распознавание … может работать неточно» (прототип RD_BETA). */
export function BetaNote() {
  const t = useT();
  return (
    <Note tone="beta">
      <b>{t('cp.rd.beta_note.lead')}</b> {t('cp.rd.beta_note')}
    </Note>
  );
}

/**
 * Заметки над заполненной формой (прототип addCpDlg, rdHead): «Бета-версия», «Юрлицо прекращено»,
 * сводка распознавания и какие файлы прикрепятся. У «Заполнить вручную» — только «Бета-версия» и файлы.
 */
export function RegdocsHead({ pre, st }: { pre: RegdocsPrefill; st: RegdocsState | null }) {
  const t = useT();
  const res = pre.result;
  const sum = res && st ? regdocsSummary(st, res, t) : null;
  return (
    <div className="mb-2.5 flex flex-col gap-6" data-rd-head="">
      <BetaNote />
      {res?.stopped ? (
        <Note tone="bad">
          <b>
            {res.status ? t('cp.rd.stopped_status', { status: res.status }) : t('cp.rd.stopped')}
          </b>{' '}
          {t('cp.rd.stopped_tail')}
        </Note>
      ) : null}
      {res && sum ? (
        <Note icon="file">
          <span data-rd-sum="">
            {t('cp.rd.sum.docs', { docs: docsText(pre.docs, t) })} {t('cp.rd.sum.filled')}{' '}
            <b>{sum.filled}</b>
            {sum.check ? (
              <>
                {' · '}
                {t('cp.rd.sum.check')} <b>{sum.check}</b>
              </>
            ) : null}
            {'. '}
            {sum.miss.length ? `${t('cp.rd.sum.miss', { list: sum.miss.join(', ') })} ` : ''}
            {t('cp.rd.sum.manual')}
            {sum.warn.length ? (
              <>
                <br />
                {t('cp.rd.sum.warn', { list: sum.warn.join('; ') })}
              </>
            ) : null}
          </span>
        </Note>
      ) : null}
      {pre.files.length ? (
        <Note icon="clip">
          <span data-rd-attach="">
            {t('cp.rd.files', { list: pre.files.map((f) => f.name).join(', ') })}
          </span>
        </Note>
      ) : null}
    </div>
  );
}

/**
 * Подсказки ГКЭД под основным видом деятельности (прототип rdGkBox): код и текст из документа; код не
 * нижнего уровня — выбор подкласса; кода нет — до 5 похожих видов деятельности.
 */
export function RegdocsGkedBox({
  gk,
  current,
  onPick,
}: {
  gk: NonNullable<RegdocsResult['gk']>;
  current: string;
  onPick: (value: { code: string; name: string }) => void;
}) {
  const t = useT();
  const src = gk.raw ? (
    <>
      {t('cp.rd.gk.doc')} <b className={MONO_CLASS}>{gk.raw}</b>
      {gk.text ? ` — ${gk.text}` : ''}
    </>
  ) : gk.text ? (
    `${t('cp.rd.gk.doc')} ${gk.text}`
  ) : null;
  const pick = gk.choose.length > 0 && !current;
  const like = !gk.code && !gk.choose.length && gk.like.length > 0 && !current;
  return (
    <div className="col-span-full -mt-1.5 flex min-w-0 flex-col gap-[5px]" data-rd-gk="">
      <div className="text-[11.5px] leading-[1.4] text-faint">
        {src}
        {current && gk.code && current === gk.code ? ` · ${t('cp.rd.gk.found')}` : ''}
      </div>
      {pick ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] leading-[1.4] text-faint">
            {t('cp.rd.gk.choose', { code: gk.raw })}
          </span>
          {gk.choose.map((c) => (
            <button
              key={c.code}
              type="button"
              // В прототипе `.btn.xs` — без своего размера, обычная кнопка.
              className={buttonClass('default')}
              title={c.name}
              data-rd-gk-pick={c.code}
              onClick={() => onPick(c)}
            >
              {c.code}
            </button>
          ))}
        </div>
      ) : null}
      {like ? (
        <div className="mt-1.5">
          <span className="text-[11.5px] leading-[1.4] text-faint">{t('cp.rd.gk.like')}</span>
          <div className="mt-1 flex flex-col">
            {gk.like.map((c) => (
              <button
                key={c.code}
                type="button"
                data-rd-gk-pick={c.code}
                className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 border-0 border-b border-line bg-transparent px-0.5 py-[9px] text-left last:border-b-0 hover:bg-row-hover"
                onClick={() => onPick(c)}
              >
                <span className={`${MONO_CLASS} font-semibold text-ink`}>{c.code}</span>
                <span className="min-w-0 grow">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Строка подписи под полем (прототип `.src-l`, `.need-l`, `.alt-l`). */
function MarkLine({
  tone,
  data,
  children,
}: {
  tone: 'src' | 'need' | 'alt';
  data: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <div
      {...data}
      className={`mt-0.5 flex items-start gap-[5px] text-[11.5px] leading-[1.4] ${tone === 'src' ? 'text-info' : tone === 'need' ? 'font-semibold text-caution-label' : 'text-caution-label'}`}
    >
      <Icon name={tone === 'src' ? 'file' : 'alert'} size="sm" className="mt-px flex-none" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/**
 * Подписи полей заполненной формы (прототип rdMarks): откуда значение — пока оно равно значению
 * документа; «Заполните вручную» с оранжевой рамкой; расхождение документов с «взять это».
 */
export function regdocsMarks(o: {
  st: RegdocsState;
  d: ContractorDraft;
  codes: readonly PhoneCodeOption[];
  reports: number;
  fee: boolean;
  /** id поля формы по реквизиту или обязательному полю. */
  fieldOf: (k: RdField | RdNeed) => string;
  formName: (code: string) => string;
  t: ReturnType<typeof useT>;
  onTake: (k: RdKey, i: number) => void;
}): (id: string) => FieldMark | null {
  const { st, d, codes, t } = o;
  const marks = new Map<string, { src?: ReactNode; need?: boolean; alt?: ReactNode }>();
  const at = (k: RdField | RdNeed) => {
    const id = o.fieldOf(k);
    const m = marks.get(id) ?? {};
    marks.set(id, m);
    return m;
  };
  for (const k of [...RD_FIELDS, 'gked'] as const) {
    const s = sourceOf(st, d, k, codes);
    if (s) {
      at(k).src = (
        <MarkLine tone="src" data={{ 'data-rd-src': s }}>
          {t(sourceText(s))}
        </MarkLine>
      );
    }
  }
  for (const k of needs(st, d, { reports: o.reports, fee: o.fee })) at(k).need = true;
  for (const [k, list] of Object.entries(st.alt) as [
    RdKey,
    NonNullable<RegdocsState['alt'][RdKey]>,
  ][]) {
    at(k).alt = (
      <MarkLine tone="alt" data={{ 'data-rd-alt': k }}>
        {t('cp.rd.alt')}{' '}
        {list.map((x, i) => (
          <span key={`${x.src}-${i}`}>
            {i ? '; ' : ''}
            {t(`cp.rd.alt.${x.src}`)}
            {x.date ? ` ${t('cp.rd.alt.from', { date: rdDateText(x.date) })}` : ''} — «
            {altValueText(k, x.v, t, { codes, formName: o.formName })}»
            {i ? (
              <>
                {' '}
                <button
                  type="button"
                  className={linkButtonClass()}
                  data-rd-take={`${k}:${i}`}
                  onClick={() => o.onTake(k, i)}
                >
                  {t('cp.rd.alt.take')}
                </button>
              </>
            ) : (
              ` ${t('cp.rd.alt.in_form')}`
            )}
          </span>
        ))}
      </MarkLine>
    );
  }
  return (id) => {
    const m = marks.get(id);
    if (!m) return null;
    return {
      need: !!m.need,
      node:
        m.src || m.need || m.alt ? (
          <>
            {m.src}
            {m.need ? (
              <MarkLine tone="need" data={{ 'data-rd-need': '' }}>
                {t('cp.rd.need')}
              </MarkLine>
            ) : null}
            {m.alt}
          </>
        ) : null,
    };
  };
}
