'use client';

import { newsTitleHasVersion, pluralForm, type MenuModuleId } from '@buhuchet/domain';
import type { NewsItem, NewsLinkSchema, WhatsNew } from '@buhuchet/shared';
import { buttonClass, Icon, Modal, Note, Tag, useToast, useWindow } from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import type { ArticleView } from '../kb/kb-article';
import { kbArticlesQuery } from '../kb/kb-data';
import { videoCatalogQuery } from '../kb/video/video-data';
import { useVideo } from '../kb/video/video-window';
import { useT } from '../l10n/provider';
import { isModuleId, MODULES } from '../shell/modules';
import { fetchWhatsNew, markNewsRead } from './news-data';
import { NewsMarkdown, type NewsInnerLink } from './news-md';
import { NewsFreshPill, newsMeta, NewsTypePill } from './news-parts';
import { takeSignedIn } from './signed-in';

/*
 * «Новости» поверх экрана (задача 2.32; прототип modules/kb-news.js — newsRow, whatsNew): строка
 * новости с раскрывающимися подробностями и окно «Что нового» после входа. Раскрытая новость и
 * показанные в «Что нового» сразу прочитаны (решение заказчика 25.10.2026): окно с ними больше не
 * откроется.
 */

/** «Что нового» открывается чуть позже рабочей страницы (прототип: 400 мс). */
const WHATS_NEW_DELAY_MS = 400;

export interface NewsControls {
  /** Адрес модуля (вкладки) из меню вошедшего; null — модуля нет в меню. */
  hrefOf: (module: string, tab?: string | null) => string | null;
  /** Открыть статью Базы знаний. */
  openArticle: (id: string) => void;
}

export const NewsContext = createContext<NewsControls>({
  hrefOf: () => null,
  openArticle: () => {},
});

export function useNews(): NewsControls {
  return useContext(NewsContext);
}

/** Что «Новости» берут у оболочки. */
export interface NewsShellInfo {
  tabHrefOf: (module: MenuModuleId, tab?: string) => string | null;
  openArticle: (view: ArticleView) => void;
  /** «Все новости» — вкладка «Новости» Базы знаний. */
  newsHref: string;
  /** «Открыть Базу знаний» в первом «Что нового» — «Уроки». */
  lessonsHref: string;
  /**
   * Сразу после входа сначала — приветствие (задача 2.33): true — оно открыто, и «Что нового» в этот
   * вход не показывается (ТЗ «Окно «Что нового» при входе»).
   */
  welcomeFirst?: () => Promise<boolean>;
}

export function useNewsRuntime(shell: NewsShellInfo): {
  controls: NewsControls;
  overlays: ReactNode;
} {
  const client = useQueryClient();
  const [whatsNew, setWhatsNew] = useState<DialogSlot<WhatsNew> | null>(null);
  const started = useRef(false);
  const { tabHrefOf, openArticle, welcomeFirst } = shell;

  const read = useCallback(
    (ids: string[]) => void markNewsRead(client, ids).catch(() => {}),
    [client],
  );

  // Только сразу после входа (отметка страницы входа), не при перезагрузке. Запрос не отменяется при
  // повторном запуске эффекта: отметка уже снята.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!takeSignedIn()) return;
    (welcomeFirst?.() ?? Promise.resolve(false))
      .then((welcome) => (welcome ? null : fetchWhatsNew()))
      .then((wn) => {
        if (!wn?.items.length) return;
        read(wn.items.map((n) => n.id));
        setTimeout(() => setWhatsNew(openSlot(wn)), WHATS_NEW_DELAY_MS);
      })
      .catch(() => {});
  }, [read, welcomeFirst]);

  const controls = useMemo<NewsControls>(
    () => ({
      hrefOf: (module, tab) => (isModuleId(module) ? tabHrefOf(module, tab ?? undefined) : null),
      openArticle: (id) => openArticle({ id }),
    }),
    [tabHrefOf, openArticle],
  );

  const overlays = whatsNew ? (
    <WhatsNewDialog
      key={`whats-new-${whatsNew.n}`}
      data={whatsNew.data}
      open={whatsNew.open}
      onClose={() => setWhatsNew(closeSlot)}
      newsHref={shell.newsHref}
      lessonsHref={shell.lessonsHref}
    />
  ) : null;
  return { controls, overlays };
}

