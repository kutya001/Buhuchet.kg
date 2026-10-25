import { startMinuteRunner } from '@buhuchet/adapters/scheduler';
import { runDueJobs } from '@buhuchet/api';
import { createRuntime } from '@buhuchet/api/runtime';

const runtime = createRuntime('worker');
const { deps } = runtime;

const runner = startMinuteRunner({
  async tick() {
    const result = await runDueJobs(deps, deps.jobs);
    if (result.ran.length > 0) deps.logger.info(result, 'задачи по расписанию');
  },
  onError: (err) => deps.logger.error({ err }, 'ошибка цикла worker'),
});
deps.logger.info({ jobs: deps.jobs.map((j) => j.name) }, 'worker запущен');

async function shutdown(signal: string) {
  deps.logger.info({ signal }, 'worker останавливается');
  await runner.stop();
  await runtime.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
