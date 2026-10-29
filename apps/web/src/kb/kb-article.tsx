'use client';

import type { KbArticle } from '@buhuchet/shared';
import { buttonClass, Icon, Modal, useWindow } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../l10n/provider';
import { kbArticleQuery } from './kb-data';
import { useKb } from './kb-provider';

/**
 * Окно статьи «Базы знаний» (прототип modules/kb.js, kbArtDlg): текст статьи блоками без разметки,
 * описания экранов модулей (`kbScreenHtml`) и «Конец статьи». Статья прочитана, когда её дочитали до
 * последнего абзаца; короткая, которая видна целиком, — через 2 секунды. Из «?» в шапке — с кнопкой
 * «Открыть Базу знаний» и «Показать экран» (задача 2.31).
 */

type Block = KbArticle['blocks'][number];
type Inline = Extract<Block, { inline: unknown }>['inline'];
type ListItem = Extract<Block, { type: 'list' }>['items'][number];

/** Короткая статья, которая видна целиком, считается прочитанной через столько, мс. */
const SHORT_READ_MS = 2000;

export interface ArticleView {
  id: string;
  /** Шаг, из которого статью открыли: его «Посмотреть» засчитается чтением. */
  stepId?: string;
  /** Открыта из «?» в шапке. */
  help?: boolean;
}

export interface ArticleScreenInfo {
  /** Модуль сейчас на экране. */
  moduleId: string | null;
  /** Адрес модуля; null — модуля нет в меню. */
  hrefOf: (module: string) => string | null;
  /** Видимые вкладки модуля с подписями — для описания экрана. */
  tabsOf: (module: string) => readonly { id: string; label: string }[];
  kbHref: string;
}

export function KbArticleDialog({
  view,
  open,
  onClose,
  onRead,
  info,
}: {
  view: ArticleView;
  open: boolean;
  onClose: () => void;
  /** Статья дочитана до конца (один раз за открытие). */
  onRead: (view: ArticleView) => void;
  info: ArticleScreenInfo;
}) {
  const t = useT();
  const article = useQuery(kbArticleQuery(view.id)).data;
  const end = useRef<HTMLDivElement>(null);
  const read = useRef(false);

  useEffect(() => {
    const el = end.current;
    if (!open || !el || !article) return;
    const opened = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const done = () => {
      if (read.current) return;
      read.current = true;
      onRead(view);
    };
    const observer = new IntersectionObserver(([entry]) => {
      const short = first;
      first = false;
      clearTimeout(timer);
      if (!entry?.isIntersecting) return;
      // Видна целиком сразу — короткая статья: прочитана через 2 секунды, если окно ещё открыто.
      if (short) timer = setTimeout(done, Math.max(0, SHORT_READ_MS - (Date.now() - opened)));
      else done();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [open, article, onRead, view]);

  if (!article) return null;
  const module = article.module;
  const goHref = module && module !== info.moduleId ? info.hrefOf(module) : null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="card"
      size="wide"
      title={article.title}
      sub={
        <>
          {t('kb.art.sub', { section: article.section })}
          {article.read ? (
            <>
              {' · '}
              <span className="text-ok">{t('kb.art.read')}</span>
            </>
          ) : null}
        </>
      }
      label={article.title}
      footer={
        <ArticleFooter
          help={!!view.help}
          kbHref={info.kbHref}
          goHref={goHref}
          screen={module && info.hrefOf(module) ? module : null}
          here={module === info.moduleId}
        />
      }
    >
      <div data-kb-article={article.id} className="max-w-[820px] text-[14px] leading-[1.6]">
        {article.blocks.map((b, i) => (
          <ArticleBlock key={i} block={b} article={article} info={info} />
        ))}
      </div>
      <div
        ref={end}
        aria-hidden="true"
        data-kb-article-end=""
        className="mt-[18px] mb-1 flex items-center justify-center gap-1.5 border-t border-dashed border-line pt-2.5 text-[12px] text-faint"
      >
        <Icon name="ok" size="sm" />
        {t('kb.art.end')}
      </div>
    </Modal>
  );
}

function ArticleFooter({
  help,
  kbHref,
  goHref,
  screen,
  here,
}: {
  help: boolean;
  kbHref: string;
  goHref: string | null;
  /** Модуль статьи доступен: «Показать экран» (задача 2.31). */
  screen: string | null;
  /** Статья о модуле, который сейчас открыт. */
  here: boolean;
}) {
  const t = useT();
  const kb = useKb();
  const { close, leave } = useWindow();
  return (
    <>
      {help ? (
        <Link href={kbHref} replace onClick={leave} className={buttonClass('ghost')}>
          <Icon name="grad" size="sm" />
          {t('kb.open')}
        </Link>
      ) : null}
      <div className="flex-1" />
      {screen ? (
        <button
          type="button"
          data-kb-show-screen=""
          className={buttonClass()}
          title={t('kb.show.screen_hint')}
          onClick={() => {
            close();
            kb.showScreen(here ? null : screen);
          }}
        >
          <Icon name="play" size="sm" />
          {t('kb.show.screen')}
        </button>
      ) : null}
      {goHref ? (
        <Link href={goHref} replace onClick={leave} className={buttonClass()}>
          <Icon name="right" size="sm" />
          {t('kb.art.go_module')}
        </Link>
      ) : null}
      <button type="button" onClick={close} className={buttonClass('cta')}>
        {t('btn.close')}
      </button>
    </>
  );
}

function Text({ inline }: { inline: Inline }) {
  return (
    <>
      {inline.map((x, i) =>
        x.bold ? <b key={i}>{x.text}</b> : <Fragment key={i}>{x.text}</Fragment>,
      )}
    </>
  );
}

const H4 = 'mt-[18px] mb-1.5 text-[15px] font-bold first:mt-0';
const H5 = 'mt-[18px] mb-1.5 text-[14px] font-bold first:mt-0';
const LIST = 'my-1.5 pl-[22px] [&_li]:my-[3px]';

function ArticleBlock({
  block,
  article,
  info,
}: {
  block: Block;
  article: KbArticle;
  info: ArticleScreenInfo;
}) {
  switch (block.type) {
    case 'h4':
      return (
        <h4 className={H4}>
          <Text inline={block.inline} />
        </h4>
      );
    case 'h5':
      return (
        <h5 className={H5}>
          <Text inline={block.inline} />
        </h5>
      );
    case 'p':
      return (
        <p className="my-2">
          <Text inline={block.inline} />
        </p>
      );
    case 'quote':
      return (
        <blockquote className="my-2 rounded-md border-l-[3px] border-line-strong bg-pane-alt px-3 py-2">
          <Text inline={block.inline} />
        </blockquote>
      );
    case 'list':
      return <ListView node={nestList(block.items)} />;
    case 'screen':
      return <ScreenView module={block.module} article={article} info={info} />;
  }
}

interface ListNode {
  ordered: boolean;
  items: { inline: Inline; sub: ListNode[] }[];
}

/** Пункты списка с глубиной — обратно во вложенные списки. */
export function nestList(items: readonly ListItem[]): ListNode {
  const root: ListNode = { ordered: items[0]?.ordered ?? false, items: [] };
  const stack: { depth: number; node: ListNode }[] = [{ depth: items[0]?.depth ?? 0, node: root }];
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1]!.depth > item.depth) stack.pop();
    let top = stack[stack.length - 1]!;
    if (item.depth > top.depth) {
      const node: ListNode = { ordered: item.ordered, items: [] };
      const parent = top.node.items[top.node.items.length - 1];
      if (parent) parent.sub.push(node);
      else top.node.items.push({ inline: [], sub: [node] });
      stack.push({ depth: item.depth, node });
      top = stack[stack.length - 1]!;
    }
    top.node.items.push({ inline: item.inline, sub: [] });
  }
  return root;
}

