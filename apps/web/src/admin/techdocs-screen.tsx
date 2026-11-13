'use client';

import {
  formatDateRu,
  pluralForm,
  type GridViewSettings,
  type IsoDate,
  type ListSort,
} from '@buhuchet/domain';
import type { AdminApiMethod, AdminTechDocsMeta } from '@buhuchet/shared';
import {
  buttonClass,
  DataGrid,
  EmptyState,
  Icon,
  inputClass,
  MONO_CLASS,
  Note,
  PHONE_QUERY,
  Pill,
  useToast,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiFailure } from '../api-client';
import { useCopyText } from '../kb/video/video-copy';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { saveFile, useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { currentTheme } from '../shell/browser';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import {
  fetchApiMethods,
  fetchApiMethodValues,
  schemaPageSrc,
  techDocsMetaQuery,
  techDocsStore,
  useTechDocsState,
} from './techdocs-data';
import { MethodBadge, useMethodCard } from './techdocs-method';
import { accessTone, frameHeight, schemaHash, schemaPageMessage } from './techdocs-model';
import './techdocs.css';

const day = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDateRu(date as IsoDate) : date;

/**
 * Строка версии (прототип tdVer): по какому коммиту продукта собрано описание API и какой версии
 * описание базы; описание API старее схемы — жёлтое предупреждение.
 */
function VersionLine({ meta, extra }: { meta: AdminTechDocsMeta; extra?: ReactNode }) {
  const t = useT();
  const { api: a, schema: s } = meta;
  return (
    <>
      <div
        data-td-version=""
        className="flex items-start gap-2 text-[12.5px] leading-normal text-muted max-md:flex-wrap"
      >
        <Icon name="info" size="sm" />
        <span>
          {t('tdocs.ver.repo', { repo: a.repo })} <b>{a.branch}</b>
          {t('tdocs.ver.commit')} <code className="text-[12px]">{a.commit}</code>{' '}
          {t('tdocs.ver.rest', {
            date: day(a.date),
            methods: t(`tdocs.methods.${pluralForm(a.methods)}`, { n: a.methods }),
            version: s.version ?? '—',
            updated: day(s.updated),
            tables: t(`tdocs.tables.${pluralForm(s.tables)}`, { n: s.tables }),
          })}
        </span>
        {extra}
      </div>
      {meta.stale ? (
        <Note tone="beta" icon="alert">
          {t('tdocs.ver.stale')}
        </Note>
      ) : null}
    </>
  );
}

/** Открыто окно или всплывающее окошко программы: Esc сначала закрывает его. */
const overlayOpen = () => document.querySelector('[data-window], [data-popover]') !== null;

/**
 * Вкладка «Схема базы» (прототип renderTdocs, tdFull, tdFit): страница схемы в рамке на всю высоту
 * области модуля. Страницу с данными отдаёт сервер только администратору; в рамке она работает без
 * доступа к сайту (песочница без своего источника: ни cookie, ни запросов), общается с экраном
 * сообщениями: сообщает свой адрес, просит открыть метод, перейти в полноэкранный режим, передаёт Esc.
 */
function DbTab({ meta }: { meta: AdminTechDocsMeta }) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const queue = useRef<Record<string, unknown>[]>([]);
  const browserFull = useRef(false);
  const fullNow = useRef(false);
  const [full, setFull] = useState(false);
  const card = useMethodCard((hash) => techDocsStore.go(hash), false);

  const post = useCallback((message: Record<string, unknown>) => {
    const win = frame.current?.contentWindow;
    // У страницы в песочнице нет своего источника — адресата указать нельзя; в сообщениях только тема,
    // адрес страницы схемы и режим экрана.
    if (win && ready.current) win.postMessage({ tdx: 1, ...message }, '*');
    else queue.current.push(message);
  }, []);

  const fit = useCallback(() => {
    const f = frame.current;
    if (!f || fullNow.current) return;
    const main = f.closest('main');
    f.style.height = `${frameHeight({
      top: f.getBoundingClientRect().top,
      bottom: main ? main.getBoundingClientRect().bottom : window.innerHeight,
      phone: window.matchMedia(PHONE_QUERY).matches,
    })}px`;
  }, []);

  /*
   * «На весь экран»: рамка закрывает всё окно программы, браузер по возможности переходит в
   * полноэкранный режим. Окна (карточка метода) открываются поверх. Выход — кнопкой в шапке схемы, Esc
   * или выходом браузера из полноэкранного режима.
   */
  const setFullMode = useCallback(
    (on: boolean) => {
      if (on === fullNow.current) return;
      fullNow.current = on;
      setFull(on);
      document.body.classList.toggle('td-full-on', on);
      const root = document.documentElement;
      if (on && !document.fullscreenElement && typeof root.requestFullscreen === 'function') {
        browserFull.current = true;
        root.requestFullscreen().catch(() => {
          browserFull.current = false;
        });
      }
      if (!on && browserFull.current) {
        browserFull.current = false;
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      }
      post({ full: on });
      if (!on) requestAnimationFrame(fit);
    },
    [post, fit],
  );

  const onMessage = useEffectEvent((e: MessageEvent) => {
    const win = frame.current?.contentWindow;
    if (!win || e.source !== win) return;
    const d = schemaPageMessage(e.data);
    if (!d) return;
    if (d.ready) {
      ready.current = true;
      win.postMessage({ tdx: 1, theme: currentTheme() }, '*');
      for (const message of queue.current.splice(0)) post(message);
    }
    if (d.hash) techDocsStore.setHash(d.hash);
    if (d.open) card.open(d.open);
    if (d.full !== undefined) setFullMode(d.full);
    // Esc, который схема не обработала: закрывает карточку метода, без неё — полноэкранный режим.
    if (d.esc) {
      if (card.isOpen) card.close();
      else if (fullNow.current) setFullMode(false);
    }
  });

  // Esc в полноэкранном режиме браузера забирает сам браузер: выходим из него, а Esc срабатывает как
  // обычно — закрывает открытое окно, без окон возвращает обычный вид.
  const onBrowserFull = useEffectEvent(() => {
    if (document.fullscreenElement || !browserFull.current) return;
    browserFull.current = false;
    if (!fullNow.current) return;
    if (card.isOpen) card.close();
    else setFullMode(false);
  });

  // Esc в программе (фокус вне схемы): сначала закрываются окна, затем полноэкранный режим.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !fullNow.current || overlayOpen()) return;
    e.preventDefault();
    setFullMode(false);
  });

  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    // Адрес рамки ставится один раз: страница открывается там, где её оставили, с темой программы.
    f.src = schemaPageSrc(currentTheme(), techDocsStore.get().hash);
    fit();
    const message = (e: MessageEvent) => onMessage(e);
    const browser = () => onBrowserFull();
    const key = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('message', message);
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', key, true);
    document.addEventListener('fullscreenchange', browser);
    const theme = new MutationObserver(() => post({ theme: currentTheme() }));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const unbind = techDocsStore.bindFrame((hash) => post({ go: hash }));
    return () => {
      window.removeEventListener('message', message);
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('fullscreenchange', browser);
      theme.disconnect();
      unbind();
      // Уход с вкладки: полноэкранный режим снимается.
      document.body.classList.remove('td-full-on');
      if (browserFull.current && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [fit, post]);

  return (
    <div className="flex flex-col gap-2.5">
      <VersionLine
        meta={meta}
        extra={
          <button
            type="button"
            data-td-full=""
            title={t('tdocs.full.title')}
            className={`${buttonClass('default', 'sm')} -mt-1 ml-auto flex-none max-md:mt-0 max-md:ml-0`}
            onClick={() => setFullMode(true)}
          >
            <Icon name="maximize" size="sm" />
            {t('tdocs.full')}
          </button>
        }
      />
      <div className={`td-frame-w${full ? ' td-full' : ''}`} data-td-frame={full ? 'full' : ''}>
        <iframe
          ref={frame}
          className="td-frame"
          title={t('tdocs.frame.title')}
          sandbox="allow-scripts"
          loading="eager"
        />
      </div>
      {card.node}
    </div>
  );
}

