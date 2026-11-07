/*
 * HyperMotion — the motion layer for the studio.s HyperFrames films.
 * Deterministic helpers over a paused GSAP timeline. No timers, no clock,
 * no unseeded randomness. Every function takes an absolute time in seconds.
 *
 * The vocabulary is distilled from the shotcraft craft cards (typography/
 * blur-slide, typography/lead-word-zoom-assemble, rhythm/beat-step-list) and
 * the studio's own house rules: one shared ease drives every channel of a
 * word's entrance (y, blur, opacity move as one progress), group entrances
 * accelerate instead of marching, and beats land on elements — never on the
 * whole frame.
 */
(function (global) {
  "use strict";

  var EASE = {
    enter: "expo.out",
    word: "quint.out", /* blur-slide's EASE.out — the professional default */
    land: "power4.out",
    move: "power2.inOut",
    exit: "power3.in",
    soft: "power2.out",
    spring: "back.out(1.4)",
    overshoot: "back.out(1.8)",
  };

  var DUR = {
    enter: 0.45,
    exit: 0.2,
    move: 0.9,
    hold: 1.2,
    caption: 0.18,
  };

  /* Mulberry32, seeded per element. Never share one stream across elements. */
  function seeded(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function el(target) {
    return typeof target === "string" ? document.querySelector(target) : target;
  }

  function all(target) {
    if (typeof target !== "string") return Array.prototype.slice.call(target.nodeType ? [target] : target);
    return Array.prototype.slice.call(document.querySelectorAll(target));
  }

  /*
   * Split on spaces only. A Persian word (including ZWNJ, e.g. می‌سازم) stays
   * one token; letters are never separated because the script is cursive.
   */
  function splitWords(root) {
    if (!root || root.dataset.hmSplit === "1") return Array.prototype.slice.call(root.querySelectorAll(".hm-word"));
    var words = [];
    var nodes = Array.prototype.slice.call(root.childNodes);

    function pushWord(text) {
      var span = document.createElement("span");
      span.className = "hm-word";
      span.style.display = "inline-block";
      span.textContent = text;
      words.push(span);
      return span;
    }

    nodes.forEach(function (node) {
      if (node.nodeType === 3) {
        var parts = node.textContent.split(/(\s+)/);
        var frag = document.createDocumentFragment();
        parts.forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part));
          } else {
            frag.appendChild(pushWord(part));
          }
        });
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === 1) {
        if (!node.classList.contains("hm-word")) {
          splitWords(node).forEach(function (w) {
            words.push(w);
          });
        } else {
          words.push(node);
        }
      }
    });

    root.dataset.hmSplit = "1";
    return words;
  }

  /* Non-uniform stagger offsets: gaps shrink as the group lands, so a batch
   * entrance reads as accelerating (aesthetic rule R2) — never as a march. */
  function accelOffsets(n, each, accel) {
    var out = [0];
    for (var i = 1; i < n; i++) {
      var k = n > 1 ? i / (n - 1) : 0;
      out.push(out[i - 1] + each * (1 - (accel == null ? 0 : accel) * k));
    }
    return out;
  }

  /*
   * Headline words: the blur-slide default — y travel, blur and opacity share
   * one progress and one ease, so words surface out of focus instead of
   * sliding in while fading. `push` swaps the float for a slot-entry: each
   * word is shoved into place from the reading direction with a two-frame
   * fade, which reads as placed rather than appearing.
   */
  function revealWords(tl, target, opts) {
    opts = opts || {};
    var root = el(target);
    if (!root) return tl;
    var words = splitWords(root);
    var at = opts.at == null ? 0 : opts.at;
    var stagger = opts.stagger == null ? 0.07 : opts.stagger;
    var dur = opts.duration == null ? 0.55 : opts.duration;
    var push = !!opts.push;
    var fromX = opts.fromX == null ? (push ? "0.4em" : 16) : opts.fromX;
    var fromY = opts.fromY == null ? (push ? 0 : "0.3em") : opts.fromY;
    var fromBlur = opts.blur == null ? (push ? 3 : 14) : opts.blur;
    var ease = opts.ease || (push ? "power3.out" : EASE.word);

    var offs = accelOffsets(words.length, stagger, opts.accel);
    words.forEach(function (w, i) {
      tl.fromTo(
        w,
        { opacity: 0, x: fromX, y: fromY, filter: "blur(" + fromBlur + "px)" },
        {
          opacity: 1,
          x: 0,
          y: 0,
          filter: "blur(0px)",
          duration: dur,
          ease: ease,
        },
        at + offs[i],
      );
    });
    return tl;
  }

  /* Whole line: blur in, no travel. */
  function revealLine(tl, target, opts) {
    opts = opts || {};
    var node = el(target);
    if (!node) return tl;
    return tl.fromTo(
      node,
      { opacity: 0, filter: "blur(8px)" },
      {
        opacity: 1,
        filter: "blur(0px)",
        duration: opts.duration == null ? DUR.caption : opts.duration,
        ease: opts.ease || EASE.soft,
      },
      opts.at == null ? 0 : opts.at,
    );
  }

  /* A hairline that draws from the right (RTL reading start). */
  function drawRule(tl, target, opts) {
    opts = opts || {};
    var node = el(target);
    if (!node) return tl;
    node.style.transformOrigin = "right center";
    return tl.fromTo(
      node,
      { scaleX: 0, opacity: 0 },
      {
        scaleX: 1,
        opacity: 1,
        duration: opts.duration == null ? 0.35 : opts.duration,
        ease: opts.ease || EASE.enter,
      },
      opts.at == null ? 0 : opts.at,
    );
  }

  /* Slow push. Apply to a wrapper, never to a .clip element. */
  function cameraDrift(tl, target, opts) {
    opts = opts || {};
    var node = el(target);
    if (!node) return tl;
    node.style.transformOrigin = "50% 50%";
    return tl.fromTo(
      node,
      { scale: opts.from == null ? 1 : opts.from },
      {
        scale: opts.to == null ? 1.03 : opts.to,
        duration: opts.duration == null ? DUR.move : opts.duration,
        ease: opts.ease || EASE.move,
      },
      opts.at == null ? 0 : opts.at,
    );
  }

  /* Mint underline under one word; draws right to left. */
  function accentUnderline(tl, target, opts) {
    opts = opts || {};
    var node = el(target);
    if (!node) return tl;
    node.style.transformOrigin = "right center";
    return tl.fromTo(
      node,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: opts.duration == null ? 0.3 : opts.duration,
        ease: opts.ease || EASE.enter,
      },
      opts.at == null ? 0 : opts.at,
    );
  }

  /* One gradient sweep across live text (clip:text), then the inline styles
   * come off so the element keeps its stylesheet colour. Protagonist-only —
   * once per film segment, never batched (aesthetic rule Q4). */
  function sweep(tl, target, opts) {
    opts = opts || {};
    var node = el(target);
    if (!node) return tl;
    var at = opts.at == null ? 0 : opts.at;
    var dur = opts.duration == null ? 0.9 : opts.duration;
    var colour = opts.colour || "rgba(85,230,165,0.95)";
    var base = opts.base || "#ffffff";
    node.style.color = "transparent";
    node.style.backgroundImage = "linear-gradient(100deg, " + base + " 42%, " + colour + " 50%, " + base + " 58%)";
    node.style.webkitBackgroundClip = "text";
    node.style.backgroundClip = "text";
    node.style.backgroundSize = "260% 100%";
    node.style.backgroundRepeat = "no-repeat";
    var state = { p: 0 };
    function paint() {
      node.style.backgroundPosition = String(220 - state.p * 340) + "% 0%";
    }
    paint();
    tl.fromTo(
      state,
      { p: 0 },
      {
        p: 1,
        duration: dur,
        ease: "power2.inOut",
        onUpdate: paint,
        onComplete: function () {
          node.style.color = "";
          node.style.backgroundImage = "";
          node.style.webkitBackgroundClip = "";
          node.style.backgroundClip = "";
          node.style.backgroundSize = "";
          node.style.backgroundPosition = "";
        },
      },
      at,
    );
    return tl;
  }

  /* A settling pulse on an element at each given beat time — the card answers
   * the music without the whole frame ever moving (aesthetic rule R4). */
  function pump(tl, target, opts) {
    opts = opts || {};
    var node = el(target);
    if (!node) return tl;
    var beats = opts.beats || [];
    var amount = opts.amount == null ? 0.022 : opts.amount;
    beats.forEach(function (t) {
      tl.to(node, { scale: 1 + amount, duration: 0.1, ease: "power2.out" }, t);
      tl.to(node, { scale: 1, duration: 0.32, ease: "power2.inOut" }, t + 0.1);
    });
    return tl;
  }

  /* Group entrance with hard-accelerating gaps and a spring settle — cards
   * dealt onto a table, not soldiers marching (aesthetic rule R2). */
  function deal(tl, targets, opts) {
    opts = opts || {};
    var items = all(targets);
    if (!items.length) return tl;
    var at = opts.at == null ? 0 : opts.at;
    var each = opts.each == null ? 0.3 : opts.each;
    var offs = accelOffsets(items.length, each, opts.accel == null ? 0.45 : opts.accel);
    items.forEach(function (node, i) {
      tl.fromTo(
        node,
        { opacity: 0, scale: opts.fromScale == null ? 0.72 : opts.fromScale, y: opts.fromY == null ? 14 : opts.fromY },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: opts.duration == null ? 0.46 : opts.duration,
          ease: opts.ease || EASE.overshoot,
        },
        at + offs[i],
      );
    });
    return tl;
  }

  function toPersianDigits(value) {
    var fa = "۰۱۲۳۴۵۶۷۸۹";
    return String(value).replace(/[0-9]/g, function (d) {
      return fa[+d];
    });
  }

  /* Count-up computed from tween progress, so any seek renders the right value. */
  function countUp(tl, target, opts) {
    opts = opts || {};
    var node = el(target);
    if (!node) return tl;
    var to = opts.to == null ? 0 : opts.to;
    var prefix = opts.prefix || "";
    var suffix = opts.suffix || "";
    var persian = opts.persian !== false;
    var state = { v: opts.from == null ? 0 : opts.from };

    function paint() {
      var rounded = Math.round(state.v);
      node.textContent = prefix + (persian ? toPersianDigits(rounded) : String(rounded)) + suffix;
    }
    paint();

    return tl.fromTo(
      state,
      { v: opts.from == null ? 0 : opts.from },
      {
        v: to,
        duration: opts.duration == null ? 0.9 : opts.duration,
        ease: opts.ease || EASE.soft,
        onUpdate: paint,
      },
      opts.at == null ? 0 : opts.at,
    );
  }

  /* Surface card: no glass, no glow. */
  function cardIn(tl, target, opts) {
    opts = opts || {};
    var node = el(target);
    if (!node) return tl;
    return tl.fromTo(
      node,
      { opacity: 0, y: 24, scale: 0.98 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: opts.duration == null ? 0.4 : opts.duration,
        ease: opts.ease || "power3.out",
      },
      opts.at == null ? 0 : opts.at,
    );
  }

  /* Reveal from the right with clip-path. Large type or colour blocks only. */
  function wipeMask(tl, target, opts) {
    opts = opts || {};
    var node = el(target);
    if (!node) return tl;
    return tl.fromTo(
      node,
      { clipPath: "inset(0 0 0 100%)" },
      {
        clipPath: "inset(0 0 0 0%)",
        duration: opts.duration == null ? 0.5 : opts.duration,
        ease: opts.ease || EASE.move,
      },
      opts.at == null ? 0 : opts.at,
    );
  }

  global.HM = {
    ease: EASE,
    dur: DUR,
    seeded: seeded,
    splitWords: splitWords,
    accelOffsets: accelOffsets,
    revealWords: revealWords,
    revealLine: revealLine,
    drawRule: drawRule,
    cameraDrift: cameraDrift,
    accentUnderline: accentUnderline,
    sweep: sweep,
    pump: pump,
    deal: deal,
    countUp: countUp,
    cardIn: cardIn,
    wipeMask: wipeMask,
    toPersianDigits: toPersianDigits,
  };
})(window);
