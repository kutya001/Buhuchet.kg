import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Образ сайта (Dockerfile, стадия web): сервер Next.js держит простаивающее соединение дольше, чем
// обратный прокси (Caddy) и клиенты сквозных тестов, — иначе они шлют запрос в уже закрытое
// соединение («socket hang up», 502; docs/decisions.md п. О-55, docs/typical-mistakes.md № 26).

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/** Строки стадии `FROM … AS <name>` до следующей стадии (продолжения строк `\` склеены). */
function stage(dockerfile, name) {
  const lines = dockerfile.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/);
  const start = lines.findIndex((l) =>
    new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, 'i').test(l),
  );
  assert.ok(start >= 0, `нет стадии ${name}`);
  const end = lines.findIndex((l, i) => i > start && /^FROM\s/i.test(l));
  return lines.slice(start, end < 0 ? undefined : end);
}

/** Значение переменной стадии: последнее `ENV` с ней (так применяет Docker), формы `K=v` и `K v`. */
function env(lines, key) {
  let value;
  for (const line of lines) {
    const m = /^ENV\s+(.*)$/i.exec(line.trim());
    if (!m) continue;
    const old = new RegExp(`^${key}\\s+(.+)$`).exec(m[1]);
    if (old) value = old[1].trim();
    for (const pair of m[1].matchAll(new RegExp(`(?:^|\\s)${key}=("[^"]*"|\\S*)`, 'g'))) {
      value = pair[1];
    }
  }
  return value?.replace(/^"(.*)"$/, '$1');
}

/** Сколько миллисекунд Caddy держит соединение с сайтом: `keepalive` в Caddyfile, иначе его 2 мин. */
function caddyKeepAliveMs(caddyfile) {
  const m = /^\s*keepalive\s+(\d+)(ms|s|m)\s*$/m.exec(caddyfile);
  if (!m) return 120_000;
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000 }[m[2]];
}

const web = stage(read('Dockerfile'), 'web');
const keepAlive = Number(env(web, 'KEEP_ALIVE_TIMEOUT'));

test('сайт держит простаивающее соединение дольше обратного прокси, но не часами', () => {
  assert.ok(Number.isInteger(keepAlive), 'KEEP_ALIVE_TIMEOUT не задан числом');
  const caddy = caddyKeepAliveMs(read('docker/Caddyfile'));
  assert.ok(keepAlive > caddy, `KEEP_ALIVE_TIMEOUT = ${keepAlive}, у Caddy — ${caddy}`);
  assert.ok(keepAlive <= 300_000, `KEEP_ALIVE_TIMEOUT = ${keepAlive}`);
});

test('переменную читает сервер образа: standalone server.js Next.js, а не `next start`', () => {
  assert.ok(
    web.some((l) => /^CMD\s+\[\s*"node"\s*,\s*"apps\/web\/server\.js"\s*\]\s*$/.test(l.trim())),
    'CMD стадии web — не node apps/web/server.js',
  );
  // Шаблон server.js сборки standalone (next build): он передаёт значение в startServer.
  const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const template = readFileSync(require.resolve('next/dist/build/utils.js'), 'utf8');
  assert.match(template, /process\.env\.KEEP_ALIVE_TIMEOUT/);
});

test('compose не переопределяет KEEP_ALIVE_TIMEOUT образа', () => {
  for (const file of ['docker-compose.yml', 'docker-compose.prod.yml']) {
    assert.doesNotMatch(read(file), /KEEP_ALIVE_TIMEOUT/, file);
  }
});

// Версия Node.js: строгая проверка `engines` живёт в сборке образа, а не в .npmrc — с `engine-strict`
// в .npmrc Dependabot (у него своя версия Node.js) не мог обновить ни одного пакета и молчал об этом
// (docs/decisions.md п. О-67, docs/typical-mistakes.md № 82).

/** Строки настроек без пустых и без комментариев (`#`, в .npmrc ещё `;`). */
const settings = (file) =>
  read(file)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[#;]/.test(l));

test('.npmrc и pnpm-workspace.yaml не включают engine-strict: с ним Dependabot не открывает PR с пакетами', () => {
  // pnpm читает настройку из обоих файлов, Dependabot — тоже; значение не важно: строки быть не должно.
  assert.deepEqual(
    // Строка без «=» для pnpm тоже значит true.
    settings('.npmrc').filter((l) => /^["']?engine[-_]?strict["']?\s*(=|$)/i.test(l)),
    [],
  );
  assert.deepEqual(
    settings('pnpm-workspace.yaml').filter((l) => /^["']?engine[-_]?strict["']?\s*:/i.test(l)),
    [],
  );
});

/** Значение переменной в стадии с учётом стадий, от которых она взята (`FROM base AS deps`). */
function inheritedEnv(dockerfile, name, key) {
  const lines = stage(dockerfile, name);
  const own = env(lines, key);
  if (own !== undefined) return own;
  const parent = /^FROM\s+(\S+)\s+AS\s/i.exec(lines[0])[1];
  const isStage = new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${parent}\\s*$`, 'im').test(dockerfile);
  return isStage ? inheritedEnv(dockerfile, parent, key) : undefined;
}

test('образ ставит пакеты со строгой проверкой версии Node.js, и она — из .nvmrc', () => {
  const dockerfile = read('Dockerfile');
  const base = stage(dockerfile, 'base');
  assert.equal(env(base, 'npm_config_engine_strict'), 'true');
  // Каждая стадия, где pnpm ставит или скачивает пакеты, получает настройку и не выключает её.
  const installs = [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)\s*$/gim)]
    .map((m) => m[1])
    .filter((name) => stage(dockerfile, name).some((l) => /\bpnpm\s+(install|fetch)\b/.test(l)));
  assert.ok(installs.length > 0, 'в Dockerfile нет стадии с pnpm install');
  for (const name of installs) {
    assert.equal(inheritedEnv(dockerfile, name, 'npm_config_engine_strict'), 'true', name);
    assert.ok(
      !stage(dockerfile, name).some(
        (l) => /engine[-_]strict/i.test(l) && !/^(ENV|#)/i.test(l.trim()),
      ),
      `стадия ${name}: engine-strict задан в команде`,
    );
  }
  const image = /^FROM\s+node:(\d+)[.\-\s]/i.exec(base[0]);
  assert.ok(image, `образ стадии base — не node:<версия>: ${base[0]}`);
  assert.equal(image[1], read('.nvmrc').trim().replace(/^v/, '').split('.')[0]);
});

test('engines корня и сайта одинаковы и включают Node.js из .nvmrc', () => {
  const root = JSON.parse(read('package.json')).engines.node;
  const site = JSON.parse(read('apps/web/package.json')).engines.node;
  assert.equal(site, root);
  const range = /^>=(\d+)(?:\.\d+)* <(\d+)$/.exec(root);
  assert.ok(range, `engines.node — не «>=A.B <C»: ${root}`);
  const major = Number(read('.nvmrc').trim().replace(/^v/, '').split('.')[0]);
  assert.ok(major >= Number(range[1]) && major < Number(range[2]), `${major} вне ${root}`);
});