/** По адресу внутри групп разделов (прототип `defGroup:['sec'], sort:{key:'p',dir:1}`). */
const DEFAULT_SORT: ListSort = { key: 'p', dir: 'asc' };
const DEFAULT_VISIBLE = ['m', 'p', 'sum', 'acc', 'n', 'w'];
// «Таблиц» — без итогов по группам (прототип `agg:''`).
const DEFAULT_VIEW: GridViewSettings = { group: ['sec'], agg: { n: 'none' } };

/** Столбцы списка методов — как в прототипе (tdApiTab); ключи — как на сервере. */
export function apiMethodColumns(t: Translate): GridColumn<AdminApiMethod>[] {
  const access = (code: string) =>
    t(
      `tdocs.acc.${(['public', 'session', 'employee', 'perm', 'admin'] as const).find((k) => k === code) ?? 'session'}`,
    );
  return [
    {
      key: 'm',
      label: t('tdocs.col.m'),
      type: 'enum',
      width: 96,
      text: (x) => x.method,
      cell: (x) => <MethodBadge method={x.method} />,
    },
    {
      key: 'p',
      label: t('tdocs.col.p'),
      type: 'text',
      width: 280,
      text: (x) => x.path,
      className: MONO_CLASS,
      cell: (x) => <span className={`${MONO_CLASS} break-all`}>{x.path}</span>,
    },
    { key: 'sec', label: t('tdocs.col.sec'), type: 'enum', width: 190, text: (x) => x.section },
    { key: 'sum', label: t('tdocs.col.sum'), type: 'text', width: 320, text: (x) => x.summary },
    {
      key: 'acc',
      label: t('tdocs.col.acc'),
      type: 'enum',
      width: 170,
      text: (x) => access(x.access),
      cell: (x) => (
        <Pill size="sm" tone={accessTone(x.access)}>
          {access(x.access)}
        </Pill>
      ),
    },
    {
      key: 'perm',
      label: t('tdocs.col.perm'),
      type: 'text',
      width: 220,
      text: (x) => x.permissions,
    },
    {
      key: 'n',
      label: t('tdocs.col.n'),
      type: 'int',
      width: 80,
      numeric: true,
      text: (x) => String(x.tables),
    },
    {
      key: 'w',
      label: t('tdocs.col.w'),
      type: 'enum',
      width: 120,
      text: (x) => t(x.writes ? 'tdocs.yes' : 'tdocs.no'),
      cell: (x) =>
        x.writes ? (
          <Pill size="sm" tone="caution">
            {t('tdocs.yes')}
          </Pill>
        ) : (
          <span className="text-faint">{t('tdocs.no')}</span>
        ),
    },
    { key: 'tb', label: t('tdocs.col.tb'), type: 'text', width: 280, text: (x) => x.tableNames },
    { key: 'rate', label: t('tdocs.col.rate'), type: 'text', width: 200, text: (x) => x.rate },
    {
      key: 'file',
      label: t('tdocs.col.file'),
      type: 'text',
      width: 280,
      text: (x) => x.file,
      className: MONO_CLASS,
    },
  ];
}

