> **Note:** written for the first idea, a hidden-cost audit, before the spike showed fees couldn't be measured. The visual direction, colours, type and rules carried over to Versus (red pen now means a loss or being behind the market); the wireframes and cost wording did not. The live design tokens are in [`app/globals.css`](../app/globals.css).

# Hidden Cost Audit: design direction

**Direction: the auditor's markup.** The app reads like a plain brokerage statement that an auditor has gone over with a red pen. The statement is quiet and black-and-white; every red mark is a cost we found. The look comes from real audit practice: ruled statement lines, tick marks beside figures, a double underline on the final total, and notes in the margin.

Tokens live in [`tokens.css`](./tokens.css) and are the source of truth. This file explains them and holds the wireframes.

## 1. Who and what

- **User:** a self-directed Canadian investor with accounts at two or more brokers. Comfortable with numbers, not an accountant. Usually on a laptop for this; checks on a phone after a sync.
- **Job of the dashboard:** show what their brokers cost them, where it comes from, and how much of it we measured versus estimated.
- **Job of the ledger:** let them check any number line by line.
- **The 10-second moment:** "My brokers cost me $649.15 CAD and $120.27 USD in the last 12 months, and half of the CAD is FX conversion at Northgate."

## 2. Colour (by role)

One accent with one meaning. Red is the auditor's pen: it marks costs and nothing else. Blue is the user's pencil: links, focus, primary buttons. Neither is ever decoration.

| Role | Light | Dark | Used for |
| --- | --- | --- | --- |
| Paper | `#F6F6F2` | `#111315` | Page background, the desk |
| Sheet | `#FFFFFF` | `#191C1F` | The statement surface |
| Ink | `#16181B` | `#ECEDEA` | Text and figures |
| Ink quiet (graphite) | `#545A61` | `#A3A8AE` | Secondary text, rule IDs, tick marks |
| Hairline | `#DCDDD6` | `#2C3035` | Ruled lines between statement rows (decorative) |
| Control | `#8A8F95` | `#6E747B` | Input and button borders |
| Cost (red pen) | `#B42318` | `#FF8B7E` | Cost figures, the double underline, margin notes |
| Cost tint | `#FDECEA` | `#2E1A18` | A highlighted cost line (row hover, linked selection) |
| Action (blue pencil) | `#1B4F8F` | `#93B8F2` | Links, focus rings, primary button |
| Caution | `#7A4A00` on `#FCF0D6` | `#F0C46A` on `#2B2412` | Stale, partial, held-out banners |

**Measured contrast (WCAG 2.2):** ink on sheet 17.8:1 (dark 14.6); graphite on sheet 7.0:1 (7.2); red on sheet 6.6:1 (7.5); red on cost tint 5.8:1 (7.2); action on paper 7.6:1 (9.2); caution on its background 6.6:1 (9.4); control border on sheet 3.3:1 (3.6, UI minimum 3:1). Every text pair passes AA for body text.

**Meaning never by colour alone.** Every cost figure is also in a "Cost" column or labelled; every confidence state has a mark and a word (below).

## 3. The audit marks (confidence, without colour)

Auditors tick figures they have checked. We use the same idea for confidence, always as mark plus word:

| Mark | Word | Means |
| --- | --- | --- |
| ✓ | measured | Reported by the broker |
| ≈ | estimated | Computed against the Bank of Canada rate |
| ? | held out | Failed a data check; not in any total; reason shown |
| – | excluded | Out of scope (options, crypto, unrecognised type); counted, not costed |

Marks are graphite, never red: the red pen is for costs, not for confidence. A legend sits under the first table on each page. Screen readers get the word, not the glyph.

## 4. Type

- **IBM Plex Sans**, regular 400 and semibold 600, self-hosted, `font-display: swap`. Chosen because it was drawn for engineering and financial documents: clear figures, distinct `1 l I`, and tabular lining numerals.
- **Scale (ratio 1.2 from 16px):** 13 footnotes, 14 table cells, 16 body, 19 section titles, 23 page title, 40 headline total.
- **Numbers:** `font-feature-settings: "tnum", "lnum"` everywhere figures align. Right-aligned, two decimals for money, currency code always shown (`649.15 CAD`), minus sign not parentheses.
- **Body measure** max 68ch. Sentence case everywhere. No all-caps labels.

## 5. Space, shape, layout

