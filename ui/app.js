const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const mb = (b) => `${(b / 1000000).toFixed(1)} مگ`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]}`);

const FOLDER_ICO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';

const S = {
  step: 1,
  manifest: null,
  source: { video: null, audio: null, srt: null, reference: null },
  output: { ratio: '2:1', background: 'site', layout: 'auto', quality: 'delivery', format: 'mp4', maxMb: 200, fps: 30 },
  motion: { mode: 'motion', deliver: 'overlay', density: 'auto', material: 'glass' },
  sound: { sfx: true, level: 'balanced' },
  brand: { preset: 'house', accent: '' },
  template: null,
  style: null,
  engine: { mode: 'agent', provider: 'openrouter', model: '' },
  cpu: 50,
  job: null,
  es: null,
};

async function api(path, opts = {}) {
  const res = await fetch(ENGINE.url(path), {
    ...opts,
    headers: { ...(opts.headers || {}), ...ENGINE.headers(opts.method) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  // A hosted panel is a static page: nothing works until the engine on this
  // computer answers, so say that plainly instead of failing on every call.
  if (!(await ENGINE.probe())) {
    ENGINE.show();
    return;
  }
  ENGINE.hide();
  S.manifest = await api('/api/manifest');
  const d = S.manifest.defaults;
  S.output = { ...S.output, ...d.output };
  S.motion = { ...S.motion, ...(d.motion || {}) };
  S.sound = { ...S.sound, ...(d.sound || {}) };
  S.cpu = d.cpu?.pct ?? 50;

  renderRatios();
  renderModes();
  renderDelivers();
  renderDensities();
  renderMaterials();
  renderSoundLevels();
  renderLayouts();
  renderQualities();
  renderBackgrounds();
  renderBrandPresets();
  renderTemplates();
  renderEngines();
  renderProviderSelect();
  fillTextDefaults(d);
  applyMode();
  $('#cpu').value = S.cpu;
  $('#maxMb').value = S.output.maxMb;
  $('#format').value = S.output.format;
  $('#sfxOn').checked = S.sound.sfx;
  await Promise.all([refreshMachine(), refreshCpu()]);
  goto(1);

  $('#next').onclick = () => goto(S.step + 1);
  $('#back').onclick = () => goto(S.step - 1);
  $$('#steps li').forEach((li) => {
    li.onclick = () => goto(Number(li.dataset.step));
    li.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goto(Number(li.dataset.step));
      }
    };
  });
  $('#build').onclick = start;
  $('#backToWizard').onclick = () => {
    S.es?.close();
    $('#build-view').hidden = true;
    $('#wizard').hidden = false;
  };
  $('#maxMb').oninput = (e) => (S.output.maxMb = Number(e.target.value) || 200);
  $('#format').onchange = (e) => (S.output.format = e.target.value);
  $('#sfxOn').onchange = (e) => {
    S.sound.sfx = e.target.checked;
    renderSfxNote();
  };
  $('#cpu').oninput = async (e) => {
    S.cpu = Number(e.target.value);
    await refreshCpu();
  };
  $('#provider').onchange = () => {
    renderProviderSelect();
    loadModels().catch(() => {});
  };
  $('#loadModels').onclick = () => loadModels().catch((e) => setNote(e.message));
  $('#apiKey').onchange = saveProviderConfig;
  $('#baseUrl').onchange = saveProviderConfig;
  $('#model').onchange = saveProviderConfig;

  // A refresh in the middle of a render should land on the live bar, not back
  // at step one.
  const last = localStorage.getItem('studio.lastJob');
  if (last) {
    try {
      const j = await api(`/api/jobs/${last}`);
      if (['queued', 'running'].includes(j.status)) openBuild(j);
    } catch {
      localStorage.removeItem('studio.lastJob');
    }
  }
}

function fillTextDefaults(d) {
  const t = d.title || {};
  $('#t-kicker').value = t.kicker || '';
  $('#t-headline').value = t.headline || '';
  $('#t-accent').value = t.accentWord || '';
  $('#t-sub').value = t.sub || '';
  $('#e-name').value = d.endcard?.name || '';
  $('#e-site').value = d.endcard?.site || '';
}

/* ---------------------------------------------------------------- steps */

const HINTS = {
  1: 'یک منبع کافی است؛ با ویدیو یا صدا می‌توانی زیرنویس هم بدهی.',
  2: 'نسبت تصویر بوم رندر را تعیین می‌کند.',
  3: 'پس‌زمینه‌ها زنده پیش‌نمایش می‌شوند، با همان کدی که رندر می‌شود.',
  4: 'هرچه دربارهٔ ادیت بنویسی، همان جهت کار است.',
};

function goto(n) {
  const target = Math.max(1, Math.min(4, n));
  if (target > S.step && !validate(S.step)) return;
  S.step = target;
  $$('.panel').forEach((p) => (p.hidden = Number(p.dataset.panel) !== S.step));
  $$('#steps li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === S.step);
    li.classList.toggle('done', s < S.step);
    if (s === S.step) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
  /* pipeline rail — real step progress */
  const railFill = document.querySelector('.rail i');
  if (railFill) railFill.style.width = `${((S.step - 1) / 3) * 100}%`;
  $('#back').style.visibility = S.step === 1 ? 'hidden' : 'visible';
  $('#next').style.display = S.step === 4 ? 'none' : '';
  $('#stepHint').textContent = HINTS[S.step];
  if (S.step === 3) renderBackgrounds();
}

function validate(n) {
  if (n === 1) {
    if (!S.source.video && !S.source.audio && !S.source.srt) {
      flash('هیچ منبعی انتخاب نشده — یک فایل بده.');
      return false;
    }
  }
  return true;
}

function flash(msg) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstElementChild.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  t.onclick = () => t.remove();
  box.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 320);
  }, 5200);
}

/* ------------------------------------------------------------ rendering */

function renderRatios() {
  const box = $('#ratios');
  box.innerHTML = '';
  for (const r of S.manifest.ratios) {
    const b = document.createElement('button');
    b.className = 'card' + (r.id === S.output.ratio ? ' on' : '');
    b.type = 'button';
    const scale = 110 / Math.max(r.w, r.h);
    b.innerHTML = `<div class="frame" style="height:${Math.round(r.h * scale) + 2}px;display:grid;place-items:center">
        <span style="display:block;width:${Math.round(r.w * scale)}px;height:${Math.round(r.h * scale)}px;background:var(--surface);border:1px solid var(--hairline);border-radius:3px"></span>
      </div>
      <div class="t">${r.fa}</div>
      <div class="s">${r.id} · ${r.px} · ${r.hint}</div>`;
    b.onclick = () => {
      S.output.ratio = r.id;
      $$('#ratios .card').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      renderBackgrounds(true);
      paintTeaserNote();
    };
    box.appendChild(b);
  }
  paintTeaserNote();
}

/** Teaser ratios (9:16, 16:9) automatically burn subtitles in and lock every
 *  text inside the platform safe rect — say so where the ratio is picked. */
function paintTeaserNote() {
  const note = $('#ratioNote');
  if (!note) return;
  const teaser = ['9:16', '16:9'].includes(S.output.ratio);
  note.hidden = !teaser;
  note.textContent = teaser
    ? 'حالت تیزر: زیرنویس کلمه‌به‌کلمه خودکار روی فیلم می‌سوزد و همهٔ متن‌ها داخل حاشیهٔ امن پلتفرم قفل می‌شوند — روی ۹:۱۶ یعنی دور از نوار اکشن و کپشنِ ریلز اینستاگرام.'
    : '';
}

function renderLayouts() {
  const box = $('#layouts');
  box.innerHTML = '';
  for (const l of S.manifest.layouts) {
    const b = document.createElement('button');
    b.className = 'chip' + (l.id === S.output.layout ? ' on' : '');
    b.type = 'button';
    b.textContent = l.fa;
    b.title = l.note;
    b.onclick = () => {
      S.output.layout = l.id;
      $$('#layouts .chip').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
    };
    box.appendChild(b);
  }
}

/* ------------------------------------------------------- motion controls */

function renderModes() {
  const box = $('#modes');
  box.innerHTML = '';
  for (const m of S.manifest.modes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card' + (m.id === S.motion.mode ? ' on' : '');
    b.innerHTML = `<div class="t">${m.fa}</div><div class="s">${m.note}</div>`;
    b.onclick = () => {
      S.motion.mode = m.id;
      $$('#modes .card').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      applyMode();
    };
    box.appendChild(b);
  }
}

function renderDelivers() {
  const box = $('#delivers');
  box.innerHTML = '';
  for (const d of S.manifest.delivers) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (d.id === S.motion.deliver ? ' on' : '');
    b.textContent = d.fa;
    b.title = d.note;
    b.onclick = () => {
      S.motion.deliver = d.id;
      $$('#delivers .chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      applyMode();
    };
    box.appendChild(b);
  }
}

function renderDensities() {
  const box = $('#densities');
  box.innerHTML = '';
  for (const opt of [{ id: 'auto', fa: 'از رفرنس', perMinute: null }, ...S.manifest.densities]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (opt.id === S.motion.density ? ' on' : '');
    b.textContent = opt.perMinute ? `${opt.fa} (${fa(opt.perMinute)}/دقیقه)` : opt.fa;
    b.onclick = () => {
      S.motion.density = opt.id;
      $$('#densities .chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    };
    box.appendChild(b);
  }
}

function renderMaterials() {
  const box = $('#materials');
  box.innerHTML = '';
  for (const m of S.manifest.materials) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (m.id === S.motion.material ? ' on' : '');
    b.textContent = m.fa;
    b.onclick = () => {
      S.motion.material = m.id;
      $$('#materials .chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    };
    box.appendChild(b);
  }
}

function renderSoundLevels() {
  const box = $('#soundLevels');
  box.innerHTML = '';
  for (const l of S.manifest.soundLevels) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (l.id === S.sound.level ? ' on' : '');
    b.textContent = l.fa;
    b.onclick = () => {
      S.sound.level = l.id;
      $$('#soundLevels .chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      renderSfxNote();
    };
    box.appendChild(b);
  }
  $('#soundLevels').hidden = !S.sound.sfx;
  renderSfxNote();
  renderRecipes().catch(() => {});
}

function renderSfxNote() {
  $('#soundLevels').hidden = !S.sound.sfx;
  $('#sfxNote').textContent = S.sound.sfx
    ? 'هر صدا روی همان ساعت ویدیو می‌نشیند و بلندیش اندازه‌گیری می‌شود: اگر زیر گفتار بماند، بلندتر می‌شود.'
    : 'لایه بی‌صدا تحویل می‌شود؛ صدای خودت سر جایش می‌ماند.';
}

/**
 * Visual-style templates (lib/templates.mjs): one code, one whole look.
 * Picking one shows the reference film's own frame, so "which style is 001?"
 * is answered by the source itself.
 */
function renderTemplates() {
  const box = $('#templateChips');
  if (!box) return;
  const list = [{ id: null, fa: 'سلیقهٔ خانه' }, ...(S.manifest?.templates || [])];
  box.innerHTML = '';
  for (const t of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + ((S.template || null) === t.id ? ' on' : '');
    b.title = t.hint || '';
    b.textContent = t.id ? `${t.fa} · ${t.id}` : t.fa;
    b.onclick = () => {
      S.template = t.id;
      $$('#templateChips .chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      paintTemplateCard();
    };
    box.appendChild(b);
  }
  paintTemplateCard();
}

function paintTemplateCard() {
  const card = $('#templateCard');
  if (!card) return;
  const tpl = (S.manifest?.templates || []).find((t) => t.id === S.template);
  card.hidden = !tpl;
  if (!tpl) return;
  $('#templateThumb').src = ENGINE.url(`/api/templates/${tpl.id}/thumb`);
  $('#templateNote').textContent = `فریم مرجع — این سبک با کد ${tpl.id} ذخیره شده: ${tpl.hint}. زمینه «${tpl.background}» و کارت‌های «${tpl.material}» از قالب قفل می‌شوند.`;
}

/**
 * The brand personality: one token set for the whole film (shotcraft's six
 * brand→motion presets). 'house' keeps the studio's own look.
 */
function renderBrandPresets() {
  const box = $('#brandPresets');
  if (!box) return;
  const list = [{ id: 'house', fa: 'سلیقهٔ خانه', hint: 'اعداد خانهٔ استودیو' }, ...(S.manifest?.personalities || [])];
  box.innerHTML = '';
  for (const p of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + ((S.brand.preset || 'house') === p.id ? ' on' : '');
    b.title = p.hint || '';
    b.textContent = p.fa;
    b.onclick = () => {
      S.brand.preset = p.id;
      $$('#brandPresets .chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $('#brandNote').textContent = p.hint ? `یک ست توکن برای کل موشن: ${p.hint}` : '';
    };
    box.appendChild(b);
  }
  const accent = $('#brandAccent');
  if (accent)
    accent.oninput = () => {
      S.brand.accent = accent.value;
    };
  initStudioBrandEditor().catch(() => {});
}

/** The studio-wide brand file: every job inherits it unless it overrides. */
async function initStudioBrandEditor() {
  const box = $('#studioBrandBox');
  if (!box || box.dataset.done) return;
  const r = await api('/api/brand');
  box.dataset.done = '1';
  const sel = $('#sb-preset');
  sel.innerHTML =
    `<option value="">(پریست ندارد — اعداد خانه)</option>` +
    (r.personalities || []).map((p) => `<option value="${esc(p.id)}">${esc(p.fa)}</option>`).join('');
  const b = r.brand || {};
  $('#sb-name').value = b.name || '';
  sel.value = b.preset && b.preset !== 'house' ? b.preset : '';
  if (b.palette?.accent) $('#sb-accent').value = b.palette.accent;
  if (b.palette?.ground) $('#sb-ground').value = b.palette.ground;
  if (b.palette?.ink) $('#sb-ink').value = b.palette.ink;
  $('#sb-note').textContent = r.resolved
    ? `الان اثر می‌کند: شخصیت «${b.presetFa || 'خانه'}»، اکسنت ${r.resolved.palette.accent}، انرژی ${r.resolved.motion.energy}`
    : $('#sb-note').textContent;
  $('#sb-save').onclick = async () => {
    const patch = {
      name: $('#sb-name').value.trim(),
      preset: $('#sb-preset').value || 'house',
      palette: {
        accent: $('#sb-accent').value,
        ground: $('#sb-ground').value,
        ink: $('#sb-ink').value,
      },
    };
    try {
      const saved = await api('/api/brand', { method: 'PUT', body: JSON.stringify(patch) });
      $('#sb-note').textContent = `ذخیره شد — اکسنت ${saved.resolved.palette.accent}، انرژی ${saved.resolved.motion.energy}`;
      renderBackgrounds();
    } catch (e) {
      $('#sb-note').textContent = `ذخیره نشد: ${e.message}`;
    }
  };
}

async function renderRecipes() {
  const box = $('#recipes');
  if (box.dataset.done) return;
  const r = await api('/api/recipes');
  box.innerHTML = r.recipes
    .map((x) => `<li><b>${esc(x.fa)}</b> — ${esc(x.about)} <span class="tiny">(${fa(Math.round(x.len[0]))}–${fa(Math.round(x.len[1]))} ثانیه)</span></li>`)
    .join('');
  box.dataset.done = '1';
}

/** One switch decides what the rest of the wizard means. */
function applyMode() {
  const motion = S.motion.mode === 'motion';
  const overlay = motion && S.motion.deliver === 'overlay';
  $$('[data-motion-only]').forEach((el) => (el.hidden = !motion));
  $$('[data-captions-only]').forEach((el) => (el.hidden = motion));
  $('#delivers').hidden = !motion;
  $('#modeNote').textContent = overlay
    ? 'خروجی یک لایهٔ WebM شفاف به اندازهٔ ویدیوی خودت است؛ فایل را بالای ویدیو در تدوین می‌گذاری (راهنمایش هم ساخته می‌شود).'
    : motion
      ? 'خروجی یک فایل MP4 کامل است، با پس‌زمینه و صدای خودش.'
      : 'خروجی یک فیلم زیرنویسی است: متن گفتار، کارت‌به‌کارت.';
  $('#bgNote').hidden = !overlay;
  $('#backgrounds').classList.toggle('dim', overlay);
  if (S.step === 3) renderBackgrounds();
}

function renderQualities() {
  const sel = $('#quality');
  sel.innerHTML = '';
  for (const q of S.manifest.qualities) {
    const o = document.createElement('option');
    o.value = q.id;
    o.textContent = q.fa;
    if (q.id === S.output.quality) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => (S.output.quality = sel.value);
}

/** The previews are the real stage markup, scaled down with a transform. */
async function renderBackgrounds(refetch = false) {
  const box = $('#backgrounds');
  if (refetch || !box.dataset.html) {
    const cards = await api(`/api/backgrounds?ratio=${encodeURIComponent(S.output.ratio)}`);
    box.dataset.html = JSON.stringify(cards);
  }
  const cards = JSON.parse(box.dataset.html || '[]');
  box.innerHTML = '';
  const hasVideo = Boolean(S.source.video);
  for (const c of cards) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card' + (c.id === S.output.background ? ' on' : '');
    const scale = 210 / c.w;
    const scopedCss = c.css.replaceAll('st-', `b${c.id.replace(/[^a-z]/g, '')}-`);
    const scopedHtml = c.html.replaceAll('st-', `b${c.id.replace(/[^a-z]/g, '')}-`);
    b.innerHTML = `<div class="thumb" style="height:${Math.round(c.h * scale)}px">
        <div style="width:${c.w}px;height:${c.h}px;transform:scale(${scale});transform-origin:top right;position:absolute;inset:0">${scopedHtml}</div>
      </div>
      <style>${scopedCss}</style>
      <div class="t">${c.fa}</div>
      <div class="s">${c.hint}</div>`;
    if (c.needs === 'video' && !hasVideo) {
      b.disabled = true;
      b.title = 'براین گزینه یک فایل ویدیویی لازم است';
    } else {
      b.onclick = () => {
        S.output.background = c.id;
        $$('#backgrounds .card').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
    }
    box.appendChild(b);
  }
}

function renderEngines() {
  const box = $('#engines');
  box.innerHTML = '';
  for (const e of S.manifest.engines) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card' + (e.id === S.engine.mode ? ' on' : '');
    b.innerHTML = `<div class="t">${e.fa}</div><div class="s">${e.note}</div>`;
    b.onclick = () => {
      S.engine.mode = e.id;
      $$('#engines .card').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $('#providerBox').hidden = e.id !== 'provider';
      launchHint();
    };
    box.appendChild(b);
  }
  $('#providerBox').hidden = S.engine.mode !== 'provider';
  launchHint();
}

function renderProviderSelect() {
  const sel = $('#provider');
  sel.innerHTML = '';
  for (const p of S.manifest.presets.filter((x) => !['agent', 'studio'].includes(x.id))) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.fa;
    if (p.id === S.engine.provider) o.selected = true;
    sel.appendChild(o);
  }
  S.engine.provider = sel.value;
  $('#baseRow').hidden = sel.value !== 'custom';
  const preset = S.manifest.presets.find((p) => p.id === sel.value);
  setNote(preset?.note || '');
}

function setNote(t) {
  $('#providerNote').textContent = t;
}

function providerConfigFromUI() {
  return {
    providers: {
      [S.engine.provider]: {
        apiKey: $('#apiKey').value || undefined,
        model: $('#model').value || undefined,
        base: $('#baseUrl').value || undefined,
      },
    },
  };
}

async function saveProviderConfig() {
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify(providerConfigFromUI()) });
    setNote('ذخیره شد.');
  } catch (e) {
    setNote(`ذخیره نشد: ${e.message}`);
  }
}

async function loadModels() {
  setNote('در حال خواندن مدل‌ها…');
  const r = await api(`/api/providers/models?provider=${S.engine.provider}`);
  const sel = $('#model');
  sel.innerHTML = '';
  for (const m of r.models) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name || m.id;
    sel.appendChild(o);
  }
  if (!r.models.length) sel.innerHTML = '<option value="">— مدلی برگشت نشد —</option>';
  setNote(`${fa(r.models.length)} مدل از ${S.engine.provider}.`);
}

async function refreshMachine() {
  try {
    const pf = await api('/api/preflight?cpu=50');
    const level = (v, warn, bad) => (v < bad ? 'bad' : v < warn ? 'warn' : '');
    const stat = (label, value, cls) =>
      `<span class="stat ${cls}"><i aria-hidden="true"></i>${label} <b>${value}</b></span>`;
    $('#machine').innerHTML = [
      stat('رشته‌ها', `${fa(pf.power.threads)} از ${fa(pf.cores)}`, ''),
      stat('رم آزاد', `${fa(pf.ramAvailableGb)}G`, level(pf.ramAvailableGb, 2, 1)),
      stat('دیسک آزاد', `${fa(pf.diskFreeGb)}G`, level(pf.diskFreeGb, 6, 2)),
      stat('بار', fa(pf.load[0]), pf.load[0] > pf.cores ? 'warn' : ''),
    ].join('');
  } catch {
    $('#machine').textContent = 'وضعیت دستگاه خوانده نشد';
  }
}

async function refreshCpu() {
  const pf = await api(`/api/preflight?cpu=${S.cpu}`);
  $('#cpuRead').innerHTML = `<b>${fa(S.cpu)}٪</b> · ${fa(pf.threads)} رشته · ${fa(pf.workers)} ورکر رندر`;
  const warns = $('#warns');
  warns.innerHTML = '';
  for (const w of pf.warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    warns.appendChild(li);
  }
  if (pf.busy) $('#launchHint').textContent = 'یک کار دیگر در حال اجرا است؛ این کار در صف می‌ماند.';
}

function launchHint() {
  const t = {
    agent: 'کار در صف می‌ماند؛ یک عامل هوشمند روی همین دستگاه (Claude Code یا هر CLI) HANDOFF.md را برمی‌دارد و می‌سازد.',
    studio: 'خط لولهٔ قطعی استودیو: زیرنویس، پس‌زمینه و رندر روی همین دستگاه.',
    provider: 'مدل فقط جهت ادیت را می‌چیند؛ رندر همچنان محلی است.',
  };
  $('#launchHint').textContent = t[S.engine.mode] || '';
}

/* ---------------------------------------------------------------- source */

function slotEl(kind) {
  return $(`.slot[data-slot="${kind}"]`).parentElement;
}

function paintSlot(kind, info) {
  const art = slotEl(kind);
  const drop = $('.drop', art);
  if (!info) {
    art.classList.remove('filled');
    drop.innerHTML = 'یا فایل را اینجا رها کن';
    return;
  }
  art.classList.add('filled');
  const meta = [
    info.duration ? `${fa(Math.round(info.duration))} ثانیه` : null,
    info.width ? `${fa(info.width)}×${fa(info.height)}` : null,
    info.bytes ? mb(info.bytes) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  drop.innerHTML = `${esc(info.name)}<span class="meta">${meta || 'آماده'} — برای تغییر، فایل دیگری رها کن</span>`;
  renderBackgrounds(true);
}

function setSource(kind, info) {
  S.source[kind] = info;
  paintSlot(kind, info);
  if (kind === 'reference') analyzeStyle(info);
}

/** The reference is measured, not copied: the numbers drive the beat engine. */
async function analyzeStyle(info) {
  const read = $('#styleRead');
  S.style = null;
  read.hidden = false;
  read.innerHTML = '<span class="pill wait"><i class="spin"></i>در حال یادگیری سبک…</span>';
  try {
    const style = await api('/api/reference/analyze', { method: 'POST', body: JSON.stringify({ path: info.path }) });
    S.style = style;
    paintStyle(style);
    const pal = style?.picture?.palette;
    const learned = style?.derived?.paletteMode === 'match' && pal?.accent;
    const note = $('#brandPaletteNote');
    if (note)
      note.value = learned
        ? `از رفرنس یاد گرفته شد: اکسنت ${pal.accent} · متن ${pal.ink}`
        : 'رفرنس پالت گرافیکی نداشت — رنگ خانه می‌ماند';
    if (learned) flash('پالت رفرنس یاد گرفته شد و در مرحلهٔ برند اعمال می‌شود.');
    if (S.motion.density === 'auto') flash('سبک از رفرنس خوانده شد؛ چگالی «از رفرنس» همین را دنبال می‌کند.');
  } catch (e) {
    read.innerHTML = `<span class="pill bad">سبک خوانده نشد: ${esc(e.message)}</span>`;
  }
}

function paintStyle(style) {
  const d = style.derived || {};
  const densityFa = (S.manifest?.densities || []).find((x) => x.id === d.density)?.fa || d.density;
  const energy = Math.round((d.energy ?? 0) * 100);
  const frames = (style.frames || [])
    .map((f) => `<img class="st-frame" src="${f}" alt="" />`)
    .join('');
  /* rhythm strip: the learned cadence drawn as ticks across one stretch */
  const beatLen = d.beatLen || 2;
  const ticks = Array.from({ length: 14 }, (_, i) => `<i style="opacity:${i % 4 === 0 ? 0.9 : 0.4}"></i>`).join('');
  $('#styleRead').innerHTML = `
    ${frames ? `<div class="st-frames">${frames}<span class="st-frames-cap">فریم‌های نمونه از رفرنس</span></div>` : ''}
    <div class="st-gauges">
      <div class="st-gauge">
        <span class="st-glabel">انرژی</span>
        <span class="st-gbar"><i style="width:${energy}%"></i></span>
        <span class="st-gval">${fa(energy)}٪</span>
      </div>
      <div class="st-gauge">
        <span class="st-glabel">ریتم</span>
        <span class="st-strip">${ticks}</span>
        <span class="st-gval">${d.beatLen ? `هر ${fa(Math.round(beatLen * 10) / 10)} ثانیه` : '—'}</span>
      </div>
    </div>
    <div class="st-chips">
      <span class="pill">چگالی پیشنهادی: ${esc(densityFa)}</span>
      ${d.look ? `<span class="pill">${esc(d.look)}</span>` : ''}
      ${style.meta ? `<span class="pill">${esc(style.meta.ratio || '')} · ${fa(Math.round(style.meta.duration || 0))} ثانیه</span>` : ''}
    </div>
    ${
      d.density && d.density !== S.motion.density
        ? `<button type="button" class="ghost st-apply" id="applyDensity">اعمال چگالی «${esc(densityFa)}» روی کار</button>`
        : ''
    }
    ${style.notes?.length ? `<p class="tiny">یادداشت: ${esc(style.notes.join('، '))}</p>` : ''}`;
  const apply = document.getElementById('applyDensity');
  if (apply)
    apply.onclick = () => {
      S.motion.density = d.density;
      flash(`چگالی روی «${densityFa}» قفل شد — از رفرنس آموخته شد.`);
      paintStyle(S.style);
    };
}

function wireSources() {
  for (const kind of ['video', 'audio', 'srt', 'reference']) {
    const art = slotEl(kind);
    $('.pick', art).onclick = () => openBrowser(kind);
    const drop = $('.drop', art);
    drop.onclick = () => openBrowser(kind);
    drop.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openBrowser(kind);
      }
    };
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add('hot');
    };
    drop.ondragleave = () => drop.classList.remove('hot');
    drop.ondrop = async (e) => {
      e.preventDefault();
      drop.classList.remove('hot');
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      drop.textContent = 'در حال انتقال…';
      try {
        const r = await uploadFile(f);
        setSource(kind, r);
      } catch (err) {
        flash(`ارسال فایل نشد: ${err.message}`);
        paintSlot(kind, null);
      }
    };
  }
}

function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ENGINE.url(`/api/upload?name=${encodeURIComponent(file.name)}`));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    for (const [k, v] of Object.entries(ENGINE.headers('POST'))) xhr.setRequestHeader(k, v);
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        reject(new Error('پاسخ سرور خوانده نشد'));
      }
    };
    xhr.onerror = () => reject(new Error('ارسال قطع شد'));
    xhr.send(file);
  });
}

/* --------------------------------------------------------------- browser */

let browserKind = 'video';
async function openBrowser(kind) {
  browserKind = kind;
  $('#browser').hidden = false;
  await browse('');
}
$('#br-close').onclick = () => ($('#browser').hidden = true);

async function browse(dir) {
  const r = await api(`/api/fs?dir=${encodeURIComponent(dir)}`);
  $('#br-crumbs').textContent = r.dir;
  const quick = $('#br-quick');
  quick.innerHTML = '';
  for (const q of r.quick) {
    const b = document.createElement('button');
    b.className = 'ghost tiny';
    b.type = 'button';
    b.textContent = q.replace(/^\/Users\/[^/]+/, '~');
    b.onclick = () => browse(q);
    quick.appendChild(b);
  }
  const list = $('#br-list');
  list.innerHTML = '';
  if (r.parent) {
    const li = document.createElement('li');
    li.innerHTML =
      '<span class="entry"><span class="dir-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H6m5-6-6 6 6 6"/></svg></span> پوشهٔ بالاتر</span>';
    li.onclick = () => browse(r.parent);
    list.appendChild(li);
  }
  for (const e of r.entries) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="entry">${e.kind === 'dir' ? FOLDER_ICO : ''}${esc(e.name)}</span><span class="size">${e.size ? mb(e.size) : ''}</span>`;
    li.onclick = () => {
      if (e.kind === 'dir') return browse(e.path);
      const info = { ...e, path: e.path };
      api(`/api/probe?path=${encodeURIComponent(e.path)}`)
        .then((p) => setSource(browserKind, { ...info, name: e.name, ...p }))
        .catch(() => setSource(browserKind, { ...info, name: e.name }));
      $('#browser').hidden = true;
    };
    list.appendChild(li);
  }
  if (!r.entries.length) list.innerHTML = '<li>چیز دیگری اینجا نیست</li>';
}

