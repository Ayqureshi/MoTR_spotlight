MoTR Spotlight - offline lab build
==================================

1. Extract the whole ZIP first (right-click > Extract All). Do not run from inside the ZIP.
2. Double-click Start-SONA.cmd (or Start-PROLIFIC.cmd).
   A black window opens (the local server). Once it is ready it opens the app in the
   default browser at http://127.0.0.1:8080/?offline=1 (PROLIFIC uses port 8081).

- Keep the black window open for the whole session; close it afterwards.
- "Unable to connect" in the browser = the black window is not running. Start it
  (Start-SONA.cmd), read any ERROR line it prints, then refresh the browser.
- No internet and no Node.js install needed; node.exe is included here.
- EyeLink WebLink sessions: use Start-SONA-for-WebLink.cmd instead (no browser is opened;
  open the address in WebLink). Syncing gaze with mouse data: see sync\README_SYNC.txt.
- Use an up-to-date Chrome, Edge or Firefox if possible.
- Backups: after every 5 reading passages, everything recorded so far is saved to
    Results\motr_results_<ID>_<date>_<time>\after_05_passages\, after_10_passages\, ...
  and the full data is saved to ...\complete\ automatically when the final screen appears.
  Each backup contains all data up to that point, so the newest one is the most complete.
  The black window prints a line each time a backup is saved.
- The final screen also downloads motr_results_*.zip automatically (same data as the
  complete\ folder; its button downloads it again if needed):
  fixation_report.csv, interest_area_report.csv, raw_trial_data.csv,
  raw_position_samples.csv and offline_session.json.

Building this kit: build run_motr_in_magpie/spotlight_SONA and spotlight_PROLIFIC,
copy each dist folder here as SONA and PROLIFIC, and add node.exe (Node 16, win-x64).
