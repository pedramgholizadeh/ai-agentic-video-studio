#!/usr/bin/env node
/**
 * cli.mjs — the whole interface between a code agent and the studio.
 *
 *   node cli.mjs list                        # every job, one line each
 *   node cli.mjs next [--by <agent>]         # claim the oldest queued job; prints its HANDOFF.md
 *   node cli.mjs claim <id> [--by <agent>]   # claim a specific job
 *   node cli.mjs wait <id> <transcript|preview>  # park the job at a review gate
 *   node cli.mjs log <id> <level> <text>     # append to the browser log (info|warn|error|stage|out|done)
 *   node cli.mjs progress <id> <stage> <0-100>
 *   node cli.mjs show <id>                   # the full job record
 *   node cli.mjs done <id> <file>            # ffprobe + mark succeeded (budget-checked)
 *   node cli.mjs fail <id> <why>
 *   node cli.mjs power <pct>                 # what a render at this % means on this machine
 */
import fs from 'node:fs';
import { powerBudget } from './lib/cool.mjs';
import { probe } from './lib/plan.mjs';
import * as jobs from './lib/jobs.mjs';

const [cmd, id, ...rest] = process.argv.slice(2);
const by = (() => {
  const i = process.argv.indexOf('--by');
  return i >= 0 ? process.argv[i + 1] : 'agent';
})();

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (cmd === 'list') {
  const rows = jobs.list().map((j) => ({
    id: j.id,
    status: j.status,
    stage: j.progress?.stage,
    pct: j.progress?.pct,
    name: j.config?.name,
    updatedAt: j.updatedAt,
  }));
  console.log(JSON.stringify(rows, null, 2));
} else if (cmd === 'next' || cmd === 'claim') {
  const job = cmd === 'next' ? jobs.claimNextQueued(by) : jobs.claim(id, by);
  if (!job) die(cmd === 'next' ? 'صف خالی است.' : `جاب ${id} در صف نیست (status=${jobs.get(id)?.status})`);
  const p = jobs.paths(job.id);
  jobs.appendLog(job.id, 'stage', `برداشته شد توسط ${by}`);
  console.log(fs.existsSync(p.handoff) ? fs.readFileSync(p.handoff, 'utf8') : `جاب ${job.id} بدون HANDOFF.md — سرور را برای ساختش دوباره اجرا کن.`);
} else if (cmd === 'wait') {
  // park the job at a review gate: the panel shows the edit surface and the
  // job stays exactly here until the user (or the panel) approves
  const gate = rest[0];
  if (!['transcript', 'preview'].includes(gate)) die('gate باید transcript یا preview باشد.');
  const job = jobs.get(id);
  if (!job) die(`جاب ${id} پیدا نشد`);
  jobs.openGate(id, gate, gate === 'transcript' ? 'ترنسکریپت آمادهٔ بازبینی است' : 'دمو آماده است — منتظر ادیت یا تایید');
  console.log(`جاب ${id} روی دروازهٔ ${gate} پارک شد. با show ${id} منتظر خروج از review بمان.`);
} else if (cmd === 'log') {
  const [level, ...text] = rest;
  if (!['info', 'warn', 'error', 'stage', 'out', 'done', 'queue', 'created'].includes(level)) die('level باید info|warn|error|stage|out|done باشد.');
  jobs.appendLog(id, level, text.join(' ') || '(خالی)');
  console.log('ok');
} else if (cmd === 'progress') {
  const [stage, pct] = rest;
  jobs.setProgress(id, stage, { sub: Math.max(0, Math.min(1, Number(pct) / 100)) });
  console.log('ok');
} else if (cmd === 'show') {
  const job = jobs.get(id);
  if (!job) die(`جاب ${id} پیدا نشد`);
  console.log(JSON.stringify(job, null, 2));
} else if (cmd === 'done') {
  const file = rest[0];
  if (!file || !fs.existsSync(file)) die(`فایل تحویلی پیدا نشد: ${file}`);
  const job = jobs.get(id);
  if (!job) die(`جاب ${id} پیدا نشد`);
  const info = probe(file);
  const bytes = fs.statSync(file).size;
  const maxMb = job.config?.output?.maxMb || 200;
  const output = {
    file,
    rel: file,
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
  jobs.setStatus(id, 'succeeded', { output, gate: null, finishedAt: new Date().toISOString() });
  jobs.appendLog(id, 'done', `تحویل شد: ${output.mb} مگابایت، ${output.width}×${output.height}، ${output.fps} فریم — ${output.withinBudget ? 'زیر سقف' : 'بیش از سقف!'}`);
  console.log(JSON.stringify(output, null, 2));
} else if (cmd === 'fail') {
  const why = rest.join(' ') || '(بدون توضیح)';
  jobs.setStatus(id, 'failed', { error: why.slice(0, 2000), finishedAt: new Date().toISOString() });
  jobs.appendLog(id, 'error', why.slice(0, 500));
  console.log('ok');
} else if (cmd === 'power') {
  const pct = Number(id);
  if (!pct) die('usage: node cli.mjs power <5-100>');
  console.log(JSON.stringify(powerBudget(pct), null, 2));
} else {
  console.log('usage: node cli.mjs list|next|claim|wait|log|progress|show|done|fail|power …');
  process.exit(cmd ? 2 : 0);
}
