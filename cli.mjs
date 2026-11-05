#!/usr/bin/env node
/**
 * The agent's side of the contract. The panel and this CLI write the same three
 * files, so an agent working a queued job drives the browser bar exactly like
 * the built-in runner does.
 *
 *   node cli.mjs list
 *   node cli.mjs next                    # claim the oldest queued job
 *   node cli.mjs claim <id> --by agent
 *   node cli.mjs log <id> stage "…"
 *   node cli.mjs progress <id> render 60
 *   node cli.mjs done <id> <file.mp4>
 *   node cli.mjs fail <id> "دلیل"
 *   node cli.mjs show <id>               # config + handoff
 */
import fs from 'node:fs';
import path from 'node:path';
import * as jobs from './lib/jobs.mjs';
import { probe } from './lib/plan.mjs';
import { handoffDocument } from './lib/agent.mjs';
import { powerBudget } from './lib/cool.mjs';

const [cmd, a, b, c, ...rest] = process.argv.slice(2);
const flag = (name, fb = null) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fb;
};

const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

switch (cmd) {
  case 'list': {
    const rows = jobs.list().map((j) => ({
      id: j.id,
      status: j.status,
      ratio: j.config?.output?.ratio,
      background: j.config?.output?.background,
      engine: j.engine,
      pct: j.progress?.pct ?? 0,
      stage: j.progress?.stage,
      name: j.config?.name,
    }));
    out(rows);
    break;
  }
  case 'next': {
    const j = jobs.claimNextQueued(flag('by', 'agent'));
    if (!j) {
      out('صف خالی است.');
      process.exitCode = 3;
      break;
    }
    out({ id: j.id, handoff: handoffDocument(j) });
    break;
  }
  case 'claim': {
    const j = jobs.claim(a, flag('by', 'agent'));
    if (!j) {
      out(`نمی‌توان ${a} را دستگیری کرد (وضعیت: ${jobs.get(a)?.status || 'نامعلوم'}).`);
      process.exitCode = 2;
      break;
    }
    out(`claimed ${a} by ${j.claimedBy}`);
    break;
  }
  case 'log': {
    jobs.appendLog(a, b || 'info', c || rest.join(' '));
    out('ok');
    break;
  }
  case 'progress': {
    const sub = Math.max(0, Math.min(100, Number(c ?? 0))) / 100;
    out(jobs.setProgress(a, b, { sub }));
    break;
  }
  case 'done': {
    const file = path.resolve(b);
    const info = probe(file);
    const bytes = fs.statSync(file).size;
    const job = jobs.get(a);
    const maxMb = job.config?.output?.maxMb || 200;
    const output = {
      file,
      rel: path.relative(path.join(jobs.paths(a).root, '..'), file),
      bytes,
      mb: Math.round((bytes / 1000000) * 100) / 100,
      width: info.width,
      height: info.height,
      fps: info.fps,
      duration: Math.round(info.duration * 100) / 100,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
      withinBudget: bytes <= maxMb * 1000000,
      is30fps: info.fps === 30,
    };
    jobs.setStatus(a, 'succeeded', { output, finishedAt: new Date().toISOString() });
    jobs.setProgress(a, 'verify', { sub: 1 });
    jobs.appendLog(a, 'done', `تحویل از عامل: ${output.mb} مگابایت، ${output.width}×${output.height}، ${output.fps} فریم`);
    out(output);
    break;
  }
  case 'fail': {
    jobs.setStatus(a, 'failed', { error: b || 'خطای گزارش‌شده توسط عامل', finishedAt: new Date().toISOString() });
    jobs.appendLog(a, 'error', b || 'خطا');
    out('failed');
    break;
  }
  case 'power': {
    out(powerBudget(Number(a ?? 50)));
    break;
  }
  case 'show': {
    const j = jobs.get(a);
    if (!j) {
      out('نیست');
      process.exitCode = 1;
      break;
    }
    out(j);
    break;
  }
  default:
    console.log(
      'usage: cli.mjs list | next | claim <id> | log <id> <level> <text> | progress <id> <stage> <0-100> | done <id> <file> | fail <id> <why> | show <id> | power <pct>',
    );
}
