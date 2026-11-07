import os from 'node:os';
import { execSync } from 'node:child_process';
import { COOL_RUN } from './paths.mjs';

function physicalCores() {
  try {
    return Number(execSync('sysctl -n hw.physicalcpu', { encoding: 'utf8' }).trim()) || os.cpus().length;
  } catch {
    return os.cpus().length;
  }
}

const CORES = physicalCores();
const TOTAL_RAM_GB = Math.round(os.totalmem() / 1024 / 1024 / 1024);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Turn a percentage of the machine into concrete render limits.
 *
 * `cool-render` fixes the house rule at 50% of the CPU, one heavy job at a
 * time, 30 fps and a 200 MB ceiling; the panel exposes the percentage, so the
 * arithmetic lives here and stays inside the same envelope. Above 50% the
 * wrapper still runs at background QoS, which is what keeps the chassis cool —
 * it only means more efficiency cores are busy.
 */
export function powerBudget(pct = 50) {
  const p = clamp(Number(pct) || 50, 5, 100);
  const units = (CORES * p) / 100;
  const threads = clamp(Math.round(units), 1, CORES);
  // Each HyperFrames worker is a full Chrome process (~256 MB), so workers are
  // capped by both the core share and the RAM of this box.
  const ramCap = TOTAL_RAM_GB <= 8 ? 1 : TOTAL_RAM_GB <= 16 ? 2 : 4;
  const workers = clamp(Math.round(units / 2), 1, ramCap);
  return {
    pct: p,
    cores: CORES,
    threads,
    workers,
    ramGb: TOTAL_RAM_GB,
    houseRule: p <= 50,
  };
}

/** Wrap a command the way cool-run does, with our own thread count. */
export function withPower(cmd, args, power) {
  const env = {
    OMP_NUM_THREADS: String(power.threads),
    MKL_NUM_THREADS: String(power.threads),
    OPENBLAS_NUM_THREADS: String(power.threads),
    NUMEXPR_NUM_THREADS: String(power.threads),
  };
  if (power.pct <= 50 && COOL_RUN) {
    // Exactly the skill's wrapper, so the documented rule is what runs.
    return { cmd: COOL_RUN, args: [cmd, ...args], env };
  }
  return { cmd: 'taskpolicy', args: ['-c', 'background', 'nice', '-n', '15', cmd, ...args], env };
}

/** kbit/s that fits a duration inside the file-size budget (minus 128k AAC). */
export function videoBitrateKbps(durationSeconds, maxMb = 200) {
  const d = Math.max(1, Number(durationSeconds) || 1);
  const v = Math.round(maxMb * 8 * 1000 / d) - 130;
  return clamp(v, 400, 14000);
}

export function freeDiskGb(dir = os.homedir()) {
  try {
    const out = execSync(`df -g ${JSON.stringify(dir)}`, { encoding: 'utf8' }).trim().split('\n');
    const cols = out[out.length - 1].split(/\s+/);
    return Number(cols[3]) || 0;
  } catch {
    return 0;
  }
}

export function availableRamGb() {
  const free = os.freemem();
  return Math.round((free / 1024 / 1024 / 1024) * 10) / 10;
}

export function loadAverage() {
  return os.loadavg().map((n) => Math.round(n * 100) / 100);
}

/** Everything a render needs to be honest about before it starts. */
export function preflight(power, { maxMb = 200 } = {}) {
  const free = freeDiskGb(os.tmpdir());
  const ram = availableRamGb();
  const warnings = [];
  if (power.pct > 50)
    warnings.push(`درصد انتخابی (${power.pct}%) از قانون خانه (۵۰٪) بالاتر است؛ بدنهٔ دستگاه گرم‌تر می‌شود.`);
  if (free < 6)
    warnings.push(`فقط ${free.toFixed(1)} گیگ فضای دیسک آزاد است؛ رندر و کش فریم‌ها به فضای بیشتری نیاز دارند.`);
  if (ram < 1.5) warnings.push(`حافظهٔ آزاد ${ram} گیگ است؛ برنامه‌های سنگین را ببندید.`);
  if (TOTAL_RAM_GB <= 8) warnings.push('هایپر‌فریم روی ۸ گیگ رم، رندر را در حالت کم‌حافظه (یک ورکر) اجرا می‌کند.');
  return {
    cores: power.cores,
    threads: power.threads,
    workers: power.workers,
    pct: power.pct,
    ramGb: TOTAL_RAM_GB,
    ramAvailableGb: ram,
    diskFreeGb: free,
    load: loadAverage(),
    coolRun: COOL_RUN,
    budgetMb: maxMb,
    warnings,
  };
}