/**
 * Ссылки новости (прототип: обработчик `[data-mdmod],[data-mdart]` и newsLinkOk): модуль из меню —
 * переход (окно закрывается, запись истории заменяется), статья — окно статьи поверх; нет модуля в
 * меню или статья недоступна — уведомление. В редакторе Админки (`preview`) ссылки на модуль и статью
 * не работают, кнопка видео — открывает окно.
 */
export function useNewsLinks({ preview = false }: { preview?: boolean } = {}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const client = useQueryClient();
  const news = useNews();
  const video = useVideo();
  const { leave, inside } = useWindow();

  const follow = useCallback(
    (link: NewsInnerLink) => {
      // Кнопка видео открывает окно и в предпросмотре редактора (прототип: `data-vopen` без `.md-edit`).
      if (link.kind === 'video') return video.open(link.id);
      if (preview) return toast(t('news.link.in_editor'), { icon: 'info' });
      if (link.kind === 'mod') {
        const href = news.hrefOf(link.module, link.tab);
        if (!href) return toast(t('news.link.module_denied'), { icon: 'lock' });
        // Из окна — с заменой записи истории; из ленты вкладки — обычный переход: «Назад» вернёт в
        // «Новости» (прототип go()).
        leave();
        if (inside) router.replace(href);
        else router.push(href);
        return;
      }
      void client
        .fetchQuery(kbArticlesQuery)
        .then((list) =>
          list.some((a) => a.id === link.id)
            ? news.openArticle(link.id)
            : toast(t('news.link.article_denied'), { icon: 'lock' }),
        )
        .catch(() => toast(t('news.link.article_denied'), { icon: 'lock' }));
    },
    [preview, toast, t, news, video, leave, inside, router, client],
  );
  return follow;
}

/**
 * «Подробнее: …» у новости со ссылкой (прототип newsLinkOk, newsLinkTxt): статья, видная
 * пользователю, или модуль из его меню, у видео — «▶ Смотреть видео»; иначе кнопки нет.
 */
function useMoreLink(link: NewsLinkSchema | null) {
  const t = useT();
  const news = useNews();
  const router = useRouter();
  const { close, leave, inside } = useWindow();
  const video = useVideo();
  const articles = useQuery({ ...kbArticlesQuery, enabled: link?.kind === 'art' }).data;
  const videos = useQuery({ ...videoCatalogQuery, enabled: link?.kind === 'video' }).data;
  if (!link) return null;
  // «▶ Смотреть видео» — у видео, доступного пользователю (прототип v79 newsLinkBtn, newsLinkOk).
  if (link.kind === 'video') {
    if (!videos?.items.some((v) => v.id === link.id)) return null;
    return { title: '', video: true, go: () => video.open(link.id) };
  }
  if (link.kind === 'art') {
    const article = articles?.find((a) => a.id === link.id);
    if (!article) return null;
    return {
      title: article.title,
      go: () => {
        close();
        news.openArticle(article.id);
      },
    };
  }
  const href = news.hrefOf(link.id);
  if (!href || !isModuleId(link.id)) return null;
  return {
    title: t(MODULES[link.id].title),
    go: () => {
      leave();
      if (inside) router.replace(href);
      else router.push(href);
    },
  };
}

function MoreButton({ link, small = false }: { link: NewsLinkSchema | null; small?: boolean }) {
  const t = useT();
  const more = useMoreLink(link);
  if (!more) return null;
  return (
    <button
      type="button"
      data-news-more=""
      onClick={more.go}
      className={buttonClass('default', small ? 'sm' : 'md')}
    >
      <Icon name={'video' in more ? 'pl' : 'right'} size="sm" />
      {'video' in more ? t('video.news.watch') : t('news.more', { title: more.title })}
    </button>
  );
}

/**
 * Новость строкой-заголовком (прототип v98 newsRow, решение заказчика 13.11.2026): главный смысл — в
 * заголовке, подробности и «Подробнее» раскрываются по нажатию. Справа — «Новое», «Закреплено», тип и
 * дата; «версия N» — только если номера нет в самом заголовке. `marked` — синяя черта непрочитанной
 * (в ленте; в окне «Что нового» новые все, черты нет).
 */
