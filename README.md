# استودیو ویدیو — Video Studio

یک استودیوی تدوینِ محلی: **دو فایل بده — ویدیوی خودت + یک ویدیوی رفرنس —** و
استودیو تا خروجی نهایی می‌رود. پنل وب جاب‌ها را صف می‌کند، ایجنتِ انتخابی تو
(یا موتور قطعی خود استودیو) آن را می‌سازد و مرورگر همان لحظه پیشرفت را نشان
می‌دهد. بدون هیچ وابستگی npm در زمان اجرا؛ همه‌چیز روی همین کامپیوتر.

A local re-edit studio: hand it **two files — your video plus a reference
video** — and it carries the job to a finished cut. The web panel queues jobs;
the agent you picked at stage zero (or the studio's own deterministic engine)
builds them while the browser streams the progress. Zero runtime npm
dependencies; everything stays on this machine.

## پایپ‌لاین — The pipeline

```
prepare → transcribe → review → understand → reference → assets → strategy
        → scaffold → preview → (حلقهٔ ادیت چت) → final → verify
```

1. **transcribe** — صدای ویدیوی تو با whisper جدا و پیاده می‌شود (دیفالت
   `large-v3`، زبان فارسی؛ «خیلی خیلی دقت» قانون این استیج است).
2. **review** — دروازهٔ اول: جدول خط‌به‌خط ترنسکریپت، هر خط قابل ویرایش، کلیک روی
   زمان = پرش ویدیو. غلط املایی را خودت همین‌جا می‌گیری.
3. **understand** — متن کامل خوانده و فهمیده می‌شود؛ `brief.json` با
   موضوع/تز/قوس روایت و `facts[]` که فقط کلمات خودِ ترنسکریپت‌اند.
4. **reference** — رفرنس پیکسل‌پرفکت تحلیل می‌شود: ریتم کات‌ها، انرژی حرکت،
   پالت، ترنزیشن‌ها، جانمایی کپشن. هر رفرنس **یک بار** تحلیل و برای همیشه در
   `workspace/references/` (با کلید SHA-1) یاد می‌ماند — دفعهٔ بعد همین فایل را
   بدهی، پنل خودش پیشنهادش را می‌دهد و پروفایل بی‌درنگ برمی‌گردد.
5. **assets** — کیت افکت صدا، فونت‌ها (Vazirmatn)، texture ها و اسلات لوگو.
6. **strategy** — سناریو و استراتژی تدوین: بیت‌ها روی ریتم رفرنس با بریف و برند
   چیده می‌شوند (`scenario.md`).
7. **preview** — دموی اولیهٔ خیلی کم‌حجم (۱۵fps، ۶۴۰px). در **چت‌باکس** ادیت
   بده — «تراکم بیشتر»، «زیرنویس بالاتر»، «انرژی کمتر»، «خط ۳: …» — اعمال
   می‌شود و دموی تازه می‌آید. تا تایید نکنی، هیچ خروجی نهایی‌ای ساخته نمی‌شود.
8. **final → verify** — رندر کامل ۳۰fps، کامپوزیت لایهٔ موشن + افکت‌ها (+ لوگو)
   روی ویدیوی تو، خروجی H.264 در **1920×1080 (۱۶:۹، دیفالت)** یا **1080×1920
   (۹:۱۶)** با گارد سقف حجم و راستی‌آزمایی ffprobe.

همهٔ کلمات فارسی روی تصویر با فونت **Vazirmatn** رندر می‌شوند.

## راه‌اندازی — Setup

```sh
npm run setup      # کیت افکت صدا + GSAP (پین‌شده با SHA-256)
npm run models     # مدل آفلاین whisper (دیفالت large-v3، ~۲.۹GB)
npm run doctor     # باید با «Required tools are present» تمام شود
npm start          # پنل روی http://127.0.0.1:8790 (فقط لوکال)
```

نیازمندی‌ها: Node ≥ 20 و ffmpeg/ffprobe روی PATH.

## مرحلهٔ صفر: چه کسی ادیت کند؟

در گام اول ویزارد، ایجنت را انتخاب می‌کنی:

- **CLI ایجنت‌ها** — opencode، zcode، claude code، codex: اگر نصب باشند پنل
  خودش headless روی جاب اجرایشان می‌کند (HANDOFF.md را می‌خوانند و تا خروجی
  می‌روند)؛ اگر نباشند دستور wake می‌گیری.
- **مغز API** — openrouter، z.ai (GLM)، paasta.cloud: مراحل هوشمند (درک متن،
  سناریو) با مدل انتخابی؛ رندر همیشه محلی.
- **خودِ استودیو** — بدون هیچ مدلی، با قوانین قطعی خانه.

## توان سیستم — Machine power

تنظیمات ← «توان سیستم»: اسلایدر ۱۰ تا ۱۰۰٪ (قانون خانه: **۵۰٪**). همهٔ رندرها
از wrapperی `tools/cool-render/cool-run` می‌گذرند و هرگز بیشتر از همین عدد CPU
نمی‌گیرند؛ تعداد ورکرها هم از همین بودجه حساب می‌شود، هرگز `auto`.

## از ترمینال — From the terminal

```sh
node cli.mjs list | next | claim | wait | log | progress | show | done | fail | power
node scripts/motion.mjs refprofile|brief|brand|beats|write|sfx|final|collage|inspect|…
```

قرارداد کامل برای ایجنت‌ها: [AGENTS.md](AGENTS.md).

## پنل منتشرشده — The hosted panel

`ui/` روی GitHub Pages هم منتشر می‌شود (workflow ریپو). نسخهٔ میزبان بدون موتور
است؛ با موتورِ روی کامپیوتر خودت (`node server.mjs --allow-origin pages`) از
راه پل loopback (`ui/engine.js`) حرف می‌زند و گرنه بنر «موتور روشن نیست»
نشان می‌دهد.

## زبان — Language

پنل دوزبانه است؛ **دیفالت فارسی** و انگلیسی با دکمهٔ بالای صفحه. اصطلاحات فنی
فارسی‌نویسی می‌شوند: جاب، اسکیل، ایجنت، رندر، رفرنس، بریف.

## استودیوی قبلی

استودیوی قبلی (سازندهٔ لایهٔ موشن شفاف با ورودی SRT) سالم و قابل اجرا در
[`old/`](old/) زندگی می‌کند — `node old/server.mjs`.

## Licence / policy

همان ریپوی قبلی: موتور رندر HyperFrames (Apache-2.0) از راه npx، GSAP فقط
vendored، متنِ روی تصویر فقط از ترنسکریپت یا جهت‌دهی خودت — هیچ عدد یا ادعایی
اختراع نمی‌شود. جزئیات: [NOTICE.md](NOTICE.md) · [SECURITY.md](SECURITY.md).
