import fs from 'fs';
import path from 'path';

export function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
      } else {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const idx = trimmed.indexOf('=');
            if (idx > 0) {
              const key = trimmed.slice(0, idx).trim();
              const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
              if (!process.env[key]) {
                process.env[key] = val;
              }
            }
          }
        });
      }
    } catch (e) {
      console.warn('Could not load .env.local via process.loadEnvFile:', e.message);
    }
  }
}

export function calculateStats(durations) {
  if (!durations || durations.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, count: 0 };
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sum / count;

  const getPercentile = (p) => {
    const idx = Math.ceil((p / 100) * count) - 1;
    return sorted[Math.max(0, Math.min(idx, count - 1))];
  };

  return {
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[count - 1].toFixed(2)),
    avg: Number(avg.toFixed(2)),
    p50: Number(getPercentile(50).toFixed(2)),
    p95: Number(getPercentile(95).toFixed(2)),
    p99: Number(getPercentile(99).toFixed(2)),
    count,
  };
}