/* ----------------------------------------------------------------- start */

function jobConfig() {
  const title = {
    kicker: $('#t-kicker').value.trim(),
    headline: $('#t-headline').value.trim(),
    accentWord: $('#t-accent').value.trim(),
    sub: $('#t-sub').value.trim(),
  };
  const endcard = { name: $('#e-name').value.trim(), site: $('#e-site').value.trim() };
  const motion = S.motion.mode === 'motion';
  const accent = $('#brandAccent')?.value || '';
  return {
    name: ($('#direction').value.trim().slice(0, 40) || `${S.output.ratio} ویدیو`).replace(/\s+/g, '-'),
    topic: $('#topic')?.value.trim() || '',
    template: S.template || null,
    source: {
      video: S.source.video?.path || null,
      audio: S.source.audio?.path || null,
      srt: S.source.srt?.path || null,
      reference: S.source.reference?.path || null,
    },
    output: { ...S.output, format: motion && S.motion.deliver === 'overlay' ? 'webm' : S.output.format },
    background: S.output.background,
    motion: { ...S.motion, ...(S.style ? { styleFrom: S.source.reference?.name } : {}) },
    sound: { ...S.sound },
    brand: motion
      ? {
          preset: S.brand.preset || 'house',
          ...(accent && accent.toLowerCase() !== '#55e6a5' ? { palette: { accent } } : {}),
        }
      : undefined,
    direction: { text: $('#direction').value.trim(), title, endcard },
    title,
    endcard,
    engine: { ...S.engine },
    cpu: { pct: S.cpu },
  };
}