/**
 * Вкладка «API» (прототип tdApiTab): методы продукта общим списком по разделам — поиск, фильтры,
 * группировка, «В Excel»; фильтр «Таблица» оставляет методы, которые читают или меняют таблицу;
 * «Скачать OpenAPI» — описание методов файлом openapi.json. Строка открывает карточку метода.
 */
function ApiTab({ meta }: { meta: AdminTechDocsMeta }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const { table } = useTechDocsState();
  const labels = useGridLabels('tdocs.count');
  const columns = useMemo(() => apiMethodColumns(t), [t]);
  const view = useViewSettings('tdocs.api');
  // Своего вида ещё нет — по группам разделов; первая правка сохраняет его целиком.
  const settings = useMemo(
    () => (Object.keys(view.settings).length ? view.settings : { ...DEFAULT_VIEW }),
    [view.settings],
  );
  const { search, clearSearch } = useShell();
  const extra = useMemo(() => (table ? { table } : undefined), [table]);
  const list = useListPage({
    gridKey: 'tdocs.api',
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchApiMethods,
    ...(extra ? { extra } : {}),
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api.admin['tech-docs'].methods.export.$get({
        query: { ...params, cols: visible.join(',') },
      }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const loadValues = useMemo(() => fetchApiMethodValues(table), [table]);
  const goSchema = useCallback(
    (hash: string) => {
      techDocsStore.go(hash);
      router.push(tabHref('tdocs', 'db'));
    },
    [router],
  );
  // Из карточки — с заменой записи истории: «Назад» не вернёт к закрытому окну.
  const leaveToSchema = useCallback(
    (hash: string) => {
      techDocsStore.go(hash);
      router.replace(tabHref('tdocs', 'db'));
    },
    [router],
  );
  const card = useMethodCard(leaveToSchema, true);
  const copier = useCopyText();
  const [loadingFile, setLoadingFile] = useState(false);

  const downloadOpenApi = async () => {
    setLoadingFile(true);
    try {
      const res = await api.api.admin['tech-docs'].openapi.$get();
      if (!res.ok) throw new Error(String(res.status));
      saveFile(await res.blob(), 'openapi.json');
      toast(t('tdocs.openapi.done'), { icon: 'download' });
    } catch {
      toast(t('tdocs.openapi.error'), { icon: 'alert', bad: true });
    } finally {
      setLoadingFile(false);
    }
  };

  const actions = (x: AdminApiMethod): ActionEntry[] => [
    { id: 'open', label: t('tdocs.action.open'), icon: 'code', run: () => card.open(x.id) },
    {
      id: 'show',
      label: t('tdocs.action.show'),
      icon: 'db',
      disabled: x.tables === 0,
      reason: t('tdocs.action.show.none'),
      run: () => goSchema(schemaHash.method(x.id)),
    },
    {
      id: 'copy',
      label: t('tdocs.action.copy'),
      icon: 'copy',
      run: () => void copier.copy(`${x.method} ${x.path}`, t('tdocs.copied.path')),
    },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <VersionLine meta={meta} />
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="inline-flex min-w-0 flex-[0_1_420px] items-center gap-2 text-[12.5px] text-muted max-md:flex-[1_1_100%]">
          <Icon name="db" size="sm" />
          <span>{t('tdocs.table')}</span>
          <select
            data-td-table-filter=""
            aria-label={t('tdocs.table.filter')}
            className={`${inputClass({ full: false })} min-h-[30px] min-w-0 flex-auto cursor-pointer px-2 py-[3px]`}
            value={table}
            onChange={(e) => techDocsStore.setTable(e.target.value)}
          >
            <option value="">{t('tdocs.table.all')}</option>
            {meta.tables.map((x) => (
              <option key={x.name} value={x.name}>
                {x.ru} · {x.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        <button
          type="button"
          data-td-openapi=""
          title={t('tdocs.openapi.title')}
          disabled={loadingFile}
          className={buttonClass('default', 'sm')}
          onClick={() => void downloadOpenApi()}
        >
          <Icon name="download" size="sm" />
          {t('tdocs.openapi')}
        </button>
      </div>
      <DataGrid
        columns={columns}
        defaultVisible={DEFAULT_VISIBLE}
        defaultSort={DEFAULT_SORT}
        settings={settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={loadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="code" title={t('grid.empty')} />}
        rowKey={(x) => x.id}
        titleKey="p"
        label={t('tab.tdocs.api')}
        labels={labels}
        actions={actions}
        onOpen={(x) => card.open(x.id)}
      />
      {card.node}
      {copier.node}
    </div>
  );
}

/**
 * Админка → «Техническая документация» (ТЗ «Админка» → «Техническая документация», решение заказчика
 * 09.11.2026; прототип v83 admin/techdocs.js): вкладки «Схема базы» и «API». Только просмотр: из
 * модуля ничего не меняется в базе и не вызывается ни один метод продукта. Описание собирается при
 * сборке сайта; не собралось — экран говорит об этом.
 */
export function TechDocsScreen({ tab }: { tab: string }) {
  const t = useT();
  const meta = useQuery(techDocsMetaQuery);
  if (meta.isPending) return null;
  if (meta.isError || !meta.data) {
    const missing = meta.error instanceof ApiFailure && meta.error.status === 404;
    return (
      <div data-td-missing="">
        <EmptyState
          icon="alert"
          title={t('tdocs.missing.title')}
          text={missing ? t('tdocs.missing.hint') : undefined}
        />
      </div>
    );
  }
  return tab === 'api' ? <ApiTab meta={meta.data} /> : <DbTab meta={meta.data} />;
}
