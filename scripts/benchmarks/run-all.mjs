import fs from 'fs';
import path from 'path';
import { runDbBenchmarks } from './db-benchmark.mjs';
import { runActionBenchmarks } from './action-benchmark.mjs';

const SLA_NET_OVERHEAD_TARGET_MS = {
  'DB: Documents Filter & RLS': 25,
  'DB: Closed Period Check': 20,
  'DB: Counterparties Search': 20,
  'DB: Employee & Roles RBAC': 25,
  'DB: Join Requests Lookup': 20,
  'Auth: Server Context Resolve': 40,
  'Action: Telegram Non-Blocking Dispatch': 10,
  'Action: Create Document Mutation': 250,
  'Action: Create Counterparty Mutation': 250,
};

async function main() {
  console.log('='.repeat(85));
  console.log('🏁 BUHUCHET.KG AUTOMATED PERFORMANCE BENCHMARK SUITE');
  console.log('='.repeat(85));

  const startTime = Date.now();

  const dbResults = await runDbBenchmarks(30, 3);
  const actionResults = await runActionBenchmarks(20, 2);

  const combinedResults = { ...dbResults, ...actionResults };

  const basePingStats = combinedResults['Network: Base WAN Ping (RTT)'] || { avg: 350, p95: 370 };
  const basePingAvg = basePingStats.avg;
  const basePingP95 = basePingStats.p95;

  console.log('\n' + '='.repeat(85));
  console.log('📊 BENCHMARK RESULTS & TARGET SLA COMPLIANCE');
  console.log(`🌐 Base Network RTT (WAN Ping to Supabase Cloud): Avg ${basePingAvg} ms | P95 ${basePingP95} ms`);
  console.log('='.repeat(85));

  const tableData = [];
  let allPass = true;

  for (const [metric, stats] of Object.entries(combinedResults)) {
    if (metric.startsWith('Network:')) {
      tableData.push({
        'Metric / Scenario': metric,
        'Raw Avg (ms)': stats.avg,
        'Raw P95 (ms)': stats.p95,
        'Net Processing (ms)': '—',
        'Target Overhead': 'Baseline RTT',
        'Status': 'ℹ️ INFO',
      });
      continue;
    }

    const netProcessingP95 = metric.includes('Telegram')
      ? stats.p95
      : Number(Math.max(0.1, stats.p95 - basePingP95).toFixed(2));

    const targetOverhead = SLA_NET_OVERHEAD_TARGET_MS[metric] || 50;
    const passed = netProcessingP95 <= targetOverhead;
    if (!passed) allPass = false;

    tableData.push({
      'Metric / Scenario': metric,
      'Raw Avg (ms)': stats.avg,
      'Raw P95 (ms)': stats.p95,
      'Net Processing (ms)': `${netProcessingP95} ms`,
      'Target Overhead': `≤ ${targetOverhead} ms`,
      'Status': passed ? '✅ PASS' : '⚠️ WARN',
    });
  }

  console.table(tableData);

  const outputDir = path.resolve(process.cwd(), '.benchmarks');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const report = {
    timestamp: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
    basePing: basePingStats,
    allPass,
    metrics: combinedResults,
  };

  const reportPath = path.join(outputDir, 'latest.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n💾 Полный отчет сохранен в: ${reportPath}`);
  console.log('='.repeat(85));
  if (allPass) {
    console.log('🎉 OVERALL STATUS: ALL PERFORMANCE & SLA TARGETS MET (PASS)');
  } else {
    console.log('⚠️ OVERALL STATUS: REVIEW REQUIRED');
  }
  console.log('='.repeat(85) + '\n');
}

main().catch((err) => {
  console.error('❌ Benchmark error:', err);
  process.exit(1);
});
