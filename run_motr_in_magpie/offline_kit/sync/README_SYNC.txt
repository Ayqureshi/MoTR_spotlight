Syncing MoTR mouse data with EyeLink (WebLink)
==============================================

What the app records (offline mode, ?offline=1)
-----------------------------------------------
- raw_position_samples.csv : every mouse sample now has epoch_time_ms (display-PC clock)
  and mouse_screen_x_px / mouse_screen_y_px (screen pixels, same space as EyeLink gaze).
- sync_events.csv          : PASSAGE_START / PASSAGE_QUESTION / PASSAGE_END per passage,
  with epoch_time_ms and the browser window geometry.
- ias_passage_NN.ias       : word boxes for passage NN in screen pixels (Data Viewer format).
- At each passage start and question the page address changes to
  ...#motr_pNN_start / ...#motr_pNN_question. WebLink logs address changes in the EDF
  with tracker timestamps - these are the shared sync events.
All of these are in the Results folder backups and the downloaded ZIP.

Running a session with WebLink
------------------------------
1. Double-click Start-SONA-for-WebLink.cmd (or Start-PROLIFIC-for-WebLink.cmd).
   It starts the local server only (no browser of its own). Keep the window open.
2. In WebLink, open  http://127.0.0.1:8080/?offline=1   (PROLIFIC: port 8081).
3. Run the browser full-screen at 100% zoom and keep Windows display scaling unchanged
   during the session, so the word boxes stay valid.

PILOT CHECK (do this once before real participants)
---------------------------------------------------
Run a short session, convert the EDF to ASC (edf2asc, from the EyeLink Developers Kit):
    edf2asc pilot.edf
then on any computer with Python 3:
    python merge_weblink.py inspect pilot.asc
It must list "MoTR markers (#motr_pNN_...)" with a count > 0. If it shows 0, WebLink is
not logging the address changes in this setup - send the inspect output to whoever
maintains this code; the script also accepts a manual --offset-ms.

Merging
-------
    python merge_weblink.py merge participant.asc motr_results_XXXX.zip --out merged.csv

(The second argument can also be the Results\...\complete folder.)
Output, one row per gaze sample inside a passage:
  tracker_time_ms, passage, ItemId, gaze_x_px, gaze_y_px, pupil,
  gaze_word_index, gaze_word          (word under the eyes, from the .ias boxes)
  mouse_time_tracker_ms, mouse_lag_ms, mouse_screen_x_px, mouse_screen_y_px,
  mouse_word_index, mouse_word        (nearest mouse sample, within 60 ms)
  gaze_mouse_distance_px
plus merged_alignment_report.txt with the clock fit. Check "Max |residual|": a few ms is
normal; over 50 ms means some markers were logged late - look at the listed residuals.

Accuracy: the markers alone are accurate to WebLink's address-change logging delay (about
15 ms in the pilot). WebLink also logs the mouse (_MousePosition_, every ~17 ms), so the script
then matches the app's mouse trace to WebLink's and removes that delay automatically
(pilot: 16.7 px -> 5.1 px mean mouse mismatch after a -14 ms shift). Turn off with --no-mouse-refine. Clock drift is corrected automatically
for sessions longer than 5 minutes. Mouse is sampled every 50 ms.

Data Viewer (.ias)
------------------
The exported boxes are exactly as tall as the letters; with the study's double line spacing
half the screen height is gap between lines. merge_weblink.py therefore stretches each line's
boxes to fill half the gap above and below (standard for reading studies; --no-ia-padding
turns this off). For Data Viewer, make the same padded boxes with:
    python merge_weblink.py pad-ias motr_results_XXXX.zip --out-dir padded_ias
and import ias_passage_NN_padded.ias.

Pilot 2026-10-07 (WebLink 2.4.1, Firefox, EyeLink Portable Duo): all passage markers were
logged (as OnBeforeNavigate / URL_navigation / URL changed messages) and the word boxes
matched WebLink's own mouse log and the gaze positions on screen.
Import ias_passage_NN.ias as the interest-area template for the period/trial in which
passage NN was on screen (between the #motr_pNN_start and #motr_pNN_question messages).
Coordinates assume EyeLink's screen coordinates match the display resolution
(check DISPLAY_COORDS in the ASC against screen_width_px / screen_height_px in sync_events.csv).