async function start() {
  if (!validate(1)) return goto(1);
  $('#build').disabled = true;
  try {
    const job = await api('/api/jobs', { method: 'POST', body: JSON.stringify(jobConfig()) });
    S.job = job;
    const r = await api(`/api/jobs/${job.id}/start`, { method: 'POST' });
    openBuild({ ...job, ...r });
  } catch (e) {
    flash(`ساخت شروع نشد: ${e.message}`);
  } finally {
    $('#build').disabled = false;
  }
}

/* ------------------------------------------------------------- build view */

function openBuild(job) {
  $('#wizard').hidden = true;
  $('#jobs-view').hidden = true;
  $('#build-view').hidden = false;
  localStorage.setItem('studio.lastJob', job.id);
  S.job = job;
  $('#bv-title').textContent = job.name;
  setStatus(job.status || 'queued');
  $('#bv-log').innerHTML = '';
  showStills(job.stills);
  $('#bv-pct').textContent = '۰٪';
  $('#bv-fill').style.width = '0%';
  $('#bv-player').hidden = true;
  $('#bv-motion').hidden = true;
  $('#bv-queue').hidden = job.engine !== 'agent';
  if (job.queued || job.engine === 'agent') {
    $('#bv-queue').innerHTML = `
      <b>در صف عامل</b> — فایل راهنما: <code>${esc(job.handoffPath || '')}</code>
      ${job.wake ? `<code>${esc(job.wake)}</code>` : ''}
      <p class="queue-note">در گفت‌وگوی عامل خودت (Claude Code یا هر CLI که این پوشه را باز کرده) بگو «صف استودیو را بگیر»؛ لاگ و درصد پیشرفت از همین‌جا زنده است.</p>`;
    $('#copyWake').hidden = false;
    $('#copyWake').onclick = () => navigator.clipboard.writeText('صف استودیو را بگیر و شغل ' + job.id + ' را انجام بده');
  } else {
    $('#copyWake').hidden = true;
  }
  listen(job.id);
}

