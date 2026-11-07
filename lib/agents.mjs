import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { STUDIO_ROOT, jobDir } from './paths.mjs';

/*
 * agents.mjs — stage zero.
 *
 * The user decides *who* edits: a code agent CLI (spawned headless on the job)
 * or an API brain (the panel's own pipeline calls it for the understanding
 * stages). This module knows the CLI list, which ones are installed, how to
 * wake each one, and how to spawn it detached with its output going to the job.
 */

export const AGENT_CLIS = [
  {
    id: 'zcode',
    label: 'ZCode',
    bin: 'zcode',
    install: 'https://zcode.dev — اپ دسکتاپ یا CLI',
    /** Headless invocation: one non-interactive run that executes the handoff. */
    args: (prompt) => ['exec', prompt],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    install: 'npm install -g @anthropic-ai/claude-code',
    args: (prompt) => ['-p', prompt, '--dangerously-skip-permissions'],
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    install: 'npm install -g @openai/codex',
    args: (prompt) => ['exec', '--sandbox', 'workspace-write', '--ask-for-approval', 'never', prompt],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    bin: 'opencode',
    install: 'npm install -g opencode-ai  ·  brew install sst/tap/opencode',
    args: (prompt) => ['run', prompt],
  },
];

/** The API-brain choices the panel offers beside the CLIs. */
export const AGENT_PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', kind: 'api' },
  { id: 'zai', label: 'Z.ai (GLM)', kind: 'api' },
  { id: 'paasta', label: 'Paasta.cloud', kind: 'api' },
];

export function installed(bin) {
  try {
    execFileSync('which', [bin], { encoding: 'utf8' }).trim();
    return true;
  } catch {
    return false;
  }
}

export function agentManifest() {
  const clis = AGENT_CLIS.map((a) => ({
    id: a.id,
    label: a.label,
    kind: 'cli',
    bin: a.bin,
    installed: installed(a.bin),
    install: a.install,
  }));
  return { clis, providers: AGENT_PROVIDERS };
}

export function wakeCommand(id, agentId) {
  return `cd ${STUDIO_ROOT} && node cli.mjs claim ${id} --by ${agentId || 'agent'}`;
}

function buildPrompt(job) {
  const p = jobDir(job.id);
  return [
    `You are the edit agent of the local video studio. Execute job ${job.id} end to end.`,
    `Read ${path.join(p, 'HANDOFF.md')} and follow it exactly, stage by stage.`,
    `Studio root: ${STUDIO_ROOT} (run every command from there).`,
    `First claim the job: node cli.mjs claim ${job.id} --by ${job.engine?.agent || 'agent'}`,
    `Keep the browser alive as you go: node cli.mjs log / progress. Deliver with: node cli.mjs done ${job.id} <file>.`,
    `Before re-rendering after the preview gate, read ${path.join(p, 'chat.jsonl')} for the user's edits.`,
  ].join('\n');
}

/** Spawn the chosen CLI detached on the job; its output goes to agent-out.txt. */
export function spawnAgent(job, agentId) {
  const entry = AGENT_CLIS.find((a) => a.id === agentId);
  if (!entry) throw new Error(`ایجنت شناخته نشد: ${agentId}`);
  if (!installed(entry.bin)) throw new Error(`${entry.label} روی این ماشین نصب نیست.`);
  const out = fs.openSync(path.join(jobDir(job.id), 'agent-out.txt'), 'a');
  const child = spawn(entry.bin, entry.args(buildPrompt(job)), {
    cwd: STUDIO_ROOT,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  return { pid: child.pid, bin: entry.bin };
}
