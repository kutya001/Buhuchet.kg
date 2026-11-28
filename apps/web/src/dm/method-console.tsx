'use client';

import type { AdminApiMethodCard } from '@buhuchet/shared';
import { buttonClass, Icon, useToast, useWindow } from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { apiMethodCardQuery } from '../admin/techdocs-data';
import { useErrorText, useT } from '../l10n/provider';
import { ApiFailure } from '../api-client';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { consoleSchemaQuery } from './console-data';
import { methodSqlOf, methodToConsole } from './console-model';
import { buildStore } from './build-store';
import { consoleOpen } from './console-store';

/**
 * Запрос метода API → консоль (доработки 27.11.2026: консоль запросов, блок 5; этап 1, П6; прототип v166
 * `dmcFromMethod`): по свежей карточке метода — точный SQL (только GET), перестроенный в SELECT, в своей
 * вкладке консоли; «Создать шаблон на основе» — та же вкладка и сразу окно шаблона. Метод ничего не
 * выполняет: кнопки только передают текст. Метод чтения без точного SQL (запрос написан кодом) — окно
 * «Собрать запрос» с таблицами, которые метод читает (этап 2, П9; прототип v167 `dmcMethodBuild`); у
 * списка методов признака SQL нет, поэтому так отвечают и его кнопки (docs/deviations.md п. О-103).
 */
export function useMethodConsole() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const router = useRouter();
  const path = usePathname();
  const { userId } = useShell();

  return useCallback(
    async (id: string, toTemplate: boolean, leave: boolean, known?: AdminApiMethodCard) => {
      let card = known;
      if (!card) {
        try {
          card = await client.fetchQuery(apiMethodCardQuery(id));
        } catch (err) {
          return toast(err instanceof ApiFailure ? errorText(err.error) : t('err.unknown'), {
            icon: 'alert',
            bad: true,
          });
        }
      }
      if (card.method === 'GET' && !methodSqlOf(card)) return buildByMethod(card, t);
      const schema = await client.fetchQuery(consoleSchemaQuery).catch(() => null);
      const open = methodToConsole(
        card,
        schema,
        toTemplate,
        t('dm.con.rw.svc_comment', { list: '{list}' }),
      );
      if (!open) {
        return toast(t(methodSqlOf(card) ? 'dm.con.api.not_select' : 'dm.con.api.code'), {
          icon: 'alert',
          bad: true,
        });
      }
      consoleOpen(userId ?? '', open);
      const href = tabHref('dm', 'con');
      if (leave) router.replace(href);
      else if (path !== href) router.push(href);
    },
    [client, toast, errorText, t, userId, router, path],
  );
}

/**
 * «Собрать запрос по таблицам метода» (блок 5, пункт 3; прототип `dmcMethodBuild`): таблицы, которые
 * метод читает, — в сборщик; вкладка получит пометку метода «Собрано по таблицам метода: …».
 */
export function buildByMethod(card: AdminApiMethodCard, t: ReturnType<typeof useT>) {
  const names = card.reads.map((x) => x.name);
  const from = `${card.method} ${card.path}`;
  buildStore.open(names, {
    method: from,
    notes: {
      from,
      changed: [{ code: 'built', vars: { list: names.join(', ') || t('dm.b.none_list') } }],
      replace: [],
      money: [],
    },
  });
}

/** У метода есть кнопки консоли: метод чтения с точным SQL (прототип `dmcMethodSql`). */
export const methodHasConsole = (card: AdminApiMethodCard) =>
  card.method === 'GET' && methodSqlOf(card) !== null;

/**
 * Кнопки подвала карточки метода API (прототип `admin/techdocs.js` `td-con`, `td-tpl`): «Открыть в
 * консоли» и «Создать шаблон на основе». Переход из окна — с заменой записи истории.
 */
export function MethodConsoleButtons({ card }: { card: AdminApiMethodCard }) {
  const t = useT();
  const { leave } = useWindow();
  const toConsole = useMethodConsole();
  if (card.method === 'GET' && !methodSqlOf(card)) {
    return (
      <button
        type="button"
        className={buttonClass('default')}
        data-td-bld=""
        onClick={() => {
          leave();
          buildByMethod(card, t);
        }}
      >
        <Icon name="layers" size="sm" />
        {t('dm.b.method')}
      </button>
    );
  }
  if (!methodHasConsole(card)) return null;
  const go = (toTemplate: boolean) => {
    leave();
    void toConsole(card.id, toTemplate, true, card);
  };
  return (
    <>
      <button
        type="button"
        className={buttonClass('default')}
        data-td-con=""
        onClick={() => go(false)}
      >
        <Icon name="code" size="sm" />
        {t('dm.con.api.open')}
      </button>
      <button
        type="button"
        className={buttonClass('default')}
        data-td-tpl=""
        onClick={() => go(true)}
      >
        <Icon name="layers" size="sm" />
        {t('dm.con.api.tpl')}
      </button>
    </>
  );
}