function setStatus(s) {
  const el = $('#bv-status');
  el.className = 'status ' + s;
  el.textContent = {
    queued: 'در صف عامل',
    running: 'در حال ساخت',
    succeeded: 'آماده',
    failed: 'خراب شد',
    cancelled: 'لغو شد',
    draft: 'پیش‌نویس',
  }[s] || s;
}

function listen(id) {
  S.es?.close();
  const es = new EventSource(ENGINE.url(`/api/jobs/${id}/events`));
  S.es = es;
  es.addEventListener('progress', (e) => paintProgress(JSON.parse(e.data)));
  es.addEventListener('log', (e) => appendLog(JSON.parse(e.data).chunk));
  es.addEventListener('state', (e) => {
    const d = JSON.parse(e.data);
    setStatus(d.status);
    if (d.status === 'succeeded') showResult(d.output);
    if (d.error) appendLog(`خطا: ${d.error}\n`);
    es.close();
  });
  es.onerror = () => {
    $('#launchHint').textContent = 'اتصال لاگ قطع شد.';
  };
}

function paintProgress(p) {
  $('#bv-fill').style.width = `${p.pct}%`;
  $('#bv-pct').textContent = `${fa(p.pct)}٪`;
  $('#bv-stage').textContent = p.label || '';
  const list = $('#bv-steps');
  list.innerHTML = '';
  for (const s of p.steps || []) {
    const li = document.createElement('li');
    li.className = s.state;
    li.textContent = s.label + (s.state === 'active' ? ` (${fa(s.pct)}٪)` : '');
    list.appendChild(li);
  }
}

