<div dir="rtl">

# استودیو ویدیو — Video Studio

[![Desktop builds](https://img.shields.io/github/actions/workflow/status/pedramgholizadeh/ai-agentic-video-studio/desktop.yml?label=%D8%A8%DB%8C%D9%84%D8%AF%20%D8%AF%D8%B3%DA%A9%D8%AA%D8%A7%D9%BE&logo=github&logoColor=white)](https://github.com/pedramgholizadeh/ai-agentic-video-studio/actions/workflows/desktop.yml)
[![Latest release](https://img.shields.io/github/v/release/pedramgholizadeh/ai-agentic-video-studio?include_prereleases&label=%D8%A2%D8%AE%D8%B1%DB%8C%D9%86%20%D9%86%D8%B3%D8%AE%D9%87)](https://github.com/pedramgholizadeh/ai-agentic-video-studio/releases/latest)
[![Pages](https://img.shields.io/github/deployments/pedramgholizadeh/ai-agentic-video-studio/github-pages?label=%D9%84%D9%86%D8%AF%DB%8C%D9%86%DA%AF)](https://pedramgholizadeh.github.io/ai-agentic-video-studio/)
![Zero deps](https://img.shields.io/badge/%D9%88%D8%A7%D8%A8%D8%B3%D8%AA%DA%AF%DB%8C-%D8%B5%D9%81%D8%B1-success)
[![Built by Pedram Gholizadeh](https://img.shields.io/badge/%D8%B3%D8%A7%D8%B2%D9%86%D8%AF%D9%87-Pedram%20Gholizadeh-55e6a5)](https://github.com/pedramgholizadeh)

**دو فایل بده — ویدیوی خودت و یک ویدیوی رفرنس — یک تدوین بگیر.**

یک استودیوی تدوینِ محلی که با هوش مصنوعی کار می‌کند: صدای فیلمت با whisper
پیاده می‌شود، متنش فهمیده می‌شود، سبکِ رفرنس پیکسل‌پرفکت یاد گرفته می‌شود و
خروجی نهایی ۳۰ فریم — با زیرنویس کلمه‌به‌کلمهٔ فارسی (Vazirmatn)، موشن و
صداگذاری — تحویل داده می‌شود. هیچ وابستگی npm در زمان اجرا؛ همه‌چیز روی همین
کامپیوتر.

📄 <a href="https://pedramgholizadeh.github.io/ai-agentic-video-studio/">لندینگ و دانلود</a>
· 💬 <a href="#%D8%A7%D8%B2-%D8%AA%D8%B1%D9%85%DB%8C%D9%86%D8%A7%D9%84--from-the-terminal">پنل وب</a>
· 🇬🇧 <a href="#video-studio--english">English below</a>

## اپلیکیشن دسکتاپ (بتا)

| | |
|---|---|
| ⬇️ **macOS (Apple Silicon)** | [دریافت آخرین dmg](https://github.com/pedramgholizadeh/ai-agentic-video-studio/releases/latest) |
| ⬇️ **Windows x64** | [دریافت آخرین Installer](https://github.com/pedramgholizadeh/ai-agentic-video-studio/releases/latest) |
| 🔄 **آپدیت درون‌برنامه‌ای** | خودکار از GitHub Releases + دکمهٔ «بررسی به‌روزرسانی» در تنظیمات |
| 🧩 **داخل بسته** | Node + npm/npx + ffmpeg/ffprobe + موتور و پنل — چیزی نصب نمی‌کنی |
| 🔑 **تنظیمات خودت** | کلیدهای API (openrouter / z.ai / paasta.cloud)، انتخاب ایجنت، مدل whisper، توان CPU |
| 👤 **ساختهٔ** | پدرام قلی‌زاده — Pedram Gholizadeh |

نکات بتا: امضای دیجیتال ندارد — macOS: اولین اجرا راست‌کلیک → Open؛ Windows:
SmartScreen → More info → Run anyway. اولین رندر، Chrome headless و رانتایم
whisper را یک‌بار دانلود می‌کند و مدل‌ها از خود تنظیمات اپ می‌آیند.

## پایپ‌لاین

```
prepare → transcribe → review → understand → reference → assets → strategy
        → scaffold → preview → (حلقهٔ ادیت چت) → final → verify
```

1. **transcribe** — whisper `large-v3` آفلاین، زبان فارسی؛ دقت قانون این استیج است.
2. **review** — دروازهٔ اول: جدول خط‌به‌خط، هر خط قابل ویرایش، کلیک روی زمان = پرش ویدیو.
3. **understand** — `brief.json`: موضوع/تز/قوس/مخاطب؛ facts فقط از خود گفتار.
4. **reference** — تحلیل پیکسل‌پرفکت رفرنس (ریتم کات، انرژی، پالت، ترنزیشن) و
   **حافظهٔ دائمی** با کلید SHA-1 — دفعهٔ بعد خودش پیشنهادش را می‌دهد.
5. **strategy** — سناریو و بیت‌ها روی ریتم رفرنس؛ متن کارت‌ها فقط واژه‌های گفته‌شده.
6. **preview + چت** — دموی کم‌حجم ۶۴۰px؛ «تراکم بیشتر»، «زیرنویس بالاتر»، «خط ۳: …»
   در چت‌باکس — اعمال و دموی تازه. تا تایید تو، خروجی نهایی‌ای ساخته نمی‌شود.
7. **final → verify** — کامپوزیت ۱۰۸۰×۱۹۲۰ یا ۱۹۲۰×۱۰۸۰ @30fps با گارد حجم و
   راستی‌آزمایی ffprobe.

## شروع سریع — اپ دسکتاپ

۱. نصب‌کننده را از [آخرین Release](https://github.com/pedramgholizadeh/ai-agentic-video-studio/releases/latest) بگیر.
۲. اجرا کن؛ در تنظیمات مدل whisper و کلیدهای API خودت را بگذار.
۳. دو فایل بده، ایجنت را انتخاب کن، Start.

## از ترمینال — From the terminal

```sh
npm run setup && npm run models && npm run doctor && npm start   # → http://127.0.0.1:8790
```

- نیازمندی‌ها: Node ≥ 20 و ffmpeg/ffprobe روی PATH (اپ دسکتاپ هر دو را داخل خودش دارد).
- قرارداد کامل ایجنت‌ها: [AGENTS.md](AGENTS.md) · اسکیل: `.agents/skills/studio-queue/`
- موتور خط فرمان: `node scripts/motion.mjs refprofile|brief|brand|beats|write|sfx|final|inspect`

## قوانین سخت

- **توان**: هر رندر از wrapper می‌گذرد و روی درصد تنظیم‌شده (دیفالت ۵۰٪) قفل است؛ ورکر هرگز `auto` نیست.
- **مقدس بودن facts**: متنِ روی تصویر فقط از ترنسکریپت یا جهت‌دهی خودت.
- **یک ست توکن برند** برای کل فیلم؛ **فقط Vazirmatn** برای هر واژهٔ فارسی.
- **آلفای WebM**: `slim` نه `fit-size`، بدون `--max-bitrate`، و `-c:v libvpx-vp9` قبل از `-i` لایه.
- **حاشیهٔ امن پلتفرم** برای ۹:۱۶ و ۱۶:۹ (lib/safe.mjs).

## معماری

| مسیر | چیست |
|---|---|
| `server.mjs` | پنل + صف + API (فقط 127.0.0.1) |
| `lib/runner.mjs` | پایپ‌لاین استودیو با دو دروازهٔ بازبینی |
| `lib/references.mjs` | حافظهٔ رفرنس (SHA-1-keyed) |
| `lib/chat.mjs` | چت‌باکس ادیت‌های فارسی + اینتنت‌ها |
| `lib/agents.mjs` | انتخاب ایجنت مرحلهٔ صفر + اسپاون headless |
| `desktop/` | شل اپلیکیشن (Electron) + آپدیتر GitHub Releases |
| `old/` | استودیوی قبلی (سازندهٔ لایهٔ موشن) — منجمد و قابل اجرا |

## لایسنس و سیاست

کد MIT؛ موتور رندر HyperFrames (Apache-2.0) از راه npx؛ GSAP فقط vendored.
جزئیات: [NOTICE.md](NOTICE.md) · [SECURITY.md](SECURITY.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

---

</div>

# Video Studio — English

**Two files in — your video and a reference video — one finished edit out.**

A local AI re-edit studio: the audio is transcribed with offline whisper
(`large-v3`, Persian), the text is understood into a brief, the reference
video's style is analysed pixel-perfect and remembered forever, and the final
cut renders at 30 fps with word-by-word Persian subtitles (Vazirmatn), motion
graphics and measured sound design. Zero runtime npm dependencies — everything
stays on this machine.

- **Desktop app (beta)** — macOS dmg & Windows NSIS from
  [GitHub Releases](https://github.com/pedramgholizadeh/ai-agentic-video-studio/releases/latest),
  built by [Actions](https://github.com/pedramgholizadeh/ai-agentic-video-studio/actions/workflows/desktop.yml),
  with **in-app updates** pulled from releases. The shell bundles Node, npm/npx,
  ffmpeg and ffprobe: nothing to install. Whisper models download from the
  app's own settings. Version stamp: `1.0.0-beta.<commit id>`.
- **Your settings, your agents** — stage zero picks who edits: opencode /
  zcode / claude code / codex (spawned headless) or an API brain (openrouter /
  z.ai / paasta.cloud) with your own keys.
- **The pipeline** — `prepare → transcribe → review → understand → reference →
  assets → strategy → scaffold → preview → (chat edits) → final → verify`, with
  two human review gates (the transcript table and the 640 px demo + Persian
  chat box).
- **Hard rules** — renders capped at the configured CPU share (default 50 %)
  through the cool-render wrapper; on-screen copy only from the transcript;
  one brand token set; Vazirmatn for every Persian word; WebM alpha and
  platform safe-rect invariants enforced.
- **Landing page** — [pedramgholizadeh.github.io/ai-agentic-video-studio/download.html](https://pedramgholizadeh.github.io/ai-agentic-video-studio/)
  with live download links from the latest release.

**Built by Pedram Gholizadeh (پدرام قلی‌زاده) — design & development.**
Engine: HyperFrames · Panel: vanilla JS, RTL, fa-default · Licence: MIT
(see [NOTICE.md](NOTICE.md)).
