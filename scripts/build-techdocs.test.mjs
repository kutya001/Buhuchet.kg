import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildTechDocs, sourceVersion } from './build-techdocs.mjs';

// Данные «Технической документации» собираются по исходникам этого репозитория скриптом прототипа
// (spec/prototype/db/api_snapshot.py). Тест сверяет, что сборка даёт то, что читает сайт: описание API
// с методами и их таблицами, описание базы и страницу схемы с местом для встраивания данных.

test('сборка: снимок API по исходникам продукта, описание базы и страница схемы', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'techdocs-test-'));
  try {
    const made = buildTechDocs(dir);
    assert.equal(made.source, 'repo', `снимок не собран: ${made.note}`);

    const api = JSON.parse(readFileSync(path.join(dir, 'api.json'), 'utf8'));
    assert.ok(api.methods.length > 400, `методов: ${api.methods.length}`);
    assert.equal(api.meta.methods, api.methods.length);
    assert.match(api.meta.repo, /^[\w.-]+\/[\w.-]+$/);
    assert.match(api.meta.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const key of ['sections', 'views', 'fns', 'schemas', 'sql']) {
      assert.ok(key in api, `в снимке нет раздела ${key}`);
    }

    // Список учётных записей Админки читает пользователей через представление и ничего не меняет.
    const users = api.methods.find((m) => m.id === 'GET /admin/users');
    assert.ok(users, 'в снимке нет GET /admin/users');
    assert.equal(users.acc, 'admin');
    assert.ok(users.r.includes('users'));
    assert.deepEqual(users.w, []);
    assert.ok(
      users.q.every((i) => api.sql[i]),
      'запрос метода указывает мимо списка SQL',
    );
    assert.ok(users.code.some((c) => c.file.startsWith('packages/api/src/modules/admin/')));

    // Сам модуль тоже описан: его методы доступны только администратору платформы.
    const own = api.methods.filter((m) => m.p.startsWith('/admin/tech-docs'));
    assert.ok(own.length >= 8, `методов модуля: ${own.length}`);
    assert.ok(own.every((m) => m.acc === 'admin'));

    // У каждого метода — раздел с названием, доступ из известных, таблицы — списками имён.
    const access = new Set(['public', 'session', 'employee', 'perm', 'admin']);
    for (const m of api.methods) {
      assert.ok(api.sections[m.sec], `нет названия раздела ${m.sec} (${m.id})`);
      assert.ok(access.has(m.acc), `неизвестный доступ ${m.acc} (${m.id})`);
      assert.ok(Array.isArray(m.r) && Array.isArray(m.w), m.id);
      if (m.acc === 'perm') assert.ok(m.perm.length > 0, `метод с правом без прав: ${m.id}`);
    }

    const schema = JSON.parse(readFileSync(path.join(dir, 'schema.json'), 'utf8'));
    assert.ok(schema.tables.length > 50);
    assert.ok(schema.tables.some((t) => t.name === 'users' && t.ru));

    // Перед этим местом сайт встраивает данные страницы (schemaPageHtml в packages/api).
    const page = readFileSync(path.join(dir, 'page.html'), 'utf8');
    assert.ok(page.includes("<script>\n'use strict';"), 'в странице схемы нет начала скрипта');
    assert.ok(page.includes('window.TDX_IN'), 'страница схемы не читает встроенные данные');
    // Страница работает без сети: внешних скриптов, стилей и запросов в ней нет.
    assert.doesNotMatch(page, /<script[^>]+src=|<link[^>]+href=["']https?:/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('версия: коммит и дата из git, без git — из переменной сборки и сегодня', () => {
  const v = sourceVersion({});
  assert.match(v.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(v.commit, /^([0-9a-f]{7,40})?$/);
});
