import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Простая загрузка переменных из .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...values] = trimmed.split('=');
      if (key && values.length > 0) {
        process.env[key.trim()] = values.join('=').trim();
      }
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Переменные окружения Supabase отсутствуют в .env.local');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function seed() {
  console.log('🚀 Начинаем сидирование тестовых аккаунтов в Supabase Auth...');

  const usersToSeed = [
    {
      email: 'admin@buhuchet.kg',
      password: 'SuperAdmin2026!',
      fullName: 'Главный Администратор',
      phone: '+996700000000',
      isSuperAdmin: true,
      role: 'owner',
    },
    {
      email: 'owner@buhuchet.kg',
      password: 'OwnerPass2026!',
      fullName: 'Асан Усенов (Владелец)',
      phone: '+996700123456',
      isSuperAdmin: false,
      role: 'owner',
    },
    {
      email: 'manager@buhuchet.kg',
      password: 'ManagerPass2026!',
      fullName: 'Бектур Алмазов (Менеджер)',
      phone: '+996550987654',
      isSuperAdmin: false,
      role: 'manager',
    },
  ];

  for (const u of usersToSeed) {
    // 1. Проверяем, существует ли пользователь в Auth
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = listData?.users?.find((item) => item.email === u.email);

    let userId = existingUser?.id;

    if (!existingUser) {
      const { data: createAuthData, error: createAuthError } =
        await supabaseAdmin.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { full_name: u.fullName },
        });

      if (createAuthError) {
        console.error(`❌ Ошибка при создании auth.users для ${u.email}:`, createAuthError.message);
        continue;
      }
      userId = createAuthData.user?.id;
    } else {
      console.log(`ℹ️ Аккаунт ${u.email} уже существует в Auth. Обновляем пароль...`);
      await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
        password: u.password,
        email_confirm: true,
      });
    }

    if (userId) {
      // 2. Вставляем/обновляем запись профиля в таблице public.users
      const { error: profileError } = await supabaseAdmin.from('users').upsert(
        {
          id: userId,
          full_name: u.fullName,
          email: u.email,
          phone: u.phone,
          is_super_admin: u.isSuperAdmin,
          role: u.role,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

      if (profileError) {
        console.error(`❌ Ошибка при обновлении public.users для ${u.email}:`, profileError.message);
      } else {
        console.log(`✅ Пользователь ${u.email} (${u.fullName}) успешно сидирован!`);
      }
    }
  }

  console.log('🎉 Сидирование 3 аккаунтов завершено успешно!');
}

seed();
