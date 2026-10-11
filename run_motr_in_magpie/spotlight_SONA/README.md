# MoTR Spotlight — SONA

Mouse-tracking for Reading. **Prolific** version: `../spotlight_PROLIFIC/`. Shared code: `../shared/`. See [../TWO_VERSIONS.md](../TWO_VERSIONS.md).

**Reading passages** from `../OneStop/Texts/*.csv`. Practice: `trials/spotlight_items_practice.tsv`.

**Edit here:** `src/components/ConsentSONA.vue`, `src/studyConfig.js` (e.g. `articlesPerLevel: 6` → 12 texts in two level blocks; Prolific uses 3 per block → 6 total).

```bash
npm install
npm run serve
```

## Reading preview (no data saved)

Use this link to try the reading phase only (instructions, practice trial, and full reading trial list — same spotlight as the live study). Nothing is uploaded or written to GitHub:

**https://mo-tr-spotlight.vercel.app/?preview=reading**

Local dev: `http://localhost:8080/?preview=reading`

Demographics-only preview: `?preview=demographics`

## Offline sessions

For internet-free lab sessions, install/build the app before disconnecting and open the local server URL with `?offline=1`. The final screen downloads the results ZIP instead of uploading it. Setup and EyeLink pairing notes: [Offline mode](../OFFLINE_MODE.md).
