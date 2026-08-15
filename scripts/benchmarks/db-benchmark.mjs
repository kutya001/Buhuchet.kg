import { createClient } from '@supabase/supabase-js';
import { loadEnv, calculateStats } from './utils.mjs';

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Ошибка: NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не заданы в .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export async function runDbBenchmarks(iterations = 30, warmup = 3) {
  console.log(`\n🔍 Запуск бенчмарка базы данных (${warmup} warm-up, ${iterations} замеров)...`);

  // Получаем существующую компанию для тестов
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')
    .limit(1);

  const testCompanyId = companies?.[0]?.id || '00000000-0000-0000-0000-000000000000';

  const results = {};

  // 0. Base Network Ping (Baseline Roundtrip)
  {
    const times = [];
    for (let i = 0; i < warmup; i++) {
      await supabase.from('feature_flags').select('key').limit(1);
    }
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await supabase.from('feature_flags').select('key').limit(1);
      times.push(performance.now() - start);
    }
    results['Network: Base WAN Ping (RTT)'] = calculateStats(times);
  }

  // 1. Documents Filter & Lookup
  {
    const times = [];
    for (let i = 0; i < warmup; i++) {
      await supabase
        .from('documents')
        .select('id, doc_number, doc_date, doc_type, status, total_amount, created_at')
        .or(`company_id.eq.${testCompanyId},sender_company_id.eq.${testCompanyId},receiver_company_id.eq.${testCompanyId}`)
        .order('created_at', { ascending: false })
        .limit(25);
    }
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await supabase
        .from('documents')
        .select('id, doc_number, doc_date, doc_type, status, total_amount, created_at')
        .or(`company_id.eq.${testCompanyId},sender_company_id.eq.${testCompanyId},receiver_company_id.eq.${testCompanyId}`)
        .order('created_at', { ascending: false })
        .limit(25);
      times.push(performance.now() - start);
    }
    results['DB: Documents Filter & RLS'] = calculateStats(times);
  }

  // 2. Closed Period Check
  {
    const times = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    for (let i = 0; i < warmup; i++) {
      await supabase
        .from('company_closed_periods')
        .select('id, status')
        .eq('company_id', testCompanyId)
        .eq('year', currentYear)
        .eq('month', currentMonth)
        .maybeSingle();
    }
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await supabase
        .from('company_closed_periods')
        .select('id, status')
        .eq('company_id', testCompanyId)
        .eq('year', currentYear)
        .eq('month', currentMonth)
        .maybeSingle();
      times.push(performance.now() - start);
    }
    results['DB: Closed Period Check'] = calculateStats(times);
  }

  // 3. Counterparties Search & Sort
  {
    const times = [];
    for (let i = 0; i < warmup; i++) {
      await supabase
        .from('counterparties')
        .select('id, name, inn, is_vat_payer, phone, target_company_id')
        .eq('company_id', testCompanyId)
        .order('name', { ascending: true })
        .limit(25);
    }
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await supabase
        .from('counterparties')
        .select('id, name, inn, is_vat_payer, phone, target_company_id')
        .eq('company_id', testCompanyId)
        .order('name', { ascending: true })
        .limit(25);
      times.push(performance.now() - start);
    }
    results['DB: Counterparties Search'] = calculateStats(times);
  }

  // 4. Users & Roles RBAC Lookup
  {
    const times = [];
    for (let i = 0; i < warmup; i++) {
      await supabase
        .from('users')
        .select('id, full_name, email, role, role_id, is_active, company_roles(*)')
        .eq('company_id', testCompanyId);
    }
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await supabase
        .from('users')
        .select('id, full_name, email, role, role_id, is_active, company_roles(*)')
        .eq('company_id', testCompanyId);
      times.push(performance.now() - start);
    }
    results['DB: Employee & Roles RBAC'] = calculateStats(times);
  }

  // 5. Join Requests Lookup
  {
    const times = [];
    for (let i = 0; i < warmup; i++) {
      await supabase
        .from('company_join_requests')
        .select('id, status, position_note, user_id, created_at')
        .eq('company_id', testCompanyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
    }
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await supabase
        .from('company_join_requests')
        .select('id, status, position_note, user_id, created_at')
        .eq('company_id', testCompanyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      times.push(performance.now() - start);
    }
    results['DB: Join Requests Lookup'] = calculateStats(times);
  }

  return results;
}

if (process.argv[1]?.endsWith('db-benchmark.mjs')) {
  runDbBenchmarks().then((res) => {
    console.table(res);
  });
}
