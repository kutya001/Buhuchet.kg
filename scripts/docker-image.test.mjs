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

test('.npmrc не включает engine-strict: с ним Dependabot не открывает PR с пакетами', () => {
  const settings = read('.npmrc')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[#;]/.test(l));
  assert.ok(!settings.some((l) => /^engine[-_]strict\s*=/i.test(l)), settings.join('\n'));
});

test('образ ставит пакеты со строгой проверкой версии Node.js, и она — из .nvmrc', () => {
  const base = stage(read('Dockerfile'), 'base');
  assert.equal(env(base, 'npm_config_engine_strict'), 'true');
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
