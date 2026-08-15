const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

function lintMigrations() {
  console.log('🔍 Проверка миграций SQL на безопасность search_path в функциях SECURITY DEFINER...\n');

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`❌ Директория миграций не найдена: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  let hasErrors = false;

  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Поиск блоков функций с SECURITY DEFINER
    const functionRegex = /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+([^\s(]+)[\s\S]*?(?:SECURITY\s+DEFINER)[\s\S]*?\$\$(?:[\s\S]*?)\$\$\s*(?:LANGUAGE\s+[a-zA-Z]+)?\s*(?:SECURITY\s+DEFINER)?\s*;/gi;

    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      const fullDeclaration = match[0];
      const functionName = match[1];

      // Проверяем наличие явного SET search_path
      const hasSearchPath = /SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i.test(fullDeclaration);

      if (!hasSearchPath) {
        // Проверяем, не является ли это старой архивной миграцией
        console.warn(`⚠️ [WARN] В файле ${file} функция "${functionName}" использует SECURITY DEFINER без явного SET search_path = public, pg_temp;`);
        // Для миграций начиная с 20260815 это критическая ошибка
        if (file.startsWith('20260815') || file > '20260815') {
          console.error(`❌ [ERROR] Нарушение SEC-01 в новой миграции ${file}! Все новые функции с SECURITY DEFINER обязаны иметь SET search_path = public, pg_temp;`);
          hasErrors = true;
        }
      }
    }
  }

  if (hasErrors) {
    console.error('\n❌ Линтер миграций завершился с ошибками безопасности.');
    process.exit(1);
  } else {
    console.log('\n✅ Линтер миграций пройден успешно. Все функции изолированы.');
  }
}

lintMigrations();