- **Spacing:** 4px base (4, 8, 12, 16, 24, 32, 48, 64).
- **Shape:** the statement sheet and tables have square corners and a 1px hairline edge, like paper. Only controls are rounded (4px) and marks (2px). One shadow in the product: dialogs.
- **Desktop (≥ 1024px):** a centred page of 1152px. The statement takes the main column; a **margin-notes column** (288px) on the right holds the red-pen notes, aligned to the line they annotate.
- **Tablet (640–1023px):** margin notes collapse under the line they annotate.
- **Mobile (< 640px):** one column; tables reflow into stacked statement lines (label left, figure right). The ledger scrolls inside its container, never the page.

## 6. The one bold thing: the marked-up total

The headline total is set at 40px semibold with an accountant's **double underline in red**, the convention for a final total. Beside it in the margin, a red note names the biggest cost source with a thin leader line to the figure it explains. That is the only large type, the only drawn mark and the only animation in the product. Everything else stays quiet.

## 7. Motion

- **One orchestrated moment:** on the first render after a sync, the double underline draws left to right under the total (320ms, ease-out). With `prefers-reduced-motion`, it is simply there.
- **Everything else responds to input:** row hover tints the cost line (120ms); "Synced" replaces "Syncing" in place. No count-up numbers, no fade-in sections.

## 8. Rejected defaults

| Default | Why it was rejected | What we did instead |
| --- | --- | --- |
| Inter / system UI | Generic; weak figure distinction | IBM Plex Sans with tabular numerals |
| Cream paper, serif display, terracotta accent | The current "editorial" cliché | Cool neutral paper, one sans family, red only as the pen |
| KPI cards with big number + small label + gradient | Reads as a template; cards for tabular data | A statement with ruled lines; the four categories are statement lines |
| Coloured "measured / estimated" pills | Colour-only meaning, badge clutter | Audit marks plus words, in graphite |
| Tracked all-caps eyebrows, monospace data labels | Second-wave cliché | Sentence case labels in graphite |
| Fade-and-slide sections, count-up totals | Motion as decoration | One underline draw; the rest is instant |
| Stock shadcn appearance | Library default | Restyle its tokens: radius, colour, font, no shadow |

## 9. Frontend rules (for code review)

1. Red (`--color-cost`) is only for cost figures, the total's underline and margin notes. Never for errors, links or decoration.
2. Errors and warnings use caution colours plus an icon and words; never red.
3. Tabular data uses `<table>` with right-aligned tabular figures. No cards for rows of numbers.
4. Every money value shows its currency code. Native totals never mix currencies; the CAD view is labelled estimated.
5. Every figure links to its ledger rows. Every confidence state is mark plus word.
6. One animation only (the underline). Respect `prefers-reduced-motion`.
7. Sentence case, no all-caps, no "A · B · C" meta strings, no arrows on every link.
8. Tokens only in components: no raw hex or px.
9. Personal pages send `Cache-Control: private, no-store`; no amounts in URLs, logs or analytics.

## 10. Wireframes

Demo numbers below come from the demo portfolio (two fictional brokers, Northgate and Lakeshore). Every breakdown sums to its total.

