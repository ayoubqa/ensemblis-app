# Ensemblis brand assets

Source: **Ensemblis Brand + Creative Web Pack v1.0 (official logo)**.

| File | What it is |
|---|---|
| `ensemblis-official-logo.png` | The official logo, exactly as supplied (1214 × 1214). |
| `ensemblis-official-logo-transparent.png` | The official logo with the outer white area transparent, exactly as supplied. |
| `ensemblis-app-icon-512.png`, `apple-touch-icon.png`, `favicon-16.png`, `favicon-32.png` | Supplied icon sizes, unchanged. |
| `ensemblis-mark-{32…384}.{png,webp}` | Proportional resizes of `ensemblis-official-logo-transparent.png` (Lanczos). Nothing else changed. |
| `ensemblis-app-icon-192.png` | Proportional resize of the supplied 1024 px app icon (web manifest). |

`app/icon.png`, `app/apple-icon.png` and `app/favicon.ico` are the supplied favicon / touch-icon PNGs
(the `.ico` packages `favicon-16.png` + `favicon-32.png` unchanged).

## Rules (from the official logo usage guide)

- Use the supplied mark exactly. Resize proportionally only.
- Do not redraw, trace, recolour, outline, add shadows to, rotate, stretch or recreate the mark in CSS/SVG.
- The earlier generated "E" bar mark and the pack's `ensemblis-icon-*.svg` / `ensemblis-logo-*.svg` /
  `ensemblis-wordmark.svg` / `favicon.svg` files are **superseded** and are not used.
- The wordmark next to the mark is set in Inter (`components/Logo.tsx`).
