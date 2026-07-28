import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hpfemrvqmlvhqbdmogcl.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZmVtcnZxbWx2aHFiZG1vZ2NsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTE2MTYyMywiZXhwIjoyMTAwNzM3NjIzfQ.0TdmoBTCf8KUEpP0g4tc8n8psMj5aM8T0Neuhk_9pK4';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const passMap = {
  'admin@buhuchet.kg': 'SuperAdmin2026!',
  'owner@buhuchet.kg': 'OwnerPassword123!',
  'manager@buhuchet.kg': 'ManagerPassword123!',
  'batysh@buhuchet.kg': 'Batysh2026!',
  'bishkeksoft@buhuchet.kg': 'Bishkeksoft2026!',
  'chuystroy@buhuchet.kg': 'Company2026!',
  'agroasia@buhuchet.kg': 'Company2026!',
  'janpz@buhuchet.kg': 'Company2026!',
  'pharma@buhuchet.kg': 'Company2026!',
  'asiaconsult@buhuchet.kg': 'Company2026!',
  'oshtextile@buhuchet.kg': 'Company2026!',
};

async function main() {
  console.log('🔍 Получаем текущий список пользователей GoTrue Auth...');

  const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();

  if (listError) {
    console.error('❌ Ошибка получения пользователей:', listError);
    return;
  }

  console.log(`Найдено ${listData.users.length} пользователей в GoTrue.`);

  for (const u of listData.users) {
    const password = passMap[u.email] || 'Company2026!';
    console.log(`Обновляем пароль для ${u.email} (ID: ${u.id})...`);

    const { data: upData, error: upErr } = await supabaseAdmin.auth.admin.updateUserById(
      u.id,
      {
        password: password,
        email_confirm: true,
      }
    );

    if (upErr) {
      console.error(`❌ Ошибка обновления ${u.email}:`, upErr.message);
    } else {
      console.log(`✅ Успешно обновлен GoTrue пароль для ${u.email}!`);
    }
  }

  // Тестовая попытка логина прямо здесь
  console.log('🧪 Проверяем авторизацию admin@buhuchet.kg через client.auth.signInWithPassword...');
  const anonClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email: 'admin@buhuchet.kg',
    password: 'SuperAdmin2026!',
  });

  if (signInError) {
    console.error('❌ Ошибка логина:', signInError.message);
  } else {
    console.log('🎉 УСПЕШНАЯ АВТОРИЗАЦИЯ SUPABASE AUTH (STATUS 200)! User ID:', signInData.user?.id);
  }
}

main().catch(console.error);
