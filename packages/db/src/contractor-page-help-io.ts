import {
  CP_FAQ_ACTS,
  CP_FAQ_SECS,
  CP_HELP_HINT_KEYS,
  CP_HELP_MAX,
  CP_HELP_WELCOME_KEYS,
  type CpFaqAct,
  type CpFaqSec,
  type CpHelp,
  type CpHelpDict,
  type CpHelpHintKey,
  type CpHelpWelcomeKey,
  type UiTextKey,
} from '@buhuchet/domain';
import type { IoRecord } from './admin-dict-io';
import type { SectionSaveResult, SectionWriter } from './admin-io-sections';
import type { Tx } from './client';
import {
  adminCpHelp,
  applyCpHelpEdit,
  saveCpHelp,
  type AdminCpHelpEdit,
} from './contractor-page-help';

/*
 * Админка → «База знаний (содержимое)» → «Страница контрагента» → «Выгрузить» и «Загрузить»
 * (доработки 15.11.2026; прототип v120 DX.cpwel, DX.cphints, DX.cptour, DX.cpfaq, DX.cpgloss): строки
 * файла — тексты приветствия и подсказок, облачка обзора, частые вопросы, слова «Словарика». Строка
 * пишется той же правкой, что окно вкладки (`applyCpHelpEdit`, история — её же), каждая — своей точкой
 * сохранения. Новых текстов и облачков загрузка не добавляет (что подсвечивать, задаёт разработчик),
 * новый вопрос — с кодом из файла, новое слово — новой строкой; удаления нет.
 */

const str = (v: unknown) => (typeof v === 'string' ? v : '');

const CHANGED: SectionSaveResult = { ok: false, fail: 'changed' };

const fail = (key: UiTextKey, col?: UiTextKey, params?: Record<string, string>) =>
  ({
    ok: false,
    fail: { key, ...(params ? { params } : {}), ...(col ? { col } : {}) },
  }) as const;

const NO_NEW = fail('cph.io.err.no_new');

/** Пустое или длиннее предела поле строки — отказ «Столбец: что не так» (как у окна). */
function fieldFail(
  text: string,
  max: number,
  col: UiTextKey,
  empty: UiTextKey | null,
): SectionSaveResult | null {
  if (empty && !text) return fail(empty, col);
  if (text.length > max) return fail('cph.io.err.long', undefined, { col, n: String(max) });
  return null;
}

/* ───────────── Строки файла ───────────── */

function records(dict: CpHelpDict, h: CpHelp, version: number): IoRecord[] {
  switch (dict) {
    case 'cpwel':
    case 'cphints': {
      const keys: readonly string[] = dict === 'cpwel' ? CP_HELP_WELCOME_KEYS : CP_HELP_HINT_KEYS;
      const texts: Readonly<Record<string, string | undefined>> =
        dict === 'cpwel' ? h.welcome : h.hints;
      return keys.map((k) => ({
        code: k,
        name: '',
        active: true,
        data: { where: k, text: texts[k] ?? '' },
        version,
      }));
    }
    case 'cptour':
      return h.tour.map((s, i) => ({
        code: s.id,
        name: s.t,
        active: s.sec === 'end' || s.on,
        data: { n: i + 1, sec: s.sec, t: s.t, x: s.x, x2: s.x2 ?? '' },
        version,
      }));
    case 'cpfaq':
      return h.faq.map((q) => ({
        code: q.id,
        name: q.q,
        active: q.on,
        data: { ord: q.ord, a: q.a, sec: q.sec, act: q.act },
        version,
      }));
    case 'cpgloss':
      return h.gloss.map((g) => ({
        code: g.w,
        name: g.w,
        active: true,
        data: { x: g.x, also: g.also ?? '' },
        version,
      }));
  }
}

/** Правка строки файла поверх раздела; отказ — сразу итогом строки. */
type RowEdit = (help: CpHelp, version: number) => AdminCpHelpEdit | SectionSaveResult;

async function writeRow(
  tx: Tx,
  dict: CpHelpDict,
  code: string,
  edit: RowEdit,
): Promise<SectionSaveResult> {
  const ref = await adminCpHelp(tx);
  if (!ref) return CHANGED;
  const e = edit(ref.help, ref.version);
  if ('ok' in e) return e;
  const a = applyCpHelpEdit(ref.help, e, Date.now());
  if (!('help' in a)) {
    return a.reason === 'invalid' ? fail('err.cph_word_taken', 'cph.io.col.word') : CHANGED;
  }
  const saved = a.changes.length ? await saveCpHelp(tx, a, ref.version) : ref;
  if (!saved) return CHANGED;
  const record = records(dict, saved.help, saved.version).find((r) => r.code === code);
  return record ? { ok: true, record } : CHANGED;
}

/** Откат загрузки: убрать добавленный вопрос или слово; его уже нет — откатывать нечего. */
async function removeRow(
  tx: Tx,
  edit: (help: CpHelp, version: number) => AdminCpHelpEdit | null,
): Promise<SectionSaveResult | { ok: true }> {
  const ref = await adminCpHelp(tx);
  const e = ref && edit(ref.help, ref.version);
  if (!ref || !e) return { ok: true };
  const a = applyCpHelpEdit(ref.help, e, 0);
  if (!('help' in a)) return CHANGED;
  return (await saveCpHelp(tx, a, ref.version)) ? { ok: true } : CHANGED;
}

