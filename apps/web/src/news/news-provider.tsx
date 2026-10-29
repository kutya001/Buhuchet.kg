'use client';

import { pluralForm, type MenuModuleId } from '@buhuchet/domain';
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
import { useT } from '../l10n/provider';
import { isModuleId, MODULES } from '../shell/modules';
import { fetchWhatsNew, markNewsRead } from './news-data';
import { NewsMarkdown, type NewsInnerLink } from './news-md';
import { NewsFreshPill, newsMeta, NewsTypePill } from './news-parts';
import { takeSignedIn } from './signed-in';

/*
 * «Новости» поверх экрана (задача 2.32; прототип modules/kb-news.js — newsOpen, whatsNew): окно
 * новости и окно «Что нового» после входа. Открытая новость и показанные в «Что нового» сразу
 * прочитаны (решение заказчика 25.10.2026): окно с ними больше не откроется.
 */

/** «Что нового» открывается чуть позже рабочей страницы (прототип: 400 мс). */
const WHATS_NEW_DELAY_MS = 400;

export interface NewsControls {
  /** Открыть новость в окне: она прочитана. */
  open: (item: NewsItem) => void;
  /** Адрес модуля (вкладки) из меню вошедшего; null — модуля нет в меню. */
  hrefOf: (module: string, tab?: string | null) => string | null;
  /** Открыть статью Базы знаний. */
  openArticle: (id: string) => void;
}

export const NewsContext = createContext<NewsControls>({
  open: () => {},
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
}

export function useNewsRuntime(shell: NewsShellInfo): {
  controls: NewsControls;
  overlays: ReactNode;
} {
  const client = useQueryClient();
  const [item, setItem] = useState<DialogSlot<NewsItem> | null>(null);
  const [whatsNew, setWhatsNew] = useState<DialogSlot<WhatsNew> | null>(null);
  const started = useRef(false);
  const { tabHrefOf, openArticle } = shell;

  const read = useCallback(
    (ids: string[]) => void markNewsRead(client, ids).catch(() => {}),
    [client],
  );
  const open = useCallback(
    (n: NewsItem) => {
      setItem(openSlot(n));
      if (!n.read) read([n.id]);
    },
    [read],
  );

  // Только сразу после входа (отметка страницы входа), не при перезагрузке. Запрос не отменяется при
  // повторном запуске эффекта: отметка уже снята.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!takeSignedIn()) return;
    fetchWhatsNew()
      .then((wn) => {
        if (!wn.items.length) return;
        read(wn.items.map((n) => n.id));
        setTimeout(() => setWhatsNew(openSlot(wn)), WHATS_NEW_DELAY_MS);
      })
      .catch(() => {});
  }, [read]);

  const controls = useMemo<NewsControls>(
    () => ({
      open,
      hrefOf: (module, tab) => (isModuleId(module) ? tabHrefOf(module, tab ?? undefined) : null),
      openArticle: (id) => openArticle({ id }),
    }),
    [open, tabHrefOf, openArticle],
  );

  const overlays = (
    <>
      {item ? (
        <NewsDialog
          key={`news-${item.n}`}
          item={item.data}
          open={item.open}
          onClose={() => setItem(closeSlot)}
        />
      ) : null}
      {whatsNew ? (
        <WhatsNewDialog
          key={`whats-new-${whatsNew.n}`}
          data={whatsNew.data}
          open={whatsNew.open}
          onClose={() => setWhatsNew(closeSlot)}
          newsHref={shell.newsHref}
          lessonsHref={shell.lessonsHref}
        />
      ) : null}
    </>
  );
  return { controls, overlays };
}

/**
 * Ссылки новости (прототип: обработчик `[data-mdmod],[data-mdart]` и newsLinkOk): модуль из меню —
 * переход (окно закрывается, запись истории заменяется), статья — окно статьи поверх; нет модуля в
 * меню или статья недоступна — уведомление. В редакторе Админки (`preview`) ссылки не работают.
 */
export function useNewsLinks({ preview = false }: { preview?: boolean } = {}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const client = useQueryClient();
  const news = useNews();
  const { leave } = useWindow();

  const follow = useCallback(
    (link: NewsInnerLink) => {
      if (preview) return toast(t('news.link.in_editor'), { icon: 'info' });
      if (link.kind === 'mod') {
        const href = news.hrefOf(link.module, link.tab);
        if (!href) return toast(t('news.link.module_denied'), { icon: 'lock' });
        leave();
        router.replace(href);
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
    [preview, toast, t, news, leave, router, client],
  );
  return follow;
}

/**
 * «Подробнее: …» у новости со ссылкой (прототип newsLinkOk, newsLinkTxt): статья, видная
 * пользователю, или модуль из его меню; иначе кнопки нет.
 */
function useMoreLink(link: NewsLinkSchema | null) {
  const t = useT();
  const news = useNews();
  const router = useRouter();
  const { close, leave } = useWindow();
  const articles = useQuery({ ...kbArticlesQuery, enabled: link?.kind === 'art' }).data;
  if (!link) return null;
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
      router.replace(href);
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
      <Icon name="right" size="sm" />
      {t('news.more', { title: more.title })}
    </button>
  );
}

/** Окно новости (прототип newsOpen): тип, «Закреплено», подробное описание, «Подробнее». */
function NewsDialog({
  item,
  open,
  onClose,
}: {
  item: NewsItem;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={item.title}
      sub={newsMeta(t, item)}
      label={item.title}
      footer={<NewsFooter link={item.link} />}
    >
      <div data-news-dialog={item.id} className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <NewsTypePill type={item.type} t={t} />
          {item.pinned ? <Tag icon="star">{t('news.pinned')}</Tag> : null}
        </div>
        <NewsBody source={item.md} />
      </div>
    </Modal>
  );
}

function NewsFooter({ link }: { link: NewsLinkSchema | null }) {
  const t = useT();
  const { close } = useWindow();
  return (
    <>
      <div className="flex-1" />
      <MoreButton link={link} />
      <button type="button" onClick={close} className={buttonClass('cta')}>
        {t('news.close')}
      </button>
    </>
  );
}

/** Подробное описание со ссылками внутри окна. */
export function NewsBody({ source, preview = false }: { source: string; preview?: boolean }) {
  const follow = useNewsLinks({ preview });
  return <NewsMarkdown source={source} onLink={follow} />;
}

/**
 * «Что нового» (ТЗ «Окно «Что нового» при входе»; прототип whatsNew): непрочитанные новости
 * «Показывать при входе» с подробным описанием, от новых к старым; в самый первый раз — приветствие и
 * «Открыть Базу знаний». «Все новости» — вкладка «Новости», «Понятно» — закрыть.
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
        {data.items.map((item) => (
          <section
            key={item.id}
            data-whats-new-item={item.id}
            className="flex flex-col items-start gap-1.5 border-b border-line pt-1 pb-3.5 last:border-b-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <NewsTypePill type={item.type} t={t} />
              <span className="text-muted">{newsMeta(t, { ...item, editedAt: null })}</span>
              <NewsFreshPill t={t} />
            </div>
            <h3 className="m-0 mt-0.5 text-[16px] font-bold">{item.title}</h3>
            <div className="w-full">
              <NewsBody source={item.md} />
            </div>
            <MoreButton link={item.link} small />
          </section>
        ))}
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
