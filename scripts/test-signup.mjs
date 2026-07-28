import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hpfemrvqmlvhqbdmogcl.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZmVtcnZxbWx2aHFiZG1vZ2NsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTE2MTYyMywiZXhwIjoyMTAwNzM3NjIzfQ.0TdmoBTCf8KUEpP0g4tc8n8psMj5aM8T0Neuhk_9pK4';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZmVtcnZxbWx2aHFiZG1vZ2NsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE2MjMsImV4cCI6MjEwMDczNzYyM30.ICzSO8kYM5pmFXE5ZwpWR65EFqStN9csZwnB3en-hWg';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
const supabaseAnon = createClient(supabaseUrl, anonKey);

async function run() {
  console.log('1. Регистрируем Суперадмина через createUser...');

  const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: 'admin@buhuchet.kg',
    password: 'SuperAdmin2026!',
    email_confirm: true,
    user_metadata: { full_name: 'Kutman' },
  });

  if (createError) {
    console.error('❌ Ошибка createUser (admin@buhuchet.kg):', createError.message);

    console.log('Пробуем зарегистрировать admin.buhuchet@gmail.com...');
    const { data: gData, error: gError } = await supabaseAdmin.auth.admin.createUser({
      email: 'admin.buhuchet@gmail.com',
      password: 'SuperAdmin2026!',
      email_confirm: true,
      user_metadata: { full_name: 'Kutman' },
    });

    if (gError) {
      console.error('❌ Ошибка createUser (gmail.com):', gError.message);
      return;
    }
    console.log('✅ Успешно создан admin.buhuchet@gmail.com!', gData.user.id);
  } else {
    console.log('✅ Успешно создан admin@buhuchet.kg!', createData.user.id);
  }

  console.log('2. Проверяем авторизациючерез signInWithPassword...');
  const testEmail = createError ? 'admin.buhuchet@gmail.com' : 'admin@buhuchet.kg';
  const { data: loginData, error: loginError } = await supabaseAnon.auth.signInWithPassword({
    email: testEmail,
    password: 'SuperAdmin2026!',
  });

  if (loginError) {
    console.error('❌ Ошибка входа:', loginError.message);
  } else {
    console.log('🎉 УСПЕШНЫЙ ВХОД В SUPABASE AUTH! User ID:', loginData.user?.id);
  }
}

run().catch(console.error);
