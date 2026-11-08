/* app.js — the panel. Vanilla JS, no framework, no build step.
 *
 * Five views: the stage-zero wizard (who edits + the two files + the output),
 * the live job view with its two review gates (transcript table, preview +
 * chat), the job list, the reference memory, and settings (the CPU dial lives
 * here). State is one mutable object; rendering is imperative DOM writes.
 */
(() => {
  'use strict';

  const S = {
    view: 'new-job',
    manifest: null,
    cfg: null,
    agents: null,
    whisper: null,
    step: 1,
    agent: { kind: 'cli', id: 'opencode' },
    provider: 'openrouter',
    src: { video: null, reference: null, logo: '' },
    probes: {},
    ratio: '16:9',
    sound: { sfx: true, level: 'balanced' },
    jobId: localStorage['studio.lastJob'] || null,
    es: null,
    trCues: [],
    trDirty: false,
    lastGate: null,
  };

  /* ------------------------------------------------ helpers */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (v) => String(v).replace(/[0-9]/g, (d) => FA[+d]);
  const mb = (bytes) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`);
  const hhmmss = (t) => {
    const s = Math.max(0, Math.round(t || 0));
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  /** Assign a media source only when it actually changed — the SSE tick would
   * otherwise reload the player every 700 ms and wreck seeking. */
  function setSrc(el, src) {
    if (!el || el.dataset.src === src) return;
    el.dataset.src = src;
    el.src = src;
  }
  /** Copy text to the clipboard with visible feedback. */
  async function copyText(text, okMsg = 'کپی شد ✓') {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch {
      // clipboard needs a focused document; fall back to a selection
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast(okMsg);
    }
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(ENGINE.url(path), {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...ENGINE.headers(method) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `خطای ${res.status}`);
    return data;
  }

  function toast(text, kind = 'ok') {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind === 'bad' ? 'bad' : ''}`;
    el.textContent = text;
    box.append(el);
    setTimeout(() => el.classList.add('out'), 3600);
    setTimeout(() => el.remove(), 4200);
    el.onclick = () => el.remove();
    while (box.children.length > 3) box.firstChild.remove();
  }

  /* ------------------------------------------------ view switching */

  function show(view) {
    S.view = view;
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === `${view}-view`));
    $$('.nav-link').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    if (view === 'jobs') loadJobs();
    if (view === 'references') loadReferences();
    if (view === 'settings') {
      loadSettings();
      paintAbout();
    }
    if (view === 'new-job') paintStartSummary();
  }

  /* ------------------------------------------------ header */

  async function refreshMachine() {
    try {
      const m = await api('/api/machine');
      $('#machine').innerHTML = `
        <span class="stat"><b>${fa(m.cores)}</b> هسته<i></i></span>
        <span class="stat ${m.ramAvailableGb < 1.5 ? 'warn' : ''}"><b>رم آزاد ${fa(m.ramAvailableGb)}G</b><i></i></span>
        <span class="stat ${m.diskFreeGb < 6 ? 'bad' : ''}"><b>دیسک ${fa(m.diskFreeGb)}G</b><i></i></span>`;
    } catch {
      /* the engine-off banner handles this */
    }
  }

  /* ------------------------------------------------ wizard */

  function goStep(n) {
    S.step = Math.max(1, Math.min(4, n));
    $$('#wizardSteps li').forEach((li) => {
      const k = Number(li.dataset.step);
      li.classList.toggle('active', k === S.step);
      li.classList.toggle('done', k < S.step);
    });
    $$('.wstep').forEach((w) => w.classList.toggle('on', Number(w.dataset.wstep) === S.step));
    $('#backBtn').disabled = S.step === 1;
    $('#nextBtn').textContent = S.step === 4 ? 'شروع جاب' : 'بعدی';
    $('#nextBtn').classList.toggle('primary', true);
    $('#stepHint').textContent = `گام ${fa(S.step)} از ۴ — ${['ایجنت', 'ورودی‌ها', 'خروجی', 'شروع'][S.step - 1]}`;
    if (S.step === 4) paintStartSummary();
  }

  function paintAgents() {
    const box = $('#agentCards');
    const { clis, providers } = S.agents;
    const card = (id, label, bin, installed, install, kind) => `
      <button class="card agent-card ${S.agent?.kind === kind && S.agent?.id === id ? 'on' : ''}" data-kind="${kind}" data-id="${esc(id)}">
        <div class="card-head"><b>${esc(label)}</b>
          <span class="agent-badge ${installed ? 'ok' : 'no'}">${installed ? 'نصب است' : 'نصب نیست'}</span></div>
        <div class="agent-bin">${esc(bin)}</div>
        ${!installed && install ? `<p class="hint">${esc(install)}</p>` : ''}
      </button>`;
    box.innerHTML =
      clis.map((a) => card(a.id, a.label, a.bin, a.installed, a.install, 'cli')).join('') +
      card('studio', 'خودِ استودیو (بدون مدل)', 'deterministic — قوانین خانه', true, '', 'cli') +
      `<button class="card agent-card ${S.agent?.kind === 'api' ? 'on' : ''}" data-kind="api" data-id="api">
        <div class="card-head"><b>مغز API</b><span class="agent-badge ${Object.values(S.cfg.providers || {}).some((p) => p.hasKey) ? 'ok' : 'no'}">${Object.values(S.cfg.providers || {}).some((p) => p.hasKey) ? 'کلید هست' : 'کلید لازم'}</span></div>
        <div class="agent-bin">openrouter · z.ai · paasta.cloud</div>
        <p class="hint">مراحل هوشمند (درک متن، سناریو) با مدل انتخابی اجرا می‌شود؛ رندر همیشه محلی است.</p>
      </button>`;

    $$('#agentCards .agent-card').forEach((c) =>
      c.addEventListener('click', () => {
        const kind = c.dataset.kind;
        if (kind === 'api') S.agent = { kind: 'api', id: S.provider };
        else S.agent = { kind: 'cli', id: c.dataset.id === 'studio' ? 'studio' : c.dataset.id };
        paintAgents();
        paintProviderBlock();
      }),
    );
    $('#agentNote').textContent =
      S.agent.kind === 'api'
        ? 'پنل خودش پایپ‌لاین را اجرا می‌کند و فقط مراحل هوشمند را از مدل می‌پرسد.'
        : S.agent.id === 'studio'
          ? 'بدون هیچ مدلی — همه‌چیز با قوانین قطعی خانه؛ برای تست و کارهای ساده.'
          : S.agents.clis.find((a) => a.id === S.agent.id)?.installed
            ? 'روی شروع، پنل همین ایجنت را headless روی جاب اجرا می‌کند (HANDOFF.md را می‌خواند و تا خروجی می‌رود).'
            : 'نصب نیست — پنل دستور wake را می‌دهد تا خودت در ترمینال اجرایش کنی.';
    paintProviderBlock();
  }

  function paintProviderBlock() {
    const on = S.agent.kind === 'api';
    $('#providerBlock').hidden = !on;
    if (!on) return;
    const presets = S.cfg.presets || [];
    $('#providerCards').innerHTML =
      presets
        .map(
          (p) => `
        <button class="card mini ${S.provider === p.id ? 'on' : ''}" data-p="${esc(p.id)}">
          <b>${esc(p.fa)}</b><span class="hint">${esc(p.note)}</span>
        </button>`,
        )
        .join('') || '';
    $$('#providerCards .card').forEach((c) =>
      c.addEventListener('click', () => {
        S.provider = c.dataset.p;
        paintAgents();
      }),
    );
    const p = presets.find((x) => x.id === S.provider);
    $('#providerBaseRow').hidden = !(p && (!p.base || S.provider === 'paasta'));
    const stored = (S.cfg.providers || {})[S.provider] || {};
    $('#providerModel').value = stored.model || '';
    $('#providerBase').value = stored.base || (p?.base || '');
    $('#providerKey').placeholder = stored.hasKey ? 'کلید ذخیره شده ✓ (برای عوض کردن بنویس)' : 'sk-…';
  }

  async function saveProvider() {
    if (S.agent.kind !== 'api') return;
    const patch = { providers: { [S.provider]: { model: $('#providerModel').value.trim() } }, engine: { mode: 'provider', provider: S.provider, model: $('#providerModel').value.trim() || null } };
    const base = $('#providerBase').value.trim();
    if ($('#providerBaseRow') && !$('#providerBaseRow').hidden) patch.providers[S.provider].base = base;
    if ($('#providerKey').value.trim()) patch.providers[S.provider].apiKey = $('#providerKey').value.trim();
    S.cfg = await api('/api/config', { method: 'POST', body: patch });
    $('#providerKey').value = '';
  }

  function paintRatios() {
    const rs = (S.manifest?.ratios || []).filter((r) => r.id === '16:9' || r.id === '9:16');
    $('#ratioCards').innerHTML = rs
      .map(
        (r) => `
      <button class="card ratio ${S.ratio === r.id ? 'on' : ''}" data-r="${r.id}">
        <div class="frame"><span style="aspect-ratio:${r.w}/${r.h}"></span></div>
        <b>${r.id === '16:9' ? 'افقی ۱۶:۹' : 'عمودی ۹:۱۶'}</b>
        <small>${fa(r.w)}×${fa(r.h)} — ${r.id === '16:9' ? 'یوتیوب / پخش' : 'ریلز / شورتس'}</small>
      </button>`,
      )
      .join('');
    $$('#ratioCards .card').forEach((c) =>
      c.addEventListener('click', () => {
        S.ratio = c.dataset.r;
        $('#ratioNote').hidden = true;
        paintRatios();
      }),
    );
    $('#ratioNote').hidden = true; // teaser note stays available from the chat edits
  }

  function paintSound() {
    const levels = [
      { id: 'off', fa: 'بدون افکت' },
      { id: 'gentle', fa: 'ملایم' },
      { id: 'balanced', fa: 'متعادل' },
      { id: 'bold', fa: 'پرقدرت' },
    ];
    const on = S.sound.sfx ? S.sound.level : 'off';
    $('#soundLevelChips').innerHTML = levels
      .map((l) => `<button class="chip ${on === l.id ? 'on' : ''}" data-l="${l.id}">${l.fa}</button>`)
      .join('');
    $$('#soundLevelChips .chip').forEach((c) =>
      c.addEventListener('click', () => {
        const id = c.dataset.l;
        if (id === 'off') S.sound = { sfx: false, level: 'balanced' };
        else S.sound = { sfx: true, level: id };
        paintSound();
      }),
    );
  }

  async function paintWhisperSelect() {
    try {
      const d = S.models || (await api('/api/models'));
      S.models = d;
      const stt = d.catalog.filter((m) => m.category === 'stt' && !m.enOnly);
      $('#whisperModel').innerHTML = stt
        .map((m) => `<option value="${m.id}" ${d.defaultStt === m.id ? 'selected' : ''}>${m.id}${m.present ? '' : ' — دانلود نشده (تنظیمات)'}</option>`)
        .join('');
    } catch {
      $('#whisperModel').innerHTML = '<option>large-v3</option>';
    }
  }

  function probeInfo(kind) {
    const p = S.probes[kind];
    if (!p) return '';
    return `${fa(hhmmss(p.duration))} · ${fa(p.width)}×${fa(p.height)} · ${fa(p.fps)}fps · ${mb(p.size)}`;
  }

  function paintSources() {
    $('#srcVideoName').textContent = S.src.video ? S.src.video.split('/').pop() : 'هیچ';
    $('#srcRefName').textContent = S.src.reference ? S.src.reference.split('/').pop() : 'هیچ';
    $('#srcVideoProbe').textContent = probeInfo('video');
    $('#srcRefProbe').textContent = probeInfo('reference');
  }

  async function setSource(kind, filePath, { uploaded = false } = {}) {
    S.src[kind] = filePath;
    paintSources();
    try {
      S.probes[kind] = await api(`/api/probe?path=${encodeURIComponent(filePath)}`);
    } catch (err) {
      toast(`سنجش فایل نشد: ${err.message}`, 'bad');
    }
    paintSources();
    if (kind === 'reference') await suggestReferences(filePath);
  }

  async function suggestReferences(filePath) {
    const box = $('#refSuggest');
    box.innerHTML = '<p class="hint">…</p>';
    try {
      const { exact, library } = await api('/api/references/suggest', { method: 'POST', body: { path: filePath } });
      const rows = [];
      if (exact)
        rows.push(
          `<span class="chip on">این رفرنس از قبل تحلیل شده ✓ — پروفایل موجود بی‌درنگ به‌کار می‌رود</span>`,
        );
      if (library.length)
        rows.push(
          `<div class="suggest-row">${library
            .slice(0, 6)
            .map((r) => `<span class="chip" title="${esc(r.path || '')}">📁 ${esc(r.name)} · ${esc(r.summary?.look || '?')}</span>`)
            .join('')}</div>`,
        );
      box.innerHTML = rows.join('') || '';
    } catch {
      box.innerHTML = '';
    }
  }

  async function uploadFile(file, kind) {
    toast('آپلود شروع شد…');
    const res = await fetch(ENGINE.url(`/api/upload?name=${encodeURIComponent(file.name)}`), {
      method: 'POST',
      headers: ENGINE.headers('POST'),
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'آپلود نشد');
    await setSource(kind, data.path, { uploaded: true });
    toast('آپلود شد ✓');
  }

  /* ------- file browser modal */

  let browseTarget = 'video';
  async function openBrowser(kind) {
    browseTarget = kind;
    $('#browser').hidden = false;
    await browseDir(S.browseDir || osHome());
  }
  const osHome = () => '/Users/pedram';
  async function browseDir(dir) {
    try {
      const data = await api(`/api/fs?dir=${encodeURIComponent(dir)}`);
      S.browseDir = data.dir;
      $('#browserDir').textContent = data.dir;
      $('#browserShortcuts').innerHTML = (data.shortcuts || [])
        .map((d) => `<button class="ghost tiny" data-d="${esc(d)}">${esc(d.split('/').pop() || d)}</button>`)
        .join('');
      $$('#browserShortcuts button').forEach((b) => b.addEventListener('click', () => browseDir(b.dataset.d)));
      $('#browserList').innerHTML =
        data.dir.split('/').filter(Boolean).length > 1
          ? `<button class="b-row" data-up="1"><b>↑ …</b></button>` +
            data.entries
              .map(
                (e) => `
          <button class="b-row ${e.dir ? 'is-dir' : 'is-file'}" data-n="${esc(e.name)}" data-dir="${e.dir ? 1 : 0}">
            <span>${e.dir ? '📁' : '🎬'}</span><span>${esc(e.name)}</span><small>${e.size ? mb(e.size) : ''}</small>
          </button>`,
              )
              .join('')
          : '';
      $$('#browserList .b-row').forEach((b) =>
        b.addEventListener('click', async () => {
          if (b.dataset.up) return browseDir(data.up);
          const full = `${data.dir}/${b.dataset.n}`;
          if (b.dataset.dir === '1') return browseDir(full);
          $('#browser').hidden = true;
          await setSource(browseTarget, full);
        }),
      );
    } catch (err) {
      toast(`مرور پوشه نشد: ${err.message}`, 'bad');
    }
  }

  /* ------- start */

  function paintStartSummary() {
    const box = $('#startSummary');
    if (!box) return;
    const who =
      S.agent.kind === 'api'
        ? `مغز API (${S.provider})`
        : S.agent.id === 'studio'
          ? 'خودِ استودیو (بدون مدل)'
          : `ایجنت ${(S.agents?.clis || []).find((a) => a.id === S.agent.id)?.label || S.agent.id}`;
    box.innerHTML = `
      <div class="kv">
        <div class="row"><b>ایجنت</b><span>${esc(who)}</span></div>
        <div class="row"><b>ویدیوی من</b><span>${esc(S.src.video ? S.src.video.split('/').pop() : '— ثبت نشده')}</span></div>
        <div class="row"><b>رفرنس</b><span>${esc(S.src.reference ? S.src.reference.split('/').pop() : '— ثبت نشده')}</span></div>
        <div class="row"><b>خروجی</b><span>${esc(S.ratio)} · ${fa(30)}fps · کیفیت ${esc($('#quality')?.value || 'delivery')}</span></div>
        <div class="row"><b>ترنسکریپت</b><span>whisper ${esc($('#whisperModel')?.value || 'large-v3')} · فارسی</span></div>
      </div>`;
  }

  async function startJob() {
    if (!S.src.video) return toast('اول ویدیوی خودت را بده (گام ۲).', 'bad');
    if (!S.src.reference) return toast('ویدیوی رفرنس لازم است — استودیو با یک رفرنس یاد می‌گیرد (گام ۲).', 'bad');
    try {
      await saveProvider();
      const body = {
        name: $('#jobName').value.trim() || S.src.video.split('/').pop().replace(/\.[^.]+$/, ''),
        source: { video: S.src.video, reference: S.src.reference, logo: $('#logoPath').value.trim() || null },
        output: { ratio: S.ratio, quality: $('#quality').value, maxMb: Number($('#maxMb').value) || 200, fps: 30 },
        sound: S.sound,
        transcribe: { model: $('#whisperModel').value || 'large-v3', language: 'fa' },
        engine:
          S.agent.kind === 'api'
            ? { mode: 'provider', provider: S.provider, model: $('#providerModel').value.trim() || null }
            : S.agent.id === 'studio'
              ? { mode: 'studio' }
              : { mode: 'agent', agent: S.agent.id },
        direction: { text: $('#direction').value.trim() },
        cpu: { pct: S.cfg.cpu?.pct ?? 50 },
      };
      const job = await api('/api/jobs', { method: 'POST', body });
      const started = await api(`/api/jobs/${job.id}/start`, { method: 'POST' });
      if (started.queued) {
        const info = $('#queueInfo');
        info.hidden = false;
        const wakeText = started.spawned ? `tail -f workspace/jobs/${job.id}/agent-out.txt` : started.wake;
        info.innerHTML = `
          <div class="panel">
            <h3>در صف ایجنت</h3>
            <p>${started.spawned ? `ایجنت headless اجرا شد (pid ${fa(started.spawned.pid)}) — همین‌جا پیشرفتش را می‌بینی.` : 'ایجنت نصب نیست یا اسپاون نشد — این دستور را در ترمینال اجرا کن:'}</p>
            <div class="wake-row"><pre class="wake">${esc(wakeText)}</pre><button class="ghost tiny wake-copy">کپی</button></div>
          </div>`;
        info.querySelector('.wake-copy').addEventListener('click', () => copyText(wakeText, 'دستور wake کپی شد ✓'));
      }
      toast('جاب شروع شد');
      openJob(job.id, { switch: true });
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  /* ------------------------------------------------ build view */

  async function openJob(id, { switch: sw = false } = {}) {
    S.jobId = id;
    localStorage['studio.lastJob'] = id;
    if (sw) show('build');
    $('#emptyBuild').hidden = true;
    $('#buildBody').hidden = false;
    await refreshJob();
    listen();
  }

  async function refreshJob() {
    if (!S.jobId) return;
    try {
      S.job = await api(`/api/jobs/${S.jobId}`);
    } catch (err) {
      return toast(err.message, 'bad');
    }
    const j = S.job;
    $('#bv-name').textContent = j.config?.name || j.id;
    $('#bv-meta').textContent = `${j.config?.output?.ratio || ''} · whisper ${j.config?.transcribe?.model || ''} · ${j.config?.engine?.mode === 'agent' ? `ایجنت ${j.config.engine.agent || ''}` : j.config?.engine?.mode === 'provider' ? `API ${j.config.engine.provider || ''}` : 'استودیو'}`;
    paintStatus(j);
    paintProgress(j);
    paintGates(j);
    paintResult(j);
    loadArtifacts();
    if (j.gate?.kind !== S.lastGate) {
      S.lastGate = j.gate?.kind || null;
      if (S.lastGate === 'transcript') loadTranscript();
      if (S.lastGate === 'preview') {
        loadChat();
        loadStills();
      }
    }
  }

  function paintStatus(j) {
    const el = $('#bv-status');
    // class names follow the stylesheet (.status.succeeded / .status.queued / …)
    const cls = { running: 'running', review: 'queued', queued: 'queued', succeeded: 'succeeded', failed: 'failed', cancelled: 'failed', draft: 'queued' }[j.status] || 'queued';
    el.className = `status ${cls}`;
    const labels = { running: 'در حال ساخته شدن', review: 'منتظر تایید تویه', queued: 'در صف ایجنت', succeeded: 'آماده', failed: 'خطا', cancelled: 'لغو شد', draft: 'ساخته نشده' };
    el.innerHTML = `<i></i>${labels[j.status] || j.status}`;
    if (j.status === 'failed' && j.error) el.title = j.error;
  }

  function paintProgress(j) {
    const pct = j.progress?.pct ?? 0;
    $('#bv-pct').textContent = `${fa(pct)}٪`;
    $('#bv-fill').style.width = `${pct}%`;
    $('#bv-label').textContent = j.progress?.label || '';
    const stages = S.manifest?.stages || [];
    const stepOf = Object.fromEntries((j.progress?.steps || []).map((s) => [s.key, s]));
    $('#bv-stages').innerHTML = stages
      .map((st) => {
        const s = stepOf[st.key] || { state: 'pending' };
        return `<span class="stage-pill ${s.state === 'done' ? 'done' : s.state === 'active' ? 'active' : ''}"><i></i>${esc(st.label)}</span>`;
      })
      .join('');
  }

  function paintGates(j) {
    const gate = j.gate?.kind || null;
    $('#gate-transcript').hidden = gate !== 'transcript';
    $('#gate-preview').hidden = gate !== 'preview';
    $('#understandCards').hidden = !(j.approved?.transcript && j.progress?.pct >= 18 && !gate && j.status !== 'draft');
    // a queued agent job shows its wake command, copyable, right on the job page
    const queuedBox = $('#agentWake');
    if (j.status === 'queued' && j.config?.engine?.mode === 'agent') {
      queuedBox.hidden = false;
      const wake = `node cli.mjs claim ${j.id} --by ${j.config.engine.agent || 'agent'}`;
      queuedBox.querySelector('code').textContent = wake;
      const btn = queuedBox.querySelector('.wake-copy');
      if (!btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => copyText(queuedBox.querySelector('code').textContent, 'دستور wake کپی شد ✓'));
      }
    } else queuedBox.hidden = true;
    // video sources only ever change when the gate itself changes — never per tick
    if (j.status === 'review' && gate === 'transcript') {
      setSrc($('#trVideo'), ENGINE.url(`/api/jobs/${j.id}/source`));
    }
    if (gate === 'preview') {
      setSrc($('#pvVideo'), ENGINE.url(`/api/jobs/${j.id}/preview?v=${j.gate?.at || ''}`));
      $('#pvVideo').style.setProperty('--ar', (j.config?.output?.ratio || '16:9').replace(':', '/'));
    }
  }

  /* ------- transcript gate */

  async function loadTranscript() {
    const box = $('#trTable');
    try {
      const { cues } = await api(`/api/jobs/${S.jobId}/transcript`);
      S.trCues = cues;
      S.trDirty = false;
      paintTranscript();
      $('#trSave').disabled = true;
    } catch (err) {
      // a failed load must never leave an empty editable table behind: show
      // what happened and how to get out of it
      S.trCues = [];
      box.innerHTML = `<div class="tr-error"><b>ترنسکریپت خوانده نشد.</b><span>${esc(err.message)}</span><button class="ghost" id="trRetry">تلاش دوباره</button></div>`;
      $('#trRetry').addEventListener('click', loadTranscript);
      $('#trSave').disabled = true;
    }
  }

  function paintTranscript() {
    $('#trTable').innerHTML = S.trCues
      .map(
        (c, i) => `
      <div class="tr-row" data-i="${i}">
        <span class="t" data-seek="${c.start}"><b>${fa(i + 1)}</b>${esc(hhmmss(c.start))} → ${esc(hhmmss(c.end))}</span>
        <input value="${esc(c.text)}" data-i="${i}" spellcheck="false">
      </div>`,
      )
      .join('');
    $$('#trTable .t').forEach((t) =>
      t.addEventListener('click', () => {
        const v = $('#trVideo');
        v.currentTime = Number(t.dataset.seek);
        v.play().catch(() => {});
      }),
    );
    $$('#trTable input').forEach((inp) =>
      inp.addEventListener('input', () => {
        S.trCues[Number(inp.dataset.i)].text = inp.value;
        S.trDirty = true;
        $('#trSave').disabled = false;
      }),
    );
  }

  async function saveTranscript({ silent = false } = {}) {
    if (!S.trCues.length) {
      // an empty table is a load failure, not an edit — say so and offer the way back
      toast('جدول ترنسکریپت خالی است — اول «تلاش دوباره» را بزن', 'bad');
      return false;
    }
    const btn = $('#trSave');
    btn.disabled = true;
    btn.textContent = 'در حال ذخیره…';
    try {
      await api(`/api/jobs/${S.jobId}/transcript`, { method: 'PUT', body: { cues: S.trCues } });
      S.trDirty = false;
      if (!silent) toast('اصلاحات ذخیره شد ✓');
      return true;
    } catch (err) {
      toast(err.message, 'bad');
      return false;
    } finally {
      btn.textContent = 'ذخیرهٔ اصلاحات';
      btn.disabled = !S.trDirty;
    }
  }

  async function approve(gate) {
    try {
      if (gate === 'transcript' && S.trCues.length && !(await saveTranscript({ silent: true }))) return;
      await api(`/api/jobs/${S.jobId}/approve`, { method: 'POST', body: { gate } });
      toast(gate === 'transcript' ? 'ترنسکریپت تایید شد — ادامه می‌دهد' : 'تایید شد — خروجی نهایی می‌سازد');
      await refreshJob();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  /* ------- preview gate: chat + stills */

  async function loadChat() {
    try {
      const { messages } = await api(`/api/jobs/${S.jobId}/chat`);
      $('#chatLog').innerHTML =
        messages
          .map(
            (m) => `
        <div class="chat-msg ${esc(m.role)}">${esc(m.text)}<small>${esc((m.ts || '').slice(11, 16))}</small></div>`,
          )
          .join('') || '<p class="hint">هنوز پیامی نیست — ادیتت رو خودمونی بنویس؛ مثلاً: تراکم بیشتر 👌</p>';
      $('#chatLog').scrollTop = 1e6;
    } catch {
      /* fresh job */
    }
  }

  async function sendChat(text) {
    if (!text.trim()) return;
    const btn = $('#chatForm button');
    const input = $('#chatInput');
    btn.disabled = true;
    try {
      await api(`/api/jobs/${S.jobId}/chat`, { method: 'POST', body: { text } });
      input.value = '';
      await loadChat();
      await refreshJob();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  async function loadStills() {
    try {
      const { stills } = await api(`/api/jobs/${S.jobId}/stills`);
      $('#pvStills').innerHTML = stills
        .map((f) => `<img src="${ENGINE.url(`/api/jobs/${S.jobId}/still?name=${encodeURIComponent(f)}`)}" alt="${esc(f)}" title="${esc(f)}">`)
        .join('');
    } catch {
      $('#pvStills').innerHTML = '';
    }
  }

  /* ------- artifacts + result */

  async function loadArtifacts() {
    try {
      const a = await api(`/api/jobs/${S.jobId}/artifacts`);
      const row = (label, art, file) =>
        art ? `<div class="row"><b>${label}</b><a href="${ENGINE.url(`/api/jobs/${S.jobId}/media?file=${encodeURIComponent(file)}`)}" target="_blank">باز کن</a></div>` : '';
      $('#artifactBox').innerHTML =
        row('بریف (understand)', a.brief, 'brief.json') +
        row('پروفایل رفرنس', a.style, 'style.json') +
        row('سناریو (strategy)', a.scenario, 'scenario.md') +
        row('بیت‌ها', a.beats, 'beats.json') +
        row('برند', a.brand, 'brand.json') +
        row('طراحی صدا', a.sound, 'sound.json') +
        row('HANDOFF (ایجنت)', a.handoff, 'HANDOFF.md') +
        row('خروجی ایجنت', a.agentOut, 'agent-out.txt');
    } catch {
      /* job may be too fresh */
    }
  }

  function paintResult(j) {
    const ok = j.status === 'succeeded' && j.output;
    $('#resultPanel').hidden = !ok;
    if (!ok) return;
    $('#resVideo').src = ENGINE.url(`/api/jobs/${j.id}/preview`);
    $('#resVideo').style.setProperty('--ar', (j.config?.output?.ratio || '16:9').replace(':', '/'));
    const o = j.output;
    $('#resMeta').innerHTML = `
      <span class="chip">${fa(o.width)}×${fa(o.height)}</span>
      <span class="chip">${fa(o.fps)}fps</span>
      <span class="chip">${esc(o.mb)} MB</span>
      <span class="chip">${esc(hhmmss(o.duration))}</span>
      ${o.withinBudget ? '<span class="chip">زیر سقف حجم ✓</span>' : '<span class="chip">بیش از سقف!</span>'}`;
    $('#resDownload').href = ENGINE.url(`/api/jobs/${j.id}/download`);
  }

  /* ------- live wire */

  function listen() {
    if (S.es) S.es.close();
    S.fromByte = 0;
    S.es = new EventSource(ENGINE.url(`/api/jobs/${S.jobId}/events`));
    S.es.addEventListener('progress', (e) => {
      const prog = JSON.parse(e.data);
      if (S.job) S.job.progress = prog;
      paintProgress(S.job || { progress: prog });
    });
    S.es.addEventListener('log', (e) => {
      const { chunk } = JSON.parse(e.data);
      appendLog(chunk);
    });
    S.es.addEventListener('state', (e) => {
      const st = JSON.parse(e.data);
      if (st.status === 'deleted') return;
      if (S.job) {
        S.job.status = st.status;
        S.job.gate = st.gate;
        S.job.approved = st.approved;
        S.job.output = st.output || S.job.output;
        paintStatus(S.job);
        paintGates(S.job);
        paintResult(S.job);
        if (st.status === 'succeeded' || st.status === 'failed') loadArtifacts();
      }
    });
  }

  function appendLog(chunk) {
    const box = $('#log');
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      const m = /^(\S+) \[(\w+)\] ([\s\S]*)$/.exec(line);
      if (!m) continue;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="ts">${esc(m[1].slice(11, 19))}</span><span class="lv ${esc(m[2])}">${esc(m[2])}</span><span class="msg">${esc(m[3])}</span>`;
      box.append(row);
    }
    while (box.children.length > 400) box.firstChild.remove();
    box.scrollTop = 1e6;
  }

  async function cancelJob() {
    if (!S.jobId) return;
    try {
      await api(`/api/jobs/${S.jobId}/cancel`, { method: 'POST' });
      toast('لغو شد');
      await refreshJob();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  /* ------------------------------------------------ jobs + references + settings */

  async function loadJobs() {
    const { jobs } = await api('/api/jobs');
    $('#jobList').innerHTML =
      jobs
        .map((j) => {
          const labels = { running: 'در حال ساخته شدن', review: 'منتظر تایید تویه', queued: 'در صف', succeeded: 'آماده', failed: 'خطا', cancelled: 'لغو', draft: 'پیش‌نویس' };
          return `
        <div class="job-row" data-id="${esc(j.id)}">
          <span class="name">${esc(j.config?.name || j.id)}</span>
          <span class="meta">${esc(j.id)} · ${esc(labels[j.status] || j.status)}</span>
          <span class="pct">${fa(j.progress?.pct ?? 0)}٪</span>
        </div>`;
        })
        .join('') || '<p class="hint">هنوز جابی نیست — اولین ویدیوت رو بنداز تا ببینیم چی ازش درمیاد 🎬</p>';
    $$('#jobList .job-row').forEach((r) => r.addEventListener('click', () => openJob(r.dataset.id, { switch: true })));
  }

  async function loadReferences() {
    const { references: refs } = await api('/api/references');
    $('#refList').innerHTML =
      refs
        .map(
          (r) => `
      <div class="ref-card">
        <div class="ref-frames">${(r.frames || [])
          .map((f) => `<img src="${ENGINE.url(`/api/references/${r.sha}/frames/${f}`)}" alt="">`)
          .join('')}</div>
        <div class="ref-body">
          <div class="name">${esc(r.name)}</div>
          <div class="ref-chips">
            ${r.summary?.density ? `<span class="chip">چگالی ${esc(r.summary.density)}</span>` : ''}
            ${r.summary?.energy != null ? `<span class="chip">انرژی ${fa(Math.round(r.summary.energy * 100))}٪</span>` : ''}
            ${r.summary?.look ? `<span class="chip">${esc(r.summary.look)}</span>` : ''}
            <span class="chip">${fa(hhmmss(r.duration))}</span>
            <span class="chip">${fa(r.jobs?.length || 0)} جاب</span>
          </div>
          <button class="ghost tiny use-ref" data-p="${esc(r.path || '')}">استفاده در جاب جدید</button>
        </div>
      </div>`,
        )
        .join('') || '<p class="hint">حافظه‌ی رفرنس خالیه — با اولین جاب پر می‌شه و دیگه یادش نمی‌ره 🧠</p>';
    $$('#refList .use-ref').forEach((b) =>
      b.addEventListener('click', async () => {
        const p = b.dataset.p;
        if (!p) return toast('مسیر اصلی این رفرنس ثبت نشده بود — فایلش را دوباره انتخاب کن.', 'bad');
        try {
          await api(`/api/probe?path=${encodeURIComponent(p)}`);
          S.src.reference = p;
          paintSources();
          show('new-job');
          goStep(2);
          await setSource('reference', p);
          toast('رفرنس از حافظه انتخاب شد ✓');
        } catch {
          toast('فایل رفرنس دیگر سر جای قبلی نیست — دوباره انتخابش کن.', 'bad');
        }
      }),
    );
  }

  /* ------- the model store: categories, download, delete, default ------- */

  let modelCat = 'stt';
  let modelPolling = false;

  async function paintModels() {
    try {
      S.models = await api('/api/models');
      const list = S.models.catalog.filter((m) => m.category === modelCat);
      $('#modelList').innerHTML =
        list
          .map((m) => {
            const dl = S.models.downloading?.includes(m.id);
            const prog = S.models.progress?.[m.id];
            const status = m.present
              ? '<span class="chip">روی سیستمه ✓</span>'
              : dl
                ? `<span class="chip">در حال دانلود ${prog ? '· ' + fa(prog.pct) + '٪' : ''}</span>`
                : '<span class="chip">دانلود نشده</span>';
            return `
      <div class="model-row ${m.default ? 'is-default' : ''}">
        <div class="m-head">
          <b>${esc(m.id)}${m.default ? ' <span class="m-default">پیش‌فرض</span>' : ''}</b>
          <span class="m-meta">${esc(mb(m.bytes))}${m.enOnly ? ' · فقط انگلیسی' : ''}</span>
        </div>
        <p class="m-fa">${esc(m.fa)}</p>
        ${dl && prog ? `<div class="progress-track slim"><div class="progress-fill" style="width:${prog.pct}%"></div></div>` : ''}
        <div class="m-actions">
          ${m.kind === 'whisper' ? `<button class="ghost tiny m-def" data-id="${esc(m.id)}" ${m.present && !m.default ? '' : 'disabled'}>${m.default ? 'پیش‌فرض ✓' : 'بزرگش کن پیش‌فرض'}</button>` : ''}
          ${m.present ? `<button class="ghost tiny m-del" data-id="${esc(m.id)}">حذف و آزادسازی</button>` : ''}
          <button class="primary tiny m-dl" data-id="${esc(m.id)}" ${dl || m.present ? 'disabled' : ''}>${dl ? 'در حال دانلود…' : m.present ? 'نصب است ✓' : 'دانلود'}</button>
        </div>
      </div>`;
          })
          .join('') || '<p class="hint">—</p>';
      $('#modelDirHint').textContent = `محل ذخیره: ${(modelCat === 'stt' ? S.models.dirs.stt : S.models.dirs.tts).replace(/^\/Users\/[^/]+/, '~')}`;
      $$('#modelList .m-dl').forEach((b) =>
        b.addEventListener('click', async () => {
          const id = b.dataset.id;
          b.disabled = true;
          b.textContent = 'شروع…';
          try {
            await api('/api/models/download', { method: 'POST', body: { id } });
            toast(`دانلود ${id} شروع شد — تا تمام شدن همین‌جا می‌مونه`);
            pollModels();
          } catch (err) {
            toast(err.message, 'bad');
            paintModels();
          }
        }),
      );
      $$('#modelList .m-del').forEach((b) =>
        b.addEventListener('click', async () => {
          const id = b.dataset.id;
          if (!confirm(`«${id}» حذف بشه تا فضا آزاد بشه؟ بعداً دوباره می‌تونی دانلودش کنی.`)) return;
          try {
            await api('/api/models/delete', { method: 'POST', body: { id } });
            toast(`${id} حذف شد — فضا آزاد شد`);
            paintModels();
          } catch (err) {
            toast(err.message, 'bad');
          }
        }),
      );
      $$('#modelList .m-def').forEach((b) =>
        b.addEventListener('click', async () => {
          S.cfg = await api('/api/config', { method: 'POST', body: { transcribe: { model: b.dataset.id } } });
          toast(`${b.dataset.id} پیش‌فرض ترنسکریپت شد ✓`);
          paintModels();
        }),
      );
    } catch {
      $('#modelList').innerHTML = '<p class="hint">—</p>';
    }
  }

  async function pollModels() {
    if (modelPolling) return;
    modelPolling = true;
    while (true) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const d = await api('/api/models');
        S.models = d;
        if (S.view === 'settings') await paintModels();
        if (!(d.downloading || []).length) break;
      } catch {
        break;
      }
    }
    modelPolling = false;
    toast('دانلود مدل تمام شد ✓');
  }

  async function paintCpuDetail(pct) {
    try {
      const pf = await api(`/api/preflight?cpu=${pct}`);
      $('#cpuDetail').innerHTML = `
        <div class="row"><b>رشته‌های مجاز</b><span>${fa(pf.threads)}</span></div>
        <div class="row"><b>ورکرهای رندر</b><span>${fa(pf.workers)}</span></div>
        <div class="row"><b>قانون خانه</b><span>${pf.pct <= 50 ? 'رعایت می‌شود ✓' : 'بالاتر از ۵۰٪ — دستگاه گرم‌تر می‌شود'}</span></div>
        ${pf.warnings.map((w) => `<div class="row"><b>هشدار</b><span>${esc(w)}</span></div>`).join('')}`;
    } catch {
      /* engine off */
    }
  }

  async function loadSettings() {
    S.cfg = await api('/api/config');
    $$('#modelTabs .chip').forEach((c) =>
      c.addEventListener('click', () => {
        modelCat = c.dataset.cat;
        $$('#modelTabs .chip').forEach((x) => x.classList.toggle('on', x === c));
        paintModels();
      }),
    );

    const pct = S.cfg.cpu?.pct ?? 50;
    $('#cpuSlider').value = pct;
    $('#cpuPct').textContent = `${fa(pct)}٪`;
    await paintCpuDetail(pct);
    // the model store
    await paintModels();
    // brand
    try {
      const brand = await api('/api/brand');
      $('#brandAccent').value = brand?.palette?.accent || '';
      $('#brandNote').value = 'برای هر جاب از پروفایل رفرنس گرفته می‌شود';
    } catch {
      /* no studio brand yet */
    }
    // providers
    $('#providerSettings').innerHTML = (S.cfg.presets || [])
      .map((p) => {
        const st = (S.cfg.providers || {})[p.id] || {};
        return `
        <div class="prov-row" data-p="${esc(p.id)}">
          <b>${esc(p.fa)}</b>
          <input type="text" class="pk-model" placeholder="model" value="${esc(st.model || '')}">
          <input type="password" class="pk-key" placeholder="${st.hasKey ? 'کلید ذخیره شده ✓' : 'کلید API'}">
        </div>`;
      })
      .join('');
    $$('#providerSettings .prov-row').forEach((row) => {
      row.querySelector('.pk-key').addEventListener('change', async (e) => {
        if (!e.target.value.trim()) return;
        S.cfg = await api('/api/config', { method: 'POST', body: { providers: { [row.dataset.p]: { apiKey: e.target.value.trim() } } } });
        e.target.value = '';
        e.target.placeholder = 'کلید ذخیره شد ✓';
        toast('کلید ذخیره شد ✓');
      });
      row.querySelector('.pk-model').addEventListener('change', async (e) => {
        S.cfg = await api('/api/config', { method: 'POST', body: { providers: { [row.dataset.p]: { model: e.target.value.trim() } } } });
      });
    });
  }

  /** The About card: who built it, which version, and the in-app updater. */
  function paintAbout() {
    const m = S.manifest || {};
    $('#aboutRows').innerHTML = `
      <div class="row"><b>نسخهٔ اپ</b><span>${esc(m.appVersion || 'نسخهٔ وب — از ترمینال اجرا شده')}</span></div>
      <div class="row"><b>موتور</b><span>${esc(m.studio)} ${esc(m.version)} · HyperFrames</span></div>
      <div class="row"><b>سازنده</b><span>Pedram Gholizadeh · پدرام قلی‌زاده</span></div>`;
    const api = window.electronAPI;
    const btn = $('#updateCheck');
    if (!api) {
      btn.hidden = true;
      $('#updateState').innerHTML = '';
      return;
    }
    btn.hidden = false;
    $('#updateState').innerHTML = `<div class="row"><b>به‌روزرسانی</b><span>از GitHub Releases — خودکار چک می‌شود</span></div>`;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'در حال بررسی…';
      try {
        await api.checkForUpdates();
      } catch (err) {
        toast(err.message || 'بررسی نشد', 'bad');
      } finally {
        btn.disabled = false;
        btn.textContent = 'بررسی به‌روزرسانی';
      }
    };
    api.onUpdateStatus((s) => {
      const box = $('#updateState');
      if (s.status === 'checking') box.innerHTML = `<div class="row"><b>به‌روزرسانی</b><span>در حال بررسی…</span></div>`;
      if (s.status === 'available') box.innerHTML = `<div class="row"><b>به‌روزرسانی</b><span>نسخهٔ ${esc(s.version)} پیدا شد — در حال دانلود…</span></div>`;
      if (s.status === 'not-available') box.innerHTML = `<div class="row"><b>به‌روزرسانی</b><span>آخرین نسخه را داری ✓</span></div>`;
      if (s.status === 'downloaded') {
        box.innerHTML = `<div class="row"><b>به‌روزرسانی</b><span>نسخهٔ ${esc(s.version)} دانلود شد</span></div>
          <div class="actions"><button class="primary" id="updateInstall">نصب و راه‌اندازی دوباره</button></div>`;
        $('#updateInstall').onclick = () => api.installUpdate();
        toast(`نسخهٔ ${s.version} آمادهٔ نصب است ✓`);
      }
      if (s.status === 'error') {
        box.innerHTML = `<div class="row"><b>به‌روزرسانی</b><span>خطا: ${esc(s.message || '')}</span></div>`;
        toast(s.message || 'خطای به‌روزرسانی', 'bad');
      }
    });
  }

  async function paintCpuDetail(pct) {
    try {
      const pf = await api(`/api/preflight?cpu=${pct}`);
      $('#cpuDetail').innerHTML = `
        <div class="row"><b>رشته‌های مجاز</b><span>${fa(pf.threads)}</span></div>
        <div class="row"><b>ورکرهای رندر</b><span>${fa(pf.workers)}</span></div>
        <div class="row"><b>قانون خانه</b><span>${pf.pct <= 50 ? 'رعایت می‌شود ✓' : 'بالاتر از ۵۰٪ — دستگاه گرم‌تر می‌شود'}</span></div>
        ${pf.warnings.map((w) => `<div class="row"><b>هشدار</b><span>${esc(w)}</span></div>`).join('')}`;
    } catch {
      /* engine off */
    }
  }

  /* ------------------------------------------------ wire-up */

  function wire() {
    $$('.nav-link').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
    $$('[data-view]').forEach((b) =>
      b.addEventListener('click', (e) => {
        const v = b.dataset.view;
        if (v && !b.classList.contains('nav-link')) show(v);
      }),
    );
    $('#langBtn').addEventListener('click', () => {
      const cur = localStorage['studio.lang'] || 'fa';
      localStorage['studio.lang'] = cur === 'fa' ? 'en' : 'fa';
      location.reload();
    });
    $('#backBtn').addEventListener('click', () => goStep(S.step - 1));
    $('#nextBtn').addEventListener('click', () => (S.step === 4 ? startJob() : goStep(S.step + 1)));
    $('#startBtn').addEventListener('click', startJob);

    // source slots: pick + drag & drop
    $$('.card.source .slot').forEach((slot) => {
      const kind = slot.dataset.slot;
      slot.querySelector('.pick').addEventListener('click', () => openBrowser(kind));
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('drag');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('drag'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag');
        const f = e.dataTransfer.files?.[0];
        if (f) uploadFile(f, kind).catch((err) => toast(err.message, 'bad'));
      });
    });

    $('#browserClose').addEventListener('click', () => ($('#browser').hidden = true));
    $('#trSave').addEventListener('click', saveTranscript);
    $('#trApprove').addEventListener('click', () => approve('transcript'));
    $('#pvApprove').addEventListener('click', () => approve('preview'));
    $('#chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      sendChat($('#chatInput').value);
    });
    $('#bv-cancel').addEventListener('click', cancelJob);
    $('#bv-close').addEventListener('click', () => {
      $('#buildBody').hidden = true;
      $('#emptyBuild').hidden = false;
      if (S.es) S.es.close();
      S.es = null;
    });
    $('#cpuSlider').addEventListener('input', (e) => {
      const pct = Number(e.target.value);
      $('#cpuPct').textContent = `${fa(pct)}٪`;
      paintCpuDetail(pct);
    });
    $('#cpuSave').addEventListener('click', async () => {
      S.cfg = await api('/api/config', { method: 'POST', body: { cpu: { pct: Number($('#cpuSlider').value) } } });
      toast(`توان روی ${$('#cpuSlider').value}٪ ذخیره شد ✓`);
      refreshMachine();
    });
    $('#brandSave').addEventListener('click', async () => {
      const accent = $('#brandAccent').value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return toast('اکسنت باید مثل #55e6a5 باشد', 'bad');
      await api('/api/brand', { method: 'PUT', body: { palette: { accent } } });
      toast('برند استودیو ذخیره شد ✓');
    });
  }

  /* ------------------------------------------------ boot */

  async function boot() {
    try {
      [S.manifest, S.cfg, S.agents] = await Promise.all([api('/api/manifest'), api('/api/config'), api('/api/agents')]);
    } catch (err) {
      ENGINE.show();
      return;
    }
    S.ratio = S.cfg.output?.ratio || '16:9';
    wire();
    paintAgents();
    paintRatios();
    paintSound();
    paintSources();
    paintStartSummary();
    await paintWhisperSelect();
    refreshMachine();
    setInterval(refreshMachine, 30000);
    goStep(1);
    if (S.jobId) {
      try {
        await openJob(S.jobId);
        show('build');
      } catch {
        S.jobId = null;
      }
    }
    show(S.jobId ? 'build' : 'new-job');
  }

  window.addEventListener('studio:engine-up', () => location.reload());
  boot();
})();