function appendLog(chunk) {
  const box = $('#bv-log');
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    const m = /^(\S+) \[(\w+)\] ([\s\S]*)$/.exec(line);
    const row = document.createElement('div');
    row.className = 'line' + (m && ['run', 'out'].includes(m[2]) ? ' run' : '');
    if (m) {
      const t = m[1].slice(11, 19);
      row.innerHTML = `<span class="ts">${t}</span><span class="lv ${m[2]}">${m[2]}</span><span class="msg"></span>`;
      row.lastElementChild.textContent = m[3];
    } else {
      row.innerHTML = '<span class="msg"></span>';
      row.firstElementChild.textContent = line;
    }
    box.appendChild(row);
  }
  box.scrollTop = box.scrollHeight;
}

function showStills(names) {
  const box = $('#bv-stills');
  box.innerHTML = '';
  for (const n of names || []) {
    if (!/\.(png|jpe?g)$/i.test(n)) continue;
    const img = document.createElement('img');
    img.src = ENGINE.url(`/api/jobs/${S.job.id}/still?name=${encodeURIComponent(n)}`);
    img.alt = n;
    img.loading = 'lazy';
    box.appendChild(img);
  }
}

function showResult(o) {
  if (!o) return;
  api(`/api/jobs/${S.job.id}/stills`).then(showStills).catch(() => {});
  const v = $('#bv-video');
  v.src = ENGINE.url(`/api/jobs/${S.job.id}/media`);
  $('#bv-download').href = ENGINE.url(`/api/jobs/${S.job.id}/download`);
  $('#bv-download').textContent = o.engine === 'motion' && o.deliver === 'overlay' ? 'دانلود لایه (WebM شفاف)' : 'دانلود فایل';
  $('#bv-player').hidden = false;
  $('#bv-queue').hidden = true;
  $('#bv-meta').innerHTML = `
    <span class="${o.withinBudget ? '' : 'bad'}">${fa(o.mb)} مگابایت ${o.withinBudget ? '· زیر سقف' : '· بیش از سقف'}</span>
    <span>${fa(o.width)}×${fa(o.height)}</span>
    <span class="${o.is30fps ? '' : 'warn'}">${fa(o.fps)} فریم${o.is30fps ? '' : ' · بی‌قانون'}</span>
    <span>${fa(o.duration)} ثانیه</span>
    <span>${esc(o.videoCodec || '')} ${o.hasAlpha ? '+ آلفا' : o.audioCodec ? '/ ' + esc(o.audioCodec) : '/ بی‌صدا'}</span>
    ${o.beats ? `<span>${fa(o.beats)} بیت · ${esc(o.density || '')}</span>` : ''}
    ${o.sound ? `<span class="${o.sound.buried ? 'warn' : ''}">${fa(o.sound.cues)} صدای افکت${o.sound.buried ? ` · ${fa(o.sound.buried)} پنهان` : ''}</span>` : '<span>بی‌صدای افکت</span>'}`;
  showMotionOut(o);
}