### Dashboard: desktop (≥ 1024px)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Hidden Cost Audit                                         Accounts   Ledger   Richard ▾   Disconnect      │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Period [Last 12 months ▾]   Show in [Native ▾ | CAD ≈]        Data as of Oct 16, 2026  ·  [Refresh]       │
│                                                                                                          │
│ ┌ statement sheet ─────────────────────────────────────────────────────────┐   margin notes (red pen)     │
│ │ What your brokers cost you, Oct 17, 2025 – Oct 16, 2026                  │                              │
│ │                                                                          │                              │
│ │   CAD accounts                                     649.15 CAD  ≈         │ ── Half of it is FX          │
│ │                                                    ══════════            │    conversion at Northgate:  │
│ │   0.77% of 84,210.00 CAD held                                            │    338.20 CAD (52%).         │
│ │                                                                          │                              │
│ │   USD accounts                                     120.27 USD  ✓         │                              │
│ │                                                    ══════════            │                              │
│ │   0.56% of 21,540.00 USD held                                            │                              │
│ │ ────────────────────────────────────────────────────────────────────────│                              │
│ │   By category                          CAD                USD            │                              │
│ │   Commissions                      186.40 ✓            23.97 ✓           │                              │
│ │   FX conversion                    412.75 ≈             0.00             │ ── 14 of 20 USD trades at    │
│ │   Foreign withholding                0.00              96.30 ✓           │    Northgate had a rate we   │
│ │   Account fees                      50.00 ✓             0.00             │    could check.              │
│ │   Total                            649.15 ≈           120.27 ✓           │                              │
│ │ ────────────────────────────────────────────────────────────────────────│                              │
│ │   By broker (CAD)   Total     Commissions  FX       Fees   Per 1,000 traded  FX markup  FX coverage     │
│ │   Northgate        524.60 ≈     186.40 ✓  338.20 ≈  0.00        4.51         1.52%      14 of 20       │
│ │   Lakeshore        124.55 ≈       0.00    74.55 ≈  50.00 ✓      0.00         0.41%       9 of 9        │
│ │ ────────────────────────────────────────────────────────────────────────│                              │
│ │   Month by month (CAD)                                                   │                              │
│ │   ▁▂▁▆▂▁▃▁▁▇▂▁   stacked bars: commissions, FX, fees; labels on bars      │                              │
│ │                                                                          │                              │
│ │   ✓ measured   ≈ estimated   ? held out   – excluded                      │                              │
│ │   Not included: 3 option trades, 1 crypto activity (–). 2 rows held out (?). See ledger.               │
│ └──────────────────────────────────────────────────────────────────────────┘                              │
│                                                                                                          │
│ Lakeshore RRSP history starts Mar 4, 2022. Costs before that are not included.                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Every figure is a link to the ledger filtered to its rows. The double underline (`══`) is the red-pen total mark.
- Withholding by account type sits under the category table as a one-line note when present: "USD withholding: 71.10 in TFSA, 0.00 in RRSP, 25.20 in taxable. Why this differs" (link to an explainer; no advice).

### Dashboard: mobile (< 640px)

```
┌───────────────────────────────┐
│ Hidden Cost Audit        ☰    │
├───────────────────────────────┤
│ Last 12 months ▾   Native ▾   │
│ As of Oct 16  ·  Refresh      │
│ ┌ sheet ────────────────────┐ │
│ │ CAD accounts              │ │
│ │            649.15 CAD ≈   │ │
│ │            ══════════     │ │
│ │ 0.77% of holdings         │ │
│ │ Half is FX conversion at  │ │  ← margin note moves under its line
│ │ Northgate: 338.20 (52%).  │ │
│ │ ───────────────────────── │ │
│ │ USD accounts              │ │
│ │            120.27 USD ✓   │ │
│ │ ───────────────────────── │ │
│ │ Commissions               │ │
│ │   186.40 CAD ✓            │ │
│ │    23.97 USD ✓            │ │
│ │ FX conversion             │ │
│ │   412.75 CAD ≈            │ │
│ │ Foreign withholding       │ │
│ │    96.30 USD ✓            │ │
│ │ Account fees              │ │
│ │    50.00 CAD ✓            │ │
│ │ ───────────────────────── │ │
│ │ Northgate     524.60 CAD ≈│ │  ← broker table reflows to lines;
│ │ Lakeshore     124.55 CAD ≈│ │    tap for the full broker row
│ └───────────────────────────┘ │
└───────────────────────────────┘
```

