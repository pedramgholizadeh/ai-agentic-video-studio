<!--
Gate before requesting review:
  node --check on every file you touched
  npm run doctor          → “Required tools are present”
  npm run i18n:check      → 0 phrases not covered
-->

## What and why

<!-- One paragraph. If it fixes an issue, link it. -->

## Render rules checklist

<!-- Tick every row; strike through rows that genuinely cannot apply. -->

- [ ] Every media path still runs at ≤ 50 % CPU (`node cli.mjs power <pct>`, never `auto`)
- [ ] Output stays ≤ 200 MB and 30 fps CFR
- [ ] WebM layers keep alpha (`ALPHA_MODE=1`); no `fit-size` on alpha layers
- [ ] No on-screen text exists that is not in the SRT or the user's direction
- [ ] Zero runtime npm dependencies still hold

## Proof

<!-- For render changes: the ffprobe / motion.mjs inspect line of a real output.
     For UI changes: what you walked in the panel (which steps, which locale). -->

```
```