/** A transparent layer only means something seen on the user's own footage. */
async function showMotionOut(o) {
  const box = $('#bv-motion');
  box.hidden = o.engine !== 'motion' || o.deliver !== 'overlay';
  if (box.hidden) return;
  const detail = await api(`/api/jobs/${S.job.id}`).catch(() => ({}));
  if (detail.preview) {
    $('#bv-preview').src = ENGINE.url(`/api/jobs/${S.job.id}/preview?name=${encodeURIComponent(detail.preview)}`);
    $('#bv-previewNote').textContent = 'این پیش‌نمایش است، نه فایل تحویلی: لایه روی ویدیوی خودت نشسته تا قضاوت کنی.';
  } else {
    $('#bv-preview').remove();
    $('#bv-previewNote').textContent = 'ویدیوی اصلی نداشتیم؛ لایه را در تدوین بالای تصویر خودت بگذار.';
  }
  const links = [
    ['dropIn', 'dropin', 'راهنمای گذاشتن روی ویدیو', 'DROP-IN.md'],
    ['beats', 'beats', 'ورقهٔ بیت (JSON)', 'beats.json'],
    ['style', 'style', 'پروفایل سبک از رفرنس', 'style.json'],
    ['sound', 'sound', 'طراحی صدا و اندازه‌گیری آن', 'sound.json'],
    ['sfx', 'sfx', 'فایل صدای افکت', 'sfx.wav'],
  ];
  const have = detail.artifacts || [];
  const items = links
    .filter(([k]) => have.includes(k))
    .map(([, route, label, name]) => {
      const href = ENGINE.url(`/api/jobs/${S.job.id}/${route}`);
      return `<a class="art" href="${href}" download="${name}" target="_blank" rel="noopener">${label}</a>`;
    })
    .join('');
  $('#bv-artifacts').innerHTML = items || '<span class="tiny">فایل کمکی‌ای ساخته نشد.</span>';
}

