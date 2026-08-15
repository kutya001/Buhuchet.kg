import { createClient } from '@supabase/supabase-js';
import { loadEnv, calculateStats } from './utils.mjs';

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Ошибка: переменные окружения Supabase не заданы');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

export async function runActionBenchmarks(iterations = 30, warmup = 3) {
  console.log(`\n⚡ Запуск бенчмарка серверных действий и логики (${warmup} warm-up, ${iterations} замеров)...`);

  const { data: users } = await supabase
    .from('users')
    .select('id, company_id')
    .not('company_id', 'is', null)
    .limit(1);

  const testUser = users?.[0] || { id: '00000000-0000-0000-0000-000000000000', company_id: '00000000-0000-0000-0000-000000000000' };

  const results = {};

  // 1. Server Context Resolution
  {
    const times = [];
    const resolveContext = async (userId) => {
      const { data: prof } = await supabase
        .from('users')
        .select('company_id, role, role_id, is_super_admin')
        .eq('id', userId)
        .maybeSingle();

      let permissions = {};
      if (prof?.role_id) {
        const { data: roleData } = await supabase
          .from('company_roles')
          .select('permissions')
          .eq('id', prof.role_id)
          .maybeSingle();
        permissions = roleData?.permissions || {};
      }

      return {
        userId,
        companyId: prof?.company_id,
        role: prof?.role,
        roleId: prof?.role_id,
        isSuperAdmin: !!prof?.is_super_admin,
        permissions,
      };
    };

    for (let i = 0; i < warmup; i++) {
      await resolveContext(testUser.id);
    }
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await resolveContext(testUser.id);
      times.push(performance.now() - start);
    }
    results['Auth: Server Context Resolve'] = calculateStats(times);
  }

  // 2. Telegram Non-Blocking Dispatch
  {
    const times = [];
    const dummyTask = () =>
      new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

    const nonBlockingDispatch = (task) => {
      Promise.resolve()
        .then(task)
        .catch(() => {});
    };

    for (let i = 0; i < warmup; i++) {
      nonBlockingDispatch(dummyTask);
    }
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      nonBlockingDispatch(dummyTask);
      times.push(performance.now() - start);
    }
    results['Action: Telegram Non-Blocking Dispatch'] = calculateStats(times);
  }

  // 3. Document Mutation Latency
  {
    const times = [];
    for (let i = 0; i < warmup; i++) {
      const testDocNumber = `BENCH_${Date.now()}_${i}`;
      const { data: inserted } = await supabase
        .from('documents')
        .insert({
          company_id: testUser.company_id,
          doc_number: testDocNumber,
          doc_date: '2026-08-15',
          doc_type: 'Акт',
          status: 'draft',
          total_amount: 1000,
        })
        .select('id')
        .single();

      if (inserted?.id) {
        await supabase.from('documents').delete().eq('id', inserted.id);
      }
    }

    for (let i = 0; i < iterations; i++) {
      const testDocNumber = `BENCH_${Date.now()}_${i}`;
      const start = performance.now();
      const { data: inserted } = await supabase
        .from('documents')
        .insert({
          company_id: testUser.company_id,
          doc_number: testDocNumber,
          doc_date: '2026-08-15',
          doc_type: 'Акт',
          status: 'draft',
          total_amount: 1000,
        })
        .select('id')
        .single();
      const elapsed = performance.now() - start;
      times.push(elapsed);

      if (inserted?.id) {
        await supabase.from('documents').delete().eq('id', inserted.id);
      }
    }
    results['Action: Create Document Mutation'] = calculateStats(times);
  }

  // 4. Counterparty Mutation Latency
  {
    const times = [];
    for (let i = 0; i < warmup; i++) {
      const testInn = `1${Date.now().toString().slice(-13)}`;
      const { data: inserted } = await supabase
        .from('counterparties')
        .insert({
          company_id: testUser.company_id,
          name: `Тест Бенчмарк ${i}`,
          inn: testInn,
        })
        .select('id')
        .single();

      if (inserted?.id) {
        await supabase.from('counterparties').delete().eq('id', inserted.id);
      }
    }

    for (let i = 0; i < iterations; i++) {
      const testInn = `1${Date.now().toString().slice(-13)}`;
      const start = performance.now();
      const { data: inserted } = await supabase
        .from('counterparties')
        .insert({
          company_id: testUser.company_id,
          name: `Тест Бенчмарк ${i}`,
          inn: testInn,
        })
        .select('id')
        .single();
      const elapsed = performance.now() - start;
      times.push(elapsed);

      if (inserted?.id) {
        await supabase.from('counterparties').delete().eq('id', inserted.id);
      }
    }
    results['Action: Create Counterparty Mutation'] = calculateStats(times);
  }

  return results;
}

if (process.argv[1]?.endsWith('action-benchmark.mjs')) {
  runActionBenchmarks().then((res) => {
    console.table(res);
  });
}