### Ledger: desktop

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Dashboard   Ledger                                                                                      │
│ Showing: FX conversion · Northgate · last 12 months         [Category ▾] [Broker ▾] [Account ▾] [Period ▾]│
│ 20 USD trades, 14 costed, 6 without a checkable rate.                         [Download CSV]              │
│ ┌ sheet ───────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Date ▾       Account          Security   Converted      Broker rate   BoC rate        Markup   Cost   │ │
│ │ ─────────────────────────────────────────────────────────────────────────────────────────────────────│ │
│ │ Sep 24, 2026 Northgate TFSA   VTI        6,120.00 CAD   1.3912        1.3714          1.44%  88.36 ≈ │ │
│ │ Aug 12, 2026 Northgate TFSA   MSFT       2,540.00 CAD   1.3955        1.3740          1.56%  39.75 ≈ │ │
│ │ Jul 05, 2026 Northgate Cash   AAPL       1,380.00 CAD   1.3846        1.3646 (Jul 3)  1.47%  20.23 ≈ │ │
│ │ Jun 18, 2026 Northgate Cash   AAPL         910.00 CAD   –             –               –      –      │ │
│ │              Rate not reported by the broker. Not costed.                                            │ │
│ │ …                                                                                                    │ │
│ │ ─────────────────────────────────────────────────────────────────────────────────────────────────────│ │
│ │ Total of 14 costed rows                                                                338.20 CAD ≈  │ │
│ │                                                                                        ══════════    │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ Selected row: Sep 24, 2026 VTI                                                                           │
│ Rule C3 (FX, estimated). Markup = (1.3912 − 1.3714) ÷ 1.3714 = 1.4438%. Cost = 1.4438% × 6,120.00 = 88.36.│
│ Source: SnapTrade activity, trade date Sep 24, 2026. BoC rate for Sep 24, 2026.                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Displayed percentages are rounded to two places; costs are always computed from the unrounded markup, and the derivation shows four places so the arithmetic can be checked by hand.
- The ledger is one `<table>`: sortable column headers are buttons with `aria-sort`; the footer total matches the dashboard figure the user clicked.
- Selecting a row (click or Enter) opens the derivation below the table: the rule, the arithmetic, the source. That is the "show your work" feature.
- Held-out rows (`?`) appear in a separate "Held out" tab with their reason, never mixed into the costed rows.

### Ledger: mobile

```
┌───────────────────────────────┐
│ ← Ledger                      │
│ FX · Northgate · 12 months ▾  │
│ 14 costed, 6 not checkable    │
│ ┌───────────────────────────┐ │
│ │ Sep 24, 2026   VTI        │ │
│ │ Northgate TFSA            │ │
│ │ 6,120.00 CAD at 1.3912    │ │
│ │ BoC 1.3714  ·  +1.44%     │ │
│ │                 88.36 ≈   │ │
│ │ ───────────────────────── │ │
│ │ Aug 12, 2026   MSFT       │ │
│ │ …                         │ │
│ │ ───────────────────────── │ │
│ │ Total        338.20 CAD ≈ │ │
│ └───────────────────────────┘ │
│ [Download CSV]                │
└───────────────────────────────┘
```

## 11. States

| State | Dashboard | Ledger |
| --- | --- | --- |
| Loading (first sync) | Statement-shaped skeleton; per-account progress list: "Northgate TFSA: page 2 of 4" | Skeleton rows matching column widths; no layout shift on arrival |
| Partial | Caution banner: "2 of 3 accounts synced. Totals cover synced accounts only." Totals still shown, marked partial | Same banner; rows from unsynced accounts absent and named |
| Stale (sync older than 6 h, or sync failed) | "Data as of Oct 15, 2026, 9:40 PM. Couldn't reach SnapTrade. Refresh" | Same line above the table |
| Empty: no costs | "No costs found between Oct 17, 2025 and Oct 16, 2026. Commission-free trading and no FX conversions, by the look of it." | "No rows match these filters." plus Clear filters |
| Empty: no accounts | "No brokerage accounts are shared with this app. Connect one in SnapTrade, then Refresh." Link to the SnapTrade dashboard | Not reachable |
| History gap | Footnote per account: "Lakeshore RRSP history starts Mar 4, 2022." | Same footnote when the period starts earlier |
| Broken connection | Account line marked "Needs attention in SnapTrade" with a link; last snapshot shown | Rows kept, labelled "as of" their last sync |
| Error (self-check failed) | That figure replaced by "Can't show this total: its parts don't add up. We've logged it." No number shown | Table still shown; footer total replaced by the same message |
| Edge data | 6-digit totals keep two decimals and grouping; zero shows `0.00`, not blank; negative FX cost shows `−3.10 ≈` with note "better than the reference rate" | Long security names truncate with full name on focus; 5,000+ rows paginate at 200 |
| Demo mode | Persistent banner: "Sample data. Nothing here is a real account." | Same banner |
| Signed out / disconnected | Landing page: "See what your brokers really cost you." [Sign in with SnapTrade] [Try with sample data] | Redirect to landing |

## 12. Copy

- One term per concept: **cost** (never fee/charge interchangeably at the top level), **measured / estimated / held out / excluded**, **Refresh**, **Disconnect**.
- Buttons say what happens: "Sign in with SnapTrade", "Download CSV", "Refresh", "Disconnect and delete my data".
- Descriptive notes describe, never advise: "Most of your FX cost comes from USD trades in your CAD account", never "Switch brokers".