function textWriter(dict: 'cpwel' | 'cphints'): SectionWriter {
  return {
    async records(tx) {
      const ref = await adminCpHelp(tx);
      return ref ? records(dict, ref.help, ref.version) : [];
    },
    async save(tx, value, base) {
      if (!base) return NO_NEW;
      const text = str(value.data.text).trim();
      const bad = fieldFail(text, CP_HELP_MAX.text, 'cph.io.col.text', 'cph.adm.err.text');
      if (bad) return bad;
      return writeRow(tx, dict, value.code, (_, version) =>
        dict === 'cpwel'
          ? { op: 'welcome', key: value.code as CpHelpWelcomeKey, text, version }
          : { op: 'hint', key: value.code as CpHelpHintKey, text, version },
      );
    },
    async remove() {
      return { ok: true };
    },
  };
}

const tourWriter: SectionWriter = {
  async records(tx) {
    const ref = await adminCpHelp(tx);
    return ref ? records('cptour', ref.help, ref.version) : [];
  },
  async save(tx, value, base) {
    if (!base) return NO_NEW;
    const t = str(value.data.t).trim();
    const x = str(value.data.x).trim();
    const x2 = str(value.data.x2).trim();
    const bad =
      fieldFail(t, CP_HELP_MAX.tourTitle, 'cph.io.col.tour_t', 'cph.adm.err.title') ??
      fieldFail(x, CP_HELP_MAX.tourText, 'cph.io.col.tour_x', 'cph.adm.err.text') ??
      fieldFail(x2, CP_HELP_MAX.tourText, 'cph.io.col.tour_x2', null);
    if (bad) return bad;
    return writeRow(tx, 'cptour', value.code, (_, version) => ({
      op: 'tour',
      id: value.code,
      t,
      x,
      x2,
      on: value.active,
      version,
    }));
  },
  async remove() {
    return { ok: true };
  },
};

const isSec = (v: unknown): v is CpFaqSec => (CP_FAQ_SECS as readonly unknown[]).includes(v);
const isAct = (v: unknown): v is CpFaqAct => (CP_FAQ_ACTS as readonly unknown[]).includes(v);

const faqWriter: SectionWriter = {
  async records(tx) {
    const ref = await adminCpHelp(tx);
    return ref ? records('cpfaq', ref.help, ref.version) : [];
  },
  async save(tx, value, base) {
    const q = value.name.trim();
    const a = str(value.data.a).trim();
    const bad =
      fieldFail(q, CP_HELP_MAX.question, 'cph.io.col.q', 'cph.adm.err.question') ??
      fieldFail(a, CP_HELP_MAX.answer, 'cph.io.col.a', 'cph.adm.err.answer');
    if (bad) return bad;
    const { sec, act, ord } = value.data;
    return writeRow(tx, 'cpfaq', value.code, (h, version) => {
      const now = h.faq.find((x) => x.id === value.code);
      if (base ? !now : now) return CHANGED;
      return {
        op: 'faq',
        ...(base ? { id: value.code } : { newId: value.code }),
        q,
        a,
        sec: isSec(sec) ? sec : '',
        act: isAct(act) ? act : '',
        on: value.active,
        ...(typeof ord === 'number' ? { ord } : {}),
        version,
      };
    });
  },
  async remove(tx, record) {
    return removeRow(tx, (h, version) =>
      h.faq.some((x) => x.id === record.code)
        ? { op: 'faqDelete', id: record.code, version }
        : null,
    );
  },
};

const glossWriter: SectionWriter = {
  async records(tx) {
    const ref = await adminCpHelp(tx);
    return ref ? records('cpgloss', ref.help, ref.version) : [];
  },
  async save(tx, value, base) {
    const w = value.code.trim();
    const x = str(value.data.x).trim();
    const also = str(value.data.also);
    const bad =
      fieldFail(w, CP_HELP_MAX.word, 'cph.io.col.word', 'cph.adm.err.word') ??
      fieldFail(x, CP_HELP_MAX.glossText, 'cph.io.col.gloss_x', 'cph.adm.err.gloss_text') ??
      fieldFail(also, CP_HELP_MAX.also, 'cph.io.col.also', null);
    if (bad) return bad;
    return writeRow(tx, 'cpgloss', w, (h, version) => {
      const now = h.gloss.find((g) => g.w === value.code);
      if (base ? !now : now) return CHANGED;
      return { op: 'gloss', ...(base ? { was: value.code } : {}), w, x, also, version };
    });
  },
  async remove(tx, record) {
    return removeRow(tx, (h, version) =>
      h.gloss.some((g) => g.w === record.code)
        ? { op: 'glossDelete', w: record.code, version }
        : null,
    );
  },
};

/** «Выгрузить» и «Загрузить» пяти разделов вкладки. */
export const CP_HELP_SECTION_WRITERS: Readonly<Record<CpHelpDict, SectionWriter>> = {
  cpwel: textWriter('cpwel'),
  cphints: textWriter('cphints'),
  cptour: tourWriter,
  cpfaq: faqWriter,
  cpgloss: glossWriter,
};
