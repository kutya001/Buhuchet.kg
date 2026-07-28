import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hpfemrvqmlvhqbdmogcl.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZmVtcnZxbWx2aHFiZG1vZ2NsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTE2MTYyMywiZXhwIjoyMTAwNzM3NjIzfQ.0TdmoBTCf8KUEpP0g4tc8n8psMj5aM8T0Neuhk_9pK4';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const companiesData = [
  { id: '8772ba39-4358-41df-bc06-2b9f62f47f57', name: 'ОсОО "Кумтор Голд Компани"', inn: '01203199810123', industry: 'Горнодобывающая отрасль', director: 'Алмазов Болот', email: 'info@kumtor.kg', phone: '+996312900700', address: 'г. Бишкек, ул. Ибраимова 24' },
  { id: 'da3d6acd-83fc-46b8-ab84-0949281a4493', name: 'ОсОО "Народный Трейд"', inn: '01502201010456', industry: 'Ритейл / Торговля', director: 'Касымов Бакыт', email: 'trade@narodnyi.kg', phone: '+996312600800', address: 'г. Бишкек, пр. Чуй 150' },
  { id: 'ef59cac0-c937-4505-b3f1-e8f5e6543a63', name: 'ЗАО "Батыш Логистик"', inn: '02008201510789', industry: 'Транспорт и Логистика', director: 'Исаев Марат', email: 'logistics@batysh.kg', phone: '+996322250900', address: 'г. Ош, ул. Ленина 45' },
  { id: 'ed77a717-e476-46fd-9a92-f8a0fe56a7ac', name: 'ОсОО "Бишкек Софт"', inn: '00501202010111', industry: 'IT и Телеком', director: 'Осмонов Азамат', email: 'contact@bishkeksoft.kg', phone: '+996555112233', address: 'г. Бишкек, ул. Токтогула 125' },
  { id: 'c1111111-1111-1111-1111-111111111111', name: 'ОсОО "Чуй Строй Групп"', inn: '01004201810222', industry: 'Строительство', director: 'Садыков Улан', email: 'build@chuy-stroy.kg', phone: '+996313251122', address: 'г. Кант, ул. Промышленная 12' },
  { id: 'c2222222-2222-2222-2222-222222222222', name: 'ОсОО "Агро Азия"', inn: '01809201210333', industry: 'Прочее', director: 'Абдыраев Алмаз', email: 'agro@agro-asia.kg', phone: '+996392253344', address: 'г. Каракол, ул. Токтогула 88' },
  { id: 'c3333333-3333-3333-3333-333333333333', name: 'ОсОО "Джалал-Абад НПЗ"', inn: '00207200510444', industry: 'Производство', director: 'Бекмуратов Нурбек', email: 'refinery@ja-npz.kg', phone: '+996372254455', address: 'г. Джалал-Абад, ул. Заводская 5' },
  { id: 'c4444444-4444-4444-4444-444444444444', name: 'ОсОО "Фарма КР"', inn: '02511201910555', industry: 'Услуги / Консалтинг', director: 'Жолдошева Айгуль', email: 'pharma@pharma.kg', phone: '+996312556677', address: 'г. Бишкек, ул. Ахунбаева 98' },
  { id: 'c5555555-5555-5555-5555-555555555555', name: 'ОсОО "Азия Консалт"', inn: '01101202110666', industry: 'Услуги / Консалтинг', director: 'Мамытов Руслан', email: 'consult@asia-consult.kg', phone: '+996312447788', address: 'г. Бишкек, ул. Киевская 107' },
  { id: 'c6666666-6666-6666-6666-666666666666', name: 'ОсОО "Ош Текстиль"', inn: '00805201710777', industry: 'Производство', director: 'Алиев Данияр', email: 'textile@osh-textile.kg', phone: '+996322258899', address: 'г. Ош, ул. Фабричная 14' }
];