/* ---------------------------------------------------------------- jobs */

const STATUS_FA = {
  draft: 'پیش‌نویس',
  queued: 'در صف عامل',
  running: 'در حال ساخت',
  succeeded: 'آماده',
  failed: 'خطا',
  cancelled: 'لغو شده',
};

async function renderJobs() {
  const rows = await api('/api/jobs');
  const list = $('#jobs-list');
  if (!rows.length) {
    list.innerHTML = '<li class="empty">هنوز کاری ثبت نشده است.</li>';
    return;
  }
  list.innerHTML = '';
  for (const j of rows) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="j-name"></span><span class="j-meta">${esc(j.ratio)} · ${esc(j.background)} · ${esc(j.sourceKind)}</span>
      <span class="status ${esc(j.status)}">${esc(STATUS_FA[j.status] || j.status)}</span><span class="j-pct">${fa(j.progress?.pct ?? 0)}٪</span>`;
    li.querySelector('.j-name').textContent = j.name || j.id;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.onclick = () => openJob(j.id).catch((e) => flash(e.message));
    li.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openJob(j.id).catch((err) => flash(err.message));
      }
    };
    list.appendChild(li);
  }
}

async function openJob(id) {
  openBuild(await api(`/api/jobs/${id}`));
}

function wireJobs() {
  $('#jobsBtn').onclick = () => {
    $('#wizard').hidden = true;
    $('#build-view').hidden = true;
    $('#jobs-view').hidden = false;
    renderJobs().catch((e) => flash(e.message));
  };
  $('#jobsBack').onclick = () => {
    $('#jobs-view').hidden = true;
    $('#wizard').hidden = false;
  };
  $('#jobsRefresh').onclick = () => renderJobs().catch((e) => flash(e.message));
}

/* ------------------------------------------------------------------ run */

wireSources();
wireJobs();
boot().catch((e) => {
  document.body.innerHTML = `<p style="padding:40px">استودیو بالا نیامد: ${esc(e.message)}</p>`;
});

// The hosted banner has a retry; when it finds an engine, the panel boots for real.
window.addEventListener('studio:engine-up', () => {
  boot().catch((e) => flash(e.message));
});
