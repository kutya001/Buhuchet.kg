const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hpfemrvqmlvhqbdmogcl.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZmVtcnZxbWx2aHFiZG1vZ2NsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTE2MTYyMywiZXhwIjoyMTAwNzM3NjIzfQ.0TdmoBTCf8KUEpP0g4tc8n8psMj5aM8T0Neuhk_9pK4';

const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const testCases = [
  {
    company: {
      name: 'ОсОО «Бишкек Трейд Логистик»',
      inn: '10101202410011',
      industry: 'Транспорт и Логистика',
      director_name: 'Асанов Асан Асанович',
      email: 'info@bishkek-trade.kg',
      phone: '+996 (555) 10-10-11',
      legal_address: 'г. Бишкек, ул. Лермонтова 12',
      address: 'г. Бишкек, ул. Лермонтова 12',
      status: 'active',
      is_active: true
    },
    user: {
      email: 'owner1@buhuchet.kg',
      password: 'Password123!',
      full_name: 'Асанов Асан Асанович'
    }
  },
  {
    company: {
      name: 'ОсОО «Азия Софт Технологии»',
      inn: '20202202410022',
      industry: 'Услуги / Консалтинг',
      director_name: 'Бакиров Батыр Каримович',
      email: 'contact@asia-soft.kg',
      phone: '+996 (700) 20-20-22',
      legal_address: 'г. Бишкек, пр. Чуй 265',
      address: 'г. Бишкек, пр. Чуй 265',
      status: 'active',
      is_active: true
    },
    user: {
      email: 'owner2@buhuchet.kg',
      password: 'Password123!',
      full_name: 'Бакиров Батыр Каримович'
    }
  },
  {
    company: {
      name: 'ОсОО «Шелковый Путь Ритейл»',
      inn: '30303202410033',
      industry: 'Торговля (Опт / Розница)',
      director_name: 'Сулайманов Элдияр Нурланович',
      email: 'sales@silk-way.kg',
      phone: '+996 (770) 30-30-33',
      legal_address: 'г. Ош, ул. Ленина 45',
      address: 'г. Ош, ул. Ленина 45',
      status: 'pending_approval',
      is_active: true
    },
    user: {
      email: 'owner3@buhuchet.kg',
      password: 'Password123!',
      full_name: 'Сулайманов Элдияр Нурланович'
    }
  }
];

async function seed() {
  console.log('--- Начинаем сидинг тестовых компаний и пользователей ---');

  for (const tc of testCases) {
    console.log(`\nОбработка: ${tc.company.name}`);

    // 1. Создаем или находим компанию
    let { data: existingComp } = await adminSupabase
      .from('companies')
      .select('id')
      .eq('inn', tc.company.inn)
      .maybeSingle();

    let companyId;
    if (existingComp) {
      companyId = existingComp.id;
      await adminSupabase.from('companies').update(tc.company).eq('id', companyId);
      console.log(`  Компания обновлена: ${companyId}`);
    } else {
      const { data: newComp, error: compErr } = await adminSupabase
        .from('companies')
        .insert(tc.company)
        .select()
        .single();
      if (compErr) {
        console.error(`  Ошибка создания компании: ${compErr.message}`);
        continue;
      }
      companyId = newComp.id;
      console.log(`  Компания создана: ${companyId}`);
    }

    // 2. Создаем или находим пользователя в Auth
    const { data: userList } = await adminSupabase.auth.admin.listUsers();
    let authUser = userList.users.find(u => u.email === tc.user.email);

    if (!authUser) {
      const { data: newAuth, error: authErr } = await adminSupabase.auth.admin.createUser({
        email: tc.user.email,
        password: tc.user.password,
        email_confirm: true,
        user_metadata: { full_name: tc.user.full_name }
      });
      if (authErr) {
        console.error(`  Ошибка создания Auth пользователя: ${authErr.message}`);
        continue;
      }
      authUser = newAuth.user;
      console.log(`  Auth пользователь создан: ${authUser.id}`);
    } else {
      await adminSupabase.auth.admin.updateUserById(authUser.id, { password: tc.user.password });
      console.log(`  Auth пользователь найден и обновлен: ${authUser.id}`);
    }

    // 3. Создаем/обновляем профиль пользователя в public.users
    const { error: userErr } = await adminSupabase.from('users').upsert({
      id: authUser.id,
      email: tc.user.email,
      full_name: tc.user.full_name,
      company_id: companyId,
      role: 'owner',
      is_super_admin: false,
      is_active: true,
      updated_at: new Date().toISOString()
    });

    if (userErr) {
      console.error(`  Ошибка обновления профиля: ${userErr.message}`);
    } else {
      console.log(`  Профиль public.users привязан к компании ${companyId}`);
    }

    // 4. Подписка
    await adminSupabase.from('subscriptions').upsert({
      company_id: companyId,
      plan_type: 'pro',
      status: 'active',
      updated_at: new Date().toISOString()
    }, { onConflict: 'company_id' });
  }

  console.log('\n--- Сидинг успешно завершен! ---');
}

seed();
