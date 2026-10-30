# Ensemblis design direction: "the working paper"

The basis for the site and product redesign. It has two parts: what was wrong, and what we chose instead.

## What was wrong (audit, local build of `main` at fb8963a)

- **Reads as a developer tool, not a business product.**
  - Every page was dark navy with a dot grid.
  - Small, all-caps monospace labels sat above every section.
  - Number badges such as `[1]` and step numbers used monospace type.
- **Template signals.**
  - The hero accented one phrase ("*We do the work.*" in blue italics).
  - A tracked-out eyebrow sat above every heading.
  - Meta strings were joined with middle dots, and links ended in "→".
- **Too long, too repetitive.**
  - The homepage was 9,383 px on desktop and 15,170 px on a phone.
  - Its ten sections explained the same cycle four times: a lifecycle strip, four steps, a trust timeline, and the FAQ.
- **The blog was invisible.** The navigation showed it only after an article was published, and all three articles
  are in source review.
- **Signed-out phones got an app-style bottom tab bar** with no Blog and no product link.
- **The product's dark default** was a different experience from the light reading pages, and the same template
  chrome appeared in the app: all-caps labels such as "SUCCESS CRITERIA" and "NOW".

## The idea

Business buyers live in documents: memos, briefs, board papers. Ensemblis's real output is one of those, a brief
with its sources numbered in the margin, criteria checked and limits stated. So the **document is the hero**, not a
dashboard.
- The visual world is an analyst's working paper on an Ink desk.
- A blue pencil marks citations; a highlighter marks what was verified.
- A plainly written note says what could not be established.

## Tokens

The official palette (Ensemblis Brand + Creative Web Pack v1.0) stays: the mark, the command bar and the accent
keep the brand's own blues. The working paper adds only derived surfaces, defined in `frontend/app/styles/tokens.css`.

| Name | Hex | Role |
|---|---|---|
| Ink (official) | `#07111F` | The desk: the command bar, the hero and the closing band. |
| Paper (derived) | `#FFFFFF` | Documents and reading surfaces. |
| Mist (derived) | `#F1F3F7` | The light page around documents. Cool, not cream. |
| Graphite (derived) | `#172033` | Text on light: 14.6:1 on Mist. Pencil `#4F5F73` for secondary text: 6.5:1 on Paper, 5.9:1 on Mist. |
| Electric Blue (official) | `#1677FF` | The one accent. AA-safe derived shades: `#0B63E6` for text and links (5.3:1 on Paper, 4.8:1 on Mist), `#0F6BF0` for filled buttons (4.8:1 with white), `#7CB2FF` on Ink (8.7:1). |
| Highlighter (derived) | `#FFE27A` | Only behind a sentence verified against a source (Graphite on it: 12.7:1). Never decoration. |

An earlier draft of this paper proposed a new indigo accent. It was dropped: the official blue passes AA on every new
surface, and a second blue next to the mark would have competed with it.

Type comes in two clearly different families, plus the wordmark:
- **Schibsted Grotesk** (variable): headlines and interface. A grotesk drawn for a news publisher. Plain-spoken and
  authoritative; set tight and heavy at display sizes and open at text sizes.
- **Newsreader** (variable): the document voice. Briefs, article bodies, quoted objectives. Not preloaded.
- **Inter** only for the wordmark, which the official reference sheet sets in Inter. Not preloaded.

Scale (px): 13 / 15 / 17 / 20 / 24 / 32 / 44 / 60 / 76. Body measure: 60–72 characters. Serif text gets more leading
than sans.

## Layout and principles

- **One bold move: the hero brief.** A Paper sheet on the Ink desk, overlapping into the Mist section below. It
  carries a real-format example (objective, criteria, two cited findings, a limitation, the ledger line) and is
  labelled as an example. Everything else is quiet.
- **Left-aligned, asymmetric, generous.** No eyebrows over headings; the heading itself says what the section is.
  Sentence case everywhere. No arrows in buttons.
- **Structure means something.**
  - Numbers appear only where content is a real sequence: the request-to-result steps.
  - A "you decide" mark appears only where a person acts.
  - Highlights appear only on verified text.
- **Honest by construction.** No logos, testimonials, metrics or invented customers. Examples are labelled.
  Availability is stated plainly: invite-only beta, research and analysis today.
- **Motion:** one orchestrated moment. The brief fills in on load: criteria tick, citations attach, the ledger line
  appears. It is disabled under `prefers-reduced-motion`.

## Reviewed against the generic defaults

| Generic default | Here instead |
|---|---|
| Dark gradient hero with a glowing dashboard mockup | A paper document on a flat Ink desk. The output, not the machine. |
| Accent one word of the headline | The headline stays one colour; the emphasis lives in the document. |
| Eyebrow label over every section | None. Headings carry the meaning. |
| Identical feature cards | One sequence with marked decision points, one annotated document, one editorial list of use cases |
| Testimonials, logos, metrics | None exist; none shown |
| Three pricing cards | Credits per objective, as the product works today. The subscription tiers in the references are not built, so they are not shown. |
