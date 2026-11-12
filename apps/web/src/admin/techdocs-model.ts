import type { IconName } from '@buhuchet/ui';

/** Вкладки карточки метода (прототип tdMethod). */
export const METHOD_CARD_TABS = ['req', 'res', 'tbl', 'sql', 'code'] as const;
export type MethodCardTab = (typeof METHOD_CARD_TABS)[number];

export const METHOD_TAB_ICONS: Readonly<Record<MethodCardTab, IconName>> = {
  req: 'edit',
  res: 'list',
  tbl: 'db',
  sql: 'code',
  code: 'folder',
};

/** Адреса страницы схемы (прототип tdShowTable, tdShowMethod, tdShowFn). */
export const schemaHash = {
  start: '#/t',
  table: (name: string) => `#/t/${encodeURIComponent(name)}`,
  method: (id: string) => `#/d/${encodeURIComponent(`@${id}`)}`,
  fn: (name: string) => `#/r/${encodeURIComponent(name)}`,
};

/** Адрес страницы схемы из сообщения рамки: только «#/…» разумной длины, иначе — начало. */
export function safeSchemaHash(hash: unknown): string {
  return typeof hash === 'string' && /^#\/[^\s<>"']{0,300}$/.test(hash) ? hash : schemaHash.start;
}

type PillTone = 'plain' | 'ok' | 'bad' | 'caution' | 'warn' | 'violet' | 'info';

/** Цвет метки «Доступ» (прототип tdApiTab: администратор — фиолетовая, без входа — жёлтая, право — синяя). */
export function accessTone(access: string): PillTone {
  if (access === 'admin') return 'violet';
  if (access === 'public') return 'warn';
  if (access === 'perm') return 'info';
  return 'plain';
}

/** Цвет кода ответа (прототип tdResHtml): 2xx — зелёный, 3xx — синий, 409 и 429 — жёлтый, прочее — красный. */
export function responseTone(code: string): PillTone {
  if (code.startsWith('2')) return 'ok';
  if (code.startsWith('3')) return 'info';
  if (code === '429' || code === '409') return 'warn';
  return 'bad';
}

/** Цвет вида запроса (прототип TD_QK): SQL — зелёный, «Запрос по коду» — жёлтый, представление — синий. */
export function queryKind(kind: string): { key: 'sql' | 'code' | 'view'; tone: PillTone } {
  if (kind === 'sql') return { key: 'sql', tone: 'ok' };
  if (kind === 'view') return { key: 'view', tone: 'info' };
  return { key: 'code', tone: 'warn' };
}

/** Цвет метода HTTP (прототип `.m-GET`…): класс из techdocs.css. */
export function methodClass(method: string): string {
  const known = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return `td-mth${known.includes(method) ? ` td-m-${method}` : ''}`;
}

const SQL_KEYWORD =
  /^(SELECT|FROM|WHERE|AND|OR|NOT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|RETURNING|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|GROUP|BY|ORDER|LIMIT|OFFSET|WITH|CREATE|VIEW|FUNCTION|REPLACE|RETURNS|LANGUAGE|SECURITY|DEFINER|BEGIN|END|IF|THEN|ELSE|CASE|WHEN|IS|NULL|IN|EXISTS|DISTINCT|COALESCE|COUNT|SUM|MAX|MIN|UNION|ALL|CONFLICT|DO|NOTHING|LATERAL|HAVING|ASC|DESC|TRUE|FALSE|DECLARE|PERFORM|RAISE|EXCEPTION|TABLE|BOOLEAN|INTEGER|TEXT|UUID|STABLE|VOLATILE|IMMUTABLE)$/i;

/** Кусок текста SQL: `k` — ключевое слово, `s` — строка, `p` — параметр $1…, `c` — комментарий. */
export interface SqlToken {
  kind: 'k' | 's' | 'p' | 'c' | null;
  text: string;
}

/**
 * Подсветка SQL (прототип tdSqlHl): ключевые слова, параметры $1…, строки и комментарии. Текст не
 * меняется — только делится на куски: склейка кусков даёт исходный текст.
 */
export function sqlTokens(text: string): SqlToken[] {
  const out: SqlToken[] = [];
  const push = (kind: SqlToken['kind'], part: string) => {
    if (!part) return;
    const last = out[out.length - 1];
    if (kind === null && last && last.kind === null) last.text += part;
    else out.push({ kind, text: part });
  };
  const re = /(--[^\n]*)|('[^']*')|(\$\d+)|\b([A-Za-z_]+)\b/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    push(null, text.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1]) push('c', m[1]);
    else if (m[2]) push('s', m[2]);
    else if (m[3]) push('p', m[3]);
    else push(SQL_KEYWORD.test(m[4]!) ? 'k' : null, m[4]!);
  }
  push(null, text.slice(at));
  return out;
}

/** Тип поля по кускам: имя известной схемы Zod — ссылка на её поля (прототип tdTypeHtml). */
export function typeParts(
  type: string,
  known: ReadonlySet<string>,
): { text: string; schema: boolean }[] {
  const out: { text: string; schema: boolean }[] = [];
  const push = (part: string, schema: boolean) => {
    if (!part) return;
    const last = out[out.length - 1];
    if (!schema && last && !last.schema) last.text += part;
    else out.push({ text: part, schema });
  };
  let at = 0;
  for (const m of type.matchAll(/\b([A-Z]\w+)\b/g)) {
    push(type.slice(at, m.index), false);
    at = m.index + m[0].length;
    push(m[0], known.has(m[0]));
  }
  push(type.slice(at), false);
  return out;
}

/**
 * Ссылка на файл продукта на GitHub на коммите снимка (прототип tdCodeHtml). Репозиторий и коммит не
 * похожи на настоящие — ссылки нет.
 */
export function codeHref(repo: string, commit: string, file: string, line: number): string | null {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{7,40}$/i.test(commit)) return null;
  if (!file || file.startsWith('/') || file.split('/').includes('..')) return null;
  const path = file.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repo}/blob/${commit}/${path}${line > 0 ? `#L${line}` : ''}`;
}

/** Место кода строкой: «файл:строка». */
export const codePlace = (file: string, line: number) => (line > 0 ? `${file}:${line}` : file);

/**
 * Высота рамки схемы (прототип tdFit): от своего верха до низа области модуля, не ниже 420 px.
 */
export function frameHeight(at: { top: number; bottom: number; phone: boolean }): number {
  return Math.max(420, at.bottom - Math.max(0, at.top) - (at.phone ? 8 : 16));
}

/** Сообщение страницы схемы (прототип: `{tdx:1, ready|hash|open|full|esc}`); чужое — null. */
export interface SchemaPageMessage {
  ready?: boolean;
  hash?: string;
  open?: string;
  full?: boolean;
  esc?: boolean;
}

/** Номер метода в снимке — «GET /admin/users»; другое страница схемы открыть не просит. */
const METHOD_ID = /^(GET|POST|PUT|PATCH|DELETE) \/[\w\-{}/.:]{0,290}$/;

export function schemaPageMessage(data: unknown): SchemaPageMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (!d.tdx) return null;
  const out: SchemaPageMessage = {};
  if (d.ready) out.ready = true;
  if (typeof d.hash === 'string') out.hash = safeSchemaHash(d.hash);
  if (typeof d.open === 'string' && METHOD_ID.test(d.open)) out.open = d.open;
  if ('full' in d) out.full = Boolean(d.full);
  if (d.esc) out.esc = true;
  return out;
}