function ListView({ node }: { node: ListNode }) {
  const items = node.items.map((it, i) => (
    <li key={i}>
      <Text inline={it.inline} />
      {it.sub.map((s, j) => (
        <ListView key={j} node={s} />
      ))}
    </li>
  ));
  return node.ordered ? (
    <ol className={`${LIST} list-decimal`}>{items}</ol>
  ) : (
    <ul className={`${LIST} list-disc`}>{items}</ul>
  );
}

/** Описание экрана модуля (прототип kbScreenHtml): вкладки, кнопки и элементы, формы и поля. */
function ScreenView({
  module,
  article,
  info,
}: {
  module: string;
  article: KbArticle;
  info: ArticleScreenInfo;
}) {
  const t = useT();
  const screen = article.screens[module];
  if (!screen) return null;
  const tabs = info.tabsOf(module);
  const item = (key: string | number, name: ReactNode, text: string) => (
    <li key={key}>
      <b>{name}</b>
      {text ? ` — ${text}` : ''}
    </li>
  );
  return (
    <>
      {tabs.length ? (
        <>
          <h5 className={H5}>{t('kb.screen.tabs')}</h5>
          <ul className={`${LIST} list-disc`}>
            {tabs.map((tab) =>
              item(tab.id, t('kb.screen.quoted', { name: tab.label }), screen.tabs[tab.id] ?? ''),
            )}
          </ul>
        </>
      ) : null}
      {screen.items.length ? (
        <>
          <h5 className={H5}>{t('kb.screen.items')}</h5>
          <ul className={`${LIST} list-disc`}>
            {screen.items.map((x, i) =>
              item(
                i,
                x.kind === 'el'
                  ? x.name
                  : t(x.kind === 'plate' ? 'kb.screen.plate' : 'kb.screen.quoted', {
                      name: x.name,
                    }),
                x.text,
              ),
            )}
          </ul>
        </>
      ) : null}
      {screen.forms.map((f, i) => (
        <Fragment key={i}>
          <h5 className={H5}>{f.title}</h5>
          {f.text ? <p className="my-2">{f.text}</p> : null}
          <ul className={`${LIST} list-disc`}>
            {f.fields.map((field, j) =>
              item(
                j,
                field.required ? t('kb.screen.required', { name: field.name }) : field.name,
                field.text,
              ),
            )}
          </ul>
        </Fragment>
      ))}
    </>
  );
}