const usersToCreate = [
  { email: 'admin@buhuchet.kg', password: 'SuperAdmin2026!', name: 'Kutman', isSuperAdmin: true, companyId: null },
  { email: 'owner@buhuchet.kg', password: 'OwnerPassword123!', name: 'Алмазов Болот (Владелец Кумтор)', isSuperAdmin: false, companyId: '8772ba39-4358-41df-bc06-2b9f62f47f57' },
  { email: 'manager@buhuchet.kg', password: 'ManagerPassword123!', name: 'Касымов Бакыт (Владелец Народный)', isSuperAdmin: false, companyId: 'da3d6acd-83fc-46b8-ab84-0949281a4493' },
  { email: 'batysh@buhuchet.kg', password: 'Batysh2026!', name: 'Исаев Марат (Владелец Батыш)', isSuperAdmin: false, companyId: 'ef59cac0-c937-4505-b3f1-e8f5e6543a63' },
  { email: 'bishkeksoft@buhuchet.kg', password: 'Bishkeksoft2026!', name: 'Осмонов Азамат (Владелец Софт)', isSuperAdmin: false, companyId: 'ed77a717-e476-46fd-9a92-f8a0fe56a7ac' },
  { email: 'chuystroy@buhuchet.kg', password: 'Company2026!', name: 'Садыков Улан (Владелец Чуй Строй)', isSuperAdmin: false, companyId: 'c1111111-1111-1111-1111-111111111111' },
  { email: 'agroasia@buhuchet.kg', password: 'Company2026!', name: 'Абдыраев Алмаз (Владелец Агро Азия)', isSuperAdmin: false, companyId: 'c2222222-2222-2222-2222-222222222222' },
  { email: 'janpz@buhuchet.kg', password: 'Company2026!', name: 'Бекмуратов Нурбек (Владелец НПЗ)', isSuperAdmin: false, companyId: 'c3333333-3333-3333-3333-333333333333' },
  { email: 'pharma@buhuchet.kg', password: 'Company2026!', name: 'Жолдошева Айгуль (Владелец Фарма)', isSuperAdmin: false, companyId: 'c4444444-4444-4444-4444-444444444444' },
  { email: 'asiaconsult@buhuchet.kg', password: 'Company2026!', name: 'Мамытов Руслан (Владелец Консалт)', isSuperAdmin: false, companyId: 'c5555555-5555-5555-5555-555555555555' },
  { email: 'oshtextile@buhuchet.kg', password: 'Company2026!', name: 'Алиев Данияр (Владелец Ош Текстиль)', isSuperAdmin: false, companyId: 'c6666666-6666-6666-6666-666666666666' }
];

async function seedAll() {
  console.log('1. Создаем 10 Организаций в public.companies...');
  for (const c of companiesData) {
    await supabaseAdmin.from('companies').upsert({
      id: c.id,
      name: c.name,
      inn: c.inn,
      industry: c.industry,
      status: 'active',
      is_active: true,
      legal_address: c.address,
      director_name: c.director,
      email: c.email,
      phone: c.phone
    });
  }

  console.log('2. Создаем и подтверждаем пользователей в Supabase GoTrue Auth...');
  for (const u of usersToCreate) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.name }
    });

    if (error) {
      console.log(`Пользователь ${u.email} уже существует, сбрасываем пароль...`);
      // Находим пользователя по email
      const { data: list } = await supabaseAdmin.auth.admin.listUsers();
      const existing = list?.users?.find(usr => usr.email === u.email);
      if (existing) {
        await supabaseAdmin.auth.admin.updateUserById(existing.id, { password: u.password, email_confirm: true });
        await supabaseAdmin.from('users').upsert({
          id: existing.id,
          email: u.email,
          full_name: u.name,
          role: 'owner',
          is_super_admin: u.isSuperAdmin,
          company_id: u.companyId
        });
        console.log(`✅ Пароль обновлен для ${u.email}`);
      }
    } else if (data.user) {
      await supabaseAdmin.from('users').upsert({
        id: data.user.id,
        email: u.email,
        full_name: u.name,
        role: 'owner',
        is_super_admin: u.isSuperAdmin,
        company_id: u.companyId
      });
      console.log(`✅ Пользователь ${u.email} зарегистрирован в GoTrue!`);
    }
  }

  console.log('🎉 Сидирование базы данных и Supabase Auth полностью завершено!');
}

seedAll().catch(console.error);