export function NewsRow({
  item,
  open,
  fresh,
  marked = true,
  onToggle,
}: {
  item: NewsItem;
  open: boolean;
  fresh: boolean;
  marked?: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const release =
    item.release && !newsTitleHasVersion(item.title, item.release) ? item.release : null;
  return (
    <div
      data-news={item.id}
      data-open={open ? '' : undefined}
      data-unread={fresh ? '' : undefined}
      className={`rounded-lg border bg-pane ${fresh && marked ? 'border-brand-blue shadow-[inset_3px_0_0_var(--bu-blue)]' : 'border-line'}`}
    >
      <button
        type="button"
        data-news-head=""
        aria-expanded={open}
        onClick={onToggle}
        className={`flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-left text-ink hover:bg-row-hover focus-visible:outline-2 focus-visible:outline-brand-blue md:flex-nowrap ${open ? 'rounded-t-lg' : 'rounded-lg'}`}
      >
        <Icon name={open ? 'down' : 'right'} size="sm" className="flex-none text-faint" />
        <b className="min-w-0 flex-[1_1_calc(100%-28px)] leading-[1.35] font-semibold md:flex-1">
          {item.title}
        </b>
        <span className="flex flex-[1_1_100%] flex-wrap items-center gap-2 pl-[26px] text-[12.5px] md:flex-none md:flex-nowrap md:pl-0 md:whitespace-nowrap">
          {fresh ? <NewsFreshPill t={t} /> : null}
          {item.pinned ? <Tag icon="star">{t('news.pinned')}</Tag> : null}
          <NewsTypePill type={item.type} t={t} />
          <span className="text-muted">{newsMeta(t, { date: item.date, release })}</span>
        </span>
      </button>
      {open ? (
        <div
          data-news-body=""
          className="flex flex-col items-start gap-2.5 border-t border-line px-3 pt-3 pb-3.5 md:pl-9"
        >
          <div className="w-full">
            <NewsBody source={item.md} />
          </div>
          <MoreButton link={item.link} small />
        </div>
      ) : null}
    </div>
  );
}

/** Подробное описание со ссылками внутри окна. */
export function NewsBody({ source, preview = false }: { source: string; preview?: boolean }) {
  const follow = useNewsLinks({ preview });
  return <NewsMarkdown source={source} onLink={follow} />;
}

/**
 * «Что нового» (ТЗ «Окно «Что нового» при входе»; прототип v98 whatsNew): непрочитанные новости
 * «Показывать при входе» строками-заголовками, по номеру версии от новых к старым; подробности сами
 * раскрыты только у самой новой, остальные раскрываются по нажатию. В самый первый раз — приветствие
 * и «Открыть Базу знаний». «Все новости» — вкладка «Новости», «Понятно» — закрыть.
 */
function WhatsNewDialog({
  data,
  open,
  onClose,
  newsHref,
  lessonsHref,
}: {
  data: WhatsNew;
  open: boolean;
  onClose: () => void;
  newsHref: string;
  lessonsHref: string;
}) {
  const t = useT();
  const n = data.items.length;
  // Что нажато: раскрыто или свёрнуто; не нажатая — раскрыта только самая новая.
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={t('news.wn.title')}
      sub={t(`news.wn.sub.${pluralForm(n)}`, { n })}
      footer={<WhatsNewFooter first={data.first} newsHref={newsHref} lessonsHref={lessonsHref} />}
    >
      <div data-whats-new="" className="flex flex-col gap-3.5">
        {data.first ? (
          <Note icon="grad">
            <b>{t('news.wn.welcome')}</b> {t('news.wn.welcome_text')}
          </Note>
        ) : null}
        <div data-news-list="" className="flex flex-col gap-1.5">
          {data.items.map((item, i) => {
            const shown = toggled[item.id] ?? i === 0;
            return (
              <NewsRow
                key={item.id}
                item={item}
                open={shown}
                fresh
                marked={false}
                onToggle={() => setToggled((was) => ({ ...was, [item.id]: !shown }))}
              />
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function WhatsNewFooter({
  first,
  newsHref,
  lessonsHref,
}: {
  first: boolean;
  newsHref: string;
  lessonsHref: string;
}) {
  const t = useT();
  const { close, leave } = useWindow();
  return (
    <>
      {first ? (
        <Link href={lessonsHref} replace onClick={leave} className={buttonClass()}>
          <Icon name="grad" size="sm" />
          {t('news.wn.open_kb')}
        </Link>
      ) : null}
      <div className="flex-1" />
      <Link href={newsHref} replace onClick={leave} className={buttonClass('ghost')}>
        <Icon name="bell" size="sm" />
        {t('news.wn.all')}
      </Link>
      <button type="button" onClick={close} className={buttonClass('cta')}>
        {t('news.wn.ok')}
      </button>
    </>
  );
}
