/* app-ed.js — the simple editor's client: timeline, cuts, overlays and
 * auto-subtitles over a plain EDL that the engine renders with ffmpeg.
 * The preview is the source of truth for positions; the render mirrors it. */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const api = async (path, opts = {}) => {
    const r = await fetch(ENGINE.url(path), {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.body ? ENGINE.headers("POST") : {}), ...(opts.headers || {}) },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || r.statusText);
    return body;
  };
  const uploadFile = (file) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", ENGINE.url(`/api/upload?name=${encodeURIComponent(file.name)}`));
      if (ENGINE.hosted) xhr.setRequestHeader("x-video-studio", "1");
      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("upload failed")); }
      };
      xhr.onerror = () => reject(new Error("ارسال قطع شد"));
      xhr.send(file);
    });

  const S = {
    base: { path: null, meta: null, strip: [], peaks: [], segments: [], sel: -1 },
    overlays: [],
    subs: {
      segments: [],
      style: { font: "Vazirmatn", size: 0.055, weight: "700", color: "#ffffff", outline: true },
      position: { place: "bottom", margin: 0.08 },
    },
    t: 0,
    playing: false,
    nextOv: 1,
  };

  const duration = () => S.base.meta?.duration || 0;
  const status = (msg, bad = false) => { const el = $("#edStatus"); el.textContent = msg || ""; el.className = "ed-status" + (bad ? " bad" : ""); };
  const segEnd = (s) => s.end;
  const totalEdit = () => S.base.segments.reduce((n, s) => n + (s.end - s.start), 0);

  /* ---- timeline ⇄ source time mapping (the edit is the concat of segments) */
  function timelineToSource(t) {
    let acc = 0;
    for (const s of S.base.segments) {
      const d = s.end - s.start;
      if (t <= acc + d) return { start: s.start + (t - acc), seg: s };
      acc += d;
    }
    const last = S.base.segments[S.base.segments.length - 1];
    return { start: last ? last.end : 0, seg: last };
  }
  function sourceToTimeline(srcT) {
    let acc = 0;
    for (const s of S.base.segments) {
      if (srcT >= s.start && srcT <= s.end) return acc + (srcT - s.start);
      acc += s.end - s.start;
    }
    return acc;
  }

  /* ------------------------------------------------------------ preview */
  const pvBase = $("#pvBase");
  const pvSub = $("#pvSub");

  function renderOverlayDom() {
    const host = $("#pvOverlays");
    host.innerHTML = "";
    S.overlays.forEach((o) => {
      const v = document.createElement("video");
      v.className = "ov";
      v.src = "/api/editor/media?file=" + encodeURIComponent(o.mediaRel);
      v.playsinline = true;
      v.muted = true;
      v.dataset.id = o.id;
      host.appendChild(v);
    });
  }

  function paintPreview() {
    const { start } = timelineToSource(S.t);
    if (Math.abs(pvBase.currentTime - start) > 0.08) { try { pvBase.currentTime = start; } catch {} }
    const W = $("#stage").clientWidth || 1;
    const H = $("#stage").clientHeight || 1;
    const mw = S.base.meta?.width || 16;
    const mh = S.base.meta?.height || 9;
    /* the stage letterboxes the video (object-fit: contain) — mirror that */
    const fit = Math.min(W / mw, H / mh);
    const vw = mw * fit, vh = mh * fit, vx = (W - vw) / 2, vy = (H - vh) / 2;
    S.overlays.forEach((o) => {
      const v = $(`#pvOverlays video[data-id="${o.id}"]`);
      if (!v) return;
      const active = S.t >= o.start && S.t < o.start + o.duration;
      v.classList.toggle("on", active);
      if (active) {
        const want = (S.t - o.start) + (o.srcStart || 0);
        if (Math.abs(v.currentTime - want) > 0.15) { try { v.currentTime = want; } catch {} }
      }
      const ow = vw * (o.scale ?? 0.35);
      const oh = (ow / (o.meta?.width || 16)) * (o.meta?.height || 9);
      v.style.width = ow + "px";
      v.style.height = oh + "px";
      v.style.left = vx + (vw - ow) * (o.x ?? 0.5) + "px";
      v.style.top = vy + (vh - oh) * (o.y ?? 0.75) + "px";
      v.style.opacity = o.opacity ?? 1;
    });
    /* subtitles */
    const st = S.subs;
    const seg = st.segments.find((s) => S.t >= s.start && S.t <= s.end);
    const stageH = $("#stage").clientHeight || 1;
    const size = Math.round(st.style.size * stageH);
    pvSub.style.fontFamily = st.style.font === "JetBrains Mono" ? "ui-monospace, Menlo, monospace" : "Vazirmatn, sans-serif";
    pvSub.style.fontWeight = st.style.weight;
    pvSub.style.fontSize = size + "px";
    pvSub.style.color = st.style.color;
    pvSub.style.textShadow = st.style.outline ? "0 2px 6px rgba(0,0,0,.9), 0 0 3px rgba(0,0,0,.9)" : "none";
    const margin = st.position.margin * H;
    pvSub.style.bottom = st.position.place === "bottom" ? margin + "px" : "auto";
    pvSub.style.top = st.position.place === "top" ? margin + "px" : st.position.place === "middle" ? "50%" : "auto";
    if (st.position.place === "middle") pvSub.style.transform = "translateY(-50%)";
    else pvSub.style.transform = "none";
    pvSub.textContent = seg ? seg.text : "";
    /* head + time */
    const pct = duration() ? (S.t / duration()) * 100 : 0;
    $("#tlHead").style.insetInlineStart = `calc(${pct}% - 1px)`;
    $("#tlCur").textContent = S.t.toFixed(2);
  }

  function tick() {
    if (S.playing && !pvBase.paused) {
      const { start, seg } = timelineToSource(S.t);
      const segDur = seg ? seg.end - seg.start : 0;
      const within = pvBase.currentTime - start;
      if (within >= segDur - 0.03) {
        /* hop to the next segment's source start */
        const idx = S.base.segments.indexOf(seg);
        const next = S.base.segments[idx + 1];
        if (next) S.t = sourceToTimeline(next.start);
        else { S.playing = false; pvBase.pause(); }
      } else S.t = Math.min(duration(), S.t + (pvBase.currentTime - start < 0 ? 0 : 0));
    }
    if (S.playing && !pvBase.paused) {
      /* advance by real playback delta */
    }
    paintPreview();
    requestAnimationFrame(tick);
  }

  $("#btnPlay").onclick = () => {
    if (S.playing) { S.playing = false; pvBase.pause(); S.overlays.forEach((o) => { const v = $(`#pvOverlays video[data-id="${o.id}"]`); v && v.pause(); }); return; }
    S.playing = true;
    const { start } = timelineToSource(S.t);
    try { pvBase.currentTime = start; } catch {}
    pvBase.play().catch(() => {});
    S.overlays.forEach((o) => {
      const v = $(`#pvOverlays video[data-id="${o.id}"]`);
      if (!v) return;
      if (S.t >= o.start && S.t < o.start + o.duration) { try { v.currentTime = S.t - o.start; } catch {} v.play().catch(() => {}); }
      else v.pause();
    });
  };
  pvBase.addEventListener("timeupdate", () => {
    if (S.playing && !pvBase.paused) {
      const { start, seg } = timelineToSource(S.t);
      const segDur = seg ? seg.end - seg.start : 0;
      const within = pvBase.currentTime - start;
      if (within >= segDur - 0.05) {
        const idx = S.base.segments.indexOf(seg);
        const next = S.base.segments[idx + 1];
        if (next) { S.t = sourceToTimeline(next.start); try { pvBase.currentTime = next.start; } catch {} }
        else { S.playing = false; pvBase.pause(); }
      } else {
        S.t = Math.max(0, sourceToTimeline(pvBase.currentTime));
      }
    }
    paintPreview();
  });
  requestAnimationFrame(function loop() { paintPreview(); requestAnimationFrame(loop); });

  /* ---------------------------------------------------------- timeline */
  function paintTimeline() {
    const lane = $("#laneBase");
    const D = duration() || 1;
    /* strip */
    const strip = $("#tlStrip");
    strip.innerHTML = (S.base.strip || []).map((f) => `<img src="/api/editor/media?file=${encodeURIComponent(f)}" alt="" />`).join("");
    /* waveform */
    const cv = $("#tlWave");
    cv.width = lane.clientWidth * devicePixelRatio;
    cv.height = lane.clientHeight * devicePixelRatio;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = "rgba(85,230,165,0.35)";
    const peaks = S.base.peaks || [];
    const bw = cv.width / peaks.length;
    peaks.forEach((p, i) => {
      const h = Math.max(1, p * cv.height * 0.9);
      g.fillRect(i * bw, (cv.height - h) / 2, Math.max(1, bw - 0.5), h);
    });
    /* segments */
    const host = $("#tlSegs");
    host.innerHTML = "";
    let acc = 0;
    S.base.segments.forEach((s, i) => {
      const d = s.end - s.start;
      const seg = document.createElement("div");
      seg.className = "tl-seg" + (i === S.base.sel ? " sel" : "");
      seg.style.insetInlineStart = `calc(${(acc / D) * 100}% + 1px)`;
      seg.style.width = `calc(${(d / D) * 100}% - 2px)`;
      seg.innerHTML = `<span class="h in"></span><span class="h out"></span>`;
      seg.onclick = (e) => { if (e.target.classList.contains("h")) return; S.base.sel = i; paintTimeline(); paintInspector(); };
      seg.querySelector(".h.in").onpointerdown = (e) => dragTrim(e, i, "in");
      seg.querySelector(".h.out").onpointerdown = (e) => dragTrim(e, i, "out");
      host.appendChild(seg);
      acc += d;
    });
    /* overlays */
    const ovHost = $("#tlOvSegs");
    ovHost.innerHTML = "";
    S.overlays.forEach((o) => {
      const seg = document.createElement("div");
      seg.className = "tl-seg ov-seg";
      seg.style.insetInlineStart = `calc(${((o.start || 0) / D) * 100}% + 1px)`;
      seg.style.width = `calc(${((o.duration || 0) / D) * 100}% - 2px)`;
      seg.title = "اورلی — بکش تا جابه‌جا شود؛ لبه‌ها: مدت";
      seg.onpointerdown = (e) => dragOverlay(e, o);
      ovHost.appendChild(seg);
    });
    paintPreview();
  }

  const laneTime = (e) => {
    const lane = $("#laneBase");
    const r = lane.getBoundingClientRect();
    const rtl = getComputedStyle(lane).direction === "rtl";
    const x = rtl ? r.right - e.clientX : e.clientX - r.left;
    return Math.max(0, Math.min(1, x / r.width)) * duration();
  };
  $("#laneBase").addEventListener("pointerdown", (e) => {
    if (e.target.closest(".tl-seg")) return;
    S.t = laneTime(e);
    paintPreview();
  });

  function dragTrim(e, i, which) {
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const t = laneTime(ev);
      const s = S.base.segments[i];
      const MIN = 0.15;
      if (which === "in") s.start = Math.max(0, Math.min(s.end - MIN, t));
      else s.end = Math.min(duration(), Math.max(s.start + MIN, t));
      S.base.sel = i;
      paintTimeline(); paintInspector();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function dragOverlay(e, o) {
    e.preventDefault();
    const D = duration() || 1;
    const lane = $("#laneOv").getBoundingClientRect();
    const startX = e.clientX;
    const startT = o.start || 0;
    const startD = o.duration || 1;
    const onEdge = e.target.classList?.contains("h");
    const move = (ev) => {
      const dx = ((ev.clientX - startX) / lane.width) * D * (getComputedStyle(lane).direction === "rtl" ? -1 : 1);
      if (onEdge) o.duration = Math.max(0.2, startD + dx);
      else o.start = Math.max(0, Math.min(D - (o.duration || 1), startT + dx));
      paintTimeline(); paintInspector();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ---------------------------------------------------------- base media */
  $("#btnPickBase").onclick = () => $("#fileBase").click();
  $("#fileBase").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    status("در حال بارگذاری ویدیوی پایه…");
    try {
      const up = await uploadFile(f);
      status("در حال خواندن تایملاین (فریم‌ها و موج صدا)…");
      const info = await api("/api/editor/probe", { method: "POST", body: JSON.stringify({ path: up.path }) });
      S.base = {
        path: up.path,
        meta: info,
        strip: info.strip,
        peaks: info.peaks,
        segments: [{ start: 0, end: info.duration }],
        sel: 0,
      };
      pvBase.src = "/api/editor/media?file=" + encodeURIComponent(up.path.replace(/^.*(uploads[\\/])/, "uploads/"));
      $("#tlDur").textContent = info.duration.toFixed(2);
      $("#baseMeta").textContent = `${info.width}×${info.height} · ${info.duration} ثانیه · ${info.fps} fps${info.hasAudio ? " · صدا دارد" : " · بی‌صدا"}`;
      paintTimeline();
      status("آماده — با «کات در هد» برش بزن.");
    } catch (err) {
      status(String(err.message), true);
    }
  };

  $("#btnSplit").onclick = () => {
    const i = S.base.sel;
    if (i < 0) return status("اول یک قطعه انتخاب کن.", true);
    const s = S.base.segments[i];
    const { start } = timelineToSource(S.t);
    if (start <= s.start + 0.15 || start >= s.end - 0.15) return status("هدها روی بدنهٔ قطعه نیست.", true);
    S.base.segments.splice(i, 1, { start: s.start, end: start }, { start, end: s.end });
    S.base.sel = i + 1;
    paintTimeline(); paintInspector();
    status("کات شد.");
  };
  $("#btnDelSeg").onclick = () => {
    if (S.base.sel < 0 || S.base.segments.length <= 1) return status("حداقل یک قطعه باید بماند.", true);
    S.base.segments.splice(S.base.sel, 1);
    S.base.sel = Math.max(0, S.base.sel - 1);
    paintTimeline(); paintInspector();
  };

  /* ---------------------------------------------------------- overlays */
  $("#btnAddOv").onclick = () => $("#fileOv").click();
  $("#fileOv").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    status("بارگذاری اورلی…");
    try {
      const up = await uploadFile(f);
      const meta = await api("/api/editor/probe", { method: "POST", body: JSON.stringify({ path: up.path }) });
      const o = {
        id: "ov" + S.nextOv++,
        path: up.path,
        mediaRel: up.path.replace(/^.*(uploads[\\/])/, "uploads/"),
        meta,
        start: S.t,
        duration: Math.min(3, meta.duration || 3),
        x: 0.5, y: 0.75, scale: 0.35, opacity: 1,
      };
      S.overlays.push(o);
      renderOverlayDom();
      paintTimeline();
      status("اورلی اضافه شد — روی نوار دوم بکشش.");
    } catch (err) {
      status(String(err.message), true);
    }
  };

  function paintInspector() {
    const box = $("#inspector");
    const i = S.base.sel;
    const s = S.base.segments[i];
    if (!s) { box.textContent = "قطعه‌ای انتخاب نشده — روی نوار تایملاین کلیک کن."; return; }
    box.innerHTML = `
      <div class="ed-field"><span>قطعهٔ ${i + 1} از ${S.base.segments.length}</span></div>
      <div class="ed-field"><span>شروع (ثانیه)</span><input type="number" step="0.05" id="inStart" value="${s.start.toFixed(2)}" /></div>
      <div class="ed-field"><span>پایان (ثانیه)</span><input type="number" step="0.05" id="inEnd" value="${s.end.toFixed(2)}" /></div>`;
    $("#inStart").onchange = (e) => { s.start = Math.max(0, Math.min(s.end - 0.15, Number(e.target.value) || 0)); paintTimeline(); };
    $("#inEnd").onchange = (e) => { s.end = Math.min(duration(), Math.max(s.start + 0.15, Number(e.target.value) || 0)); paintTimeline(); };
  }

  /* ---------------------------------------------------------- subtitles */
  $("#btnTranscribe").onclick = async () => {
    if (!S.base.path) return status("اول ویدیوی پایه را انتخاب کن.", true);
    const st = $("#asrState");
    st.textContent = "در حال پیاده‌سازی گفتار (whisper) — چند دقیقه طول می‌کشد…";
    $("#btnTranscribe").disabled = true;
    try {
      const r = await api("/api/editor/transcribe", { method: "POST", body: JSON.stringify({ path: S.base.path, language: "fa" }) });
      S.subs.segments = r.segments.map((s) => ({ ...s }));
      paintSubList();
      st.textContent = `${r.segments.length} قطعه در ${Math.round(r.ms / 1000)} ثانیه — متن‌ها را ویرایش کن، رندر همان را می‌سوزاند.`;
    } catch (err) {
      st.textContent = "پیاده‌سازی نشد: " + err.message;
    } finally {
      $("#btnTranscribe").disabled = false;
    }
  };

  function paintSubList() {
    const host = $("#subList");
    host.innerHTML = S.subs.segments
      .map(
        (s, i) => `
      <div class="ed-sub-row">
        <span class="t">${s.start.toFixed(2)}→${s.end.toFixed(2)}</span>
        <textarea data-i="${i}">${esc(s.text)}</textarea>
      </div>`,
      )
      .join("");
    host.querySelectorAll("textarea").forEach((ta) => {
      ta.oninput = () => { S.subs.segments[Number(ta.dataset.i)].text = ta.value; paintPreview(); };
    });
  }

  async function loadFonts() {
    try {
      const r = await api("/api/editor/fonts");
      const sel = $("#subFont");
      sel.innerHTML = r.families.map((f) => `<option value="${esc(f.family)}">${esc(f.family)}${f.source === "store" ? "" : " (system fonts)"}</option>`).join("");
    } catch { /* default stands */ }
  }
  $("#subFont").onchange = (e) => { S.subs.style.font = e.target.value; paintPreview(); };
  $("#subWeight").onchange = (e) => { S.subs.style.weight = e.target.value; paintPreview(); };
  $("#subSize").oninput = (e) => { S.subs.style.size = Number(e.target.value) / 1000; paintPreview(); };
  $("#subPlace").onchange = (e) => { S.subs.position.place = e.target.value; paintPreview(); };
  $("#subMargin").oninput = (e) => { S.subs.position.margin = Number(e.target.value) / 100; paintPreview(); };
  $("#subColor").oninput = (e) => { S.subs.style.color = e.target.value; paintPreview(); };

  /* ------------------------------------------------------------ export */
  $("#btnExport").onclick = async () => {
    if (!S.base.path || !S.base.segments.length) return status("ویدیوی پایه و حداقل یک قطعه لازم است.", true);
    const edl = {
      base: { src: S.base.path, segments: S.base.segments },
      overlays: S.overlays.map((o) => ({ src: o.path, start: o.start, duration: o.duration, x: o.x, y: o.y, scale: o.scale, opacity: o.opacity, srcStart: 0 })),
      subtitles: S.subs.segments.length ? S.subs : null,
      output: { quality: $("#outQuality").value, maxMb: Number($("#outMaxMb").value) || 200 },
    };
    const btn = $("#btnExport");
    btn.disabled = true;
    $("#exResult").classList.add("hidden");
    try {
      const job = await api("/api/editor/render", { method: "POST", body: JSON.stringify({ edl, name: "edit" }) });
      status("رندر شروع شد — پیشرفت زیر دیده می‌شود.");
      const poll = setInterval(async () => {
        const j = await api(`/api/jobs/${job.id}`).catch(() => null);
        if (!j) return;
        $("#exStatus").textContent = `${j.status} — ${j.progress?.pct ?? 0}٪ — ${(j.log || "").slice(-80)}`;
        $("#exStatus").className = "ed-status" + (j.status === "failed" ? " bad" : "");
        if (j.status === "succeeded" || j.status === "failed") {
          clearInterval(poll);
          btn.disabled = false;
          if (j.status === "succeeded") {
            const o = j.output;
            const res = $("#exResult");
            res.classList.remove("hidden");
            res.innerHTML = `آماده: <a href="/api/editor/result?id=${encodeURIComponent(job.id)}" download>دانلود خروجی</a> — ${o.mb} مگابایت، ${o.width}×${o.height}، ${o.duration} ثانیه`;
            status("");
          } else status("رندر شکست خورد: " + (j.error || "?"), true);
        }
      }, 1500);
    } catch (err) {
      status(String(err.message), true);
      btn.disabled = false;
    }
  };

  /* ------------------------------------------------------------ boot */
  loadFonts();
  paintInspector();
  requestAnimationFrame(function loop() { paintPreview(); requestAnimationFrame(loop); });
})();
