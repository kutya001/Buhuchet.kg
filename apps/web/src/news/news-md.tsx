'use client';

import {
  newsMdBlocks,
  type NewsLink,
  type NewsListItem,
  type NewsMdBlock,
  type NewsSpan,
} from '@buhuchet/domain';
import { Fragment, useMemo, type MouseEvent, type ReactNode } from 'react';

/*
 * Подробное описание новости (прототип modules/kb-news.js, mdHtml и `.kb-art.md`): блоки разбирает
 * домен (`newsMdBlocks`), здесь они становятся элементами React — HTML из текста не выполняется.
 * Ссылки на модуль (`#mod:reports`, `#mod:dicts.types`) и статью (`#art:a5`) обрабатывает `onLink`:
 * модуля нет в меню или статья недоступна — уведомление, в редакторе — «сработает после публикации».
 */

/** Ссылка внутри платформы: модуль (вкладка) или статья Базы знаний. */
export type NewsInnerLink = Exclude<NewsLink, { kind: 'url' }>;

type TextSpan = Extract<NewsSpan, { text: string }>;

const H4 = 'mt-4 mb-1.5 text-[16px] font-bold first:mt-0';
const H5 = 'mt-3.5 mb-1 text-[14.5px] font-bold text-ink first:mt-0';
const LIST = 'my-1.5 pl-[22px] [&_li]:my-[3px]';
const CELL = 'border border-line px-[9px] py-[5px] text-left align-top';

export function NewsMarkdown({
  source,
  onLink,
  className = '',
}: {
  source: string;
  onLink: (link: NewsInnerLink) => void;
  className?: string;
}) {
  const blocks = useMemo(() => newsMdBlocks(source), [source]);
  return (
    <div data-news-md="" className={`max-w-[820px] text-[14px] leading-[1.6] ${className}`}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} onLink={onLink} />
      ))}
    </div>
  );
}

function Block({ block, onLink }: { block: NewsMdBlock; onLink: (link: NewsInnerLink) => void }) {
  switch (block.type) {
    case 'h4':
      return (
        <h4 className={H4}>
          <Spans spans={block.spans} onLink={onLink} />
        </h4>
      );
    case 'h5':
      return (
        <h5 className={H5}>
          <Spans spans={block.spans} onLink={onLink} />
        </h5>
      );
    case 'p':
      return (
        <p className="my-2 first:mt-0">
          <Spans spans={block.spans} onLink={onLink} />
        </p>
      );
    case 'quote':
      return (
        <blockquote className="my-2 rounded-md border-l-[3px] border-line-strong bg-pane-alt px-3 py-2">
          <Spans spans={block.spans} onLink={onLink} />
        </blockquote>
      );
    case 'hr':
      return <hr className="my-3.5 border-0 border-t border-line" />;
    case 'list':
      return <ListView node={nestList(block.items)} onLink={onLink} />;
    case 'table':
      return (
        <div className="my-2 overflow-x-auto">
          <table className="border-collapse text-[13px]">
            <thead>
              <tr>
                {block.head.map((c, j) => (
                  <th key={j} className={`${CELL} bg-pane-alt font-[650]`}>
                    <Spans spans={c} onLink={onLink} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td key={j} className={CELL}>
                      <Spans spans={c} onLink={onLink} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function styled(span: TextSpan): ReactNode {
  let node: ReactNode = span.code ? (
    <code className="rounded-[5px] bg-pane-alt px-[5px] py-px font-mono text-[12.5px]">
      {span.text}
    </code>
  ) : (
    span.text
  );
  if (span.italic) node = <i>{node}</i>;
  if (span.bold) node = <b>{node}</b>;
  return node;
}

/** Куски строки; соседние куски одной ссылки — одна ссылка (`[**жирный** текст](…)`). */
function Spans({ spans, onLink }: { spans: NewsSpan[]; onLink: (link: NewsInnerLink) => void }) {
  const out: ReactNode[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    if ('image' in s) {
      out.push(
        // Картинка новости: внешняя по https или из хранилища (/api/news/images/…), размеры заранее неизвестны.
        // Внешнему сайту адрес страницы не передаётся.
        <img
          key={i}
          src={s.image}
          alt={s.alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-w-full rounded-lg border border-line align-middle"
        />,
      );
      continue;
    }
    const link = s.link;
    if (!link) {
      out.push(<Fragment key={i}>{styled(s)}</Fragment>);
      continue;
    }
    const parts: ReactNode[] = [];
    let j = i;
    for (; j < spans.length; j++) {
      const x = spans[j]!;
      if ('image' in x || x.link !== link) break;
      parts.push(<Fragment key={j}>{styled(x)}</Fragment>);
    }
    i = j - 1;
    out.push(
      link.kind === 'url' ? (
        <a
          key={i}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link underline underline-offset-2"
        >
          {parts}
        </a>
      ) : (
        <a
          key={i}
          href="#"
          data-news-link={link.kind === 'art' ? `art:${link.id}` : `mod:${link.module}`}
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            onLink(link);
          }}
          className="text-link underline underline-offset-2"
        >
          {parts}
        </a>
      ),
    );
  }
  return <>{out}</>;
}

interface ListNode {
  ordered: boolean;
  items: { spans: NewsSpan[]; sub: ListNode[] }[];
}

/** Пункты списка с глубиной — обратно во вложенные списки (как у статей Базы знаний). */
function nestList(items: readonly NewsListItem[]): ListNode {
  const root: ListNode = { ordered: items[0]?.ordered ?? false, items: [] };
  const stack: { depth: number; node: ListNode }[] = [{ depth: items[0]?.depth ?? 0, node: root }];
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1]!.depth > item.depth) stack.pop();
    let top = stack[stack.length - 1]!;
    if (item.depth > top.depth) {
      const node: ListNode = { ordered: item.ordered, items: [] };
      const parent = top.node.items[top.node.items.length - 1];
      if (parent) parent.sub.push(node);
      else top.node.items.push({ spans: [], sub: [node] });
      stack.push({ depth: item.depth, node });
      top = stack[stack.length - 1]!;
    }
    top.node.items.push({ spans: item.spans, sub: [] });
  }
  return root;
}

function ListView({ node, onLink }: { node: ListNode; onLink: (link: NewsInnerLink) => void }) {
  const items = node.items.map((it, i) => (
    <li key={i}>
      <Spans spans={it.spans} onLink={onLink} />
      {it.sub.map((s, j) => (
        <ListView key={j} node={s} onLink={onLink} />
      ))}
    </li>
  ));
  return node.ordered ? (
    <ol className={`${LIST} list-decimal`}>{items}</ol>
  ) : (
    <ul className={`${LIST} list-disc`}>{items}</ul>
  );
}
