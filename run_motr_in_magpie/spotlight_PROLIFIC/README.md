# Offline lab sessions

The Prolific build can also be used for local in-lab sessions without internet. Install/build before disconnecting, then open the local server URL with `?offline=1`; results download as a ZIP at the end instead of being uploaded. See [Offline mode](../OFFLINE_MODE.md) for setup and EyeLink pairing notes. Prolific recruitment and completion redirects are not available offline.
# MoTR Spotlight — Prolific

Same OneStop stimuli and `../shared/` library as SONA. **Edit here:** `src/components/ConsentPROLIFIC.vue`, `src/studyConfig.js` (e.g. `articlesPerLevel: 2` → 4 texts in two level blocks; default without this key is 15 per block).

See [../TWO_VERSIONS.md](../TWO_VERSIONS.md).

```bash
npm install
npm run serve
```
