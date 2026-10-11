# Offline mode

Both Spotlight versions support local in-lab sessions without internet access. Offline mode keeps the regular consent, questionnaire, Cambridge test, adaptive passage selection, mouse tracking, and comprehension flow. It skips remote Magpie services, article checkpoint uploads, and final uploads; instead, the final screen offers a ZIP download containing the reports and raw data.

## Prepare the computer

Do this before disconnecting from the internet:

1. Install Node.js 16 or newer and dependencies in the app folder:

   ```powershell
   cd run_motr_in_magpie/spotlight_SONA
   npm install
   ```

   Use `spotlight_PROLIFIC` instead for that build.
2. Build the app with `npm run build`, or keep the local development server ready with `npm run serve`.
3. Disconnect the experiment computer from the internet. Connect the EyeLink Host and display computer using SR Research's normal local EyeLink network setup.
4. Start the local app server and open the URL it prints, adding `?offline=1` (for example, `http://localhost:8080/?offline=1`). Do not use the hosted GitHub Pages/Vercel URL for an internet-free session.
5. Complete a test session and verify that the final screen downloads a `motr_results_*.zip` containing `fixation_report.csv`, `interest_area_report.csv`, `raw_trial_data.csv`, `raw_position_samples.csv`, and `offline_session.json`.

The computer still needs a local web server; `file://` launch is not supported. Internet access is needed beforehand to install dependencies and, depending on the lab's WebLink setup, may be needed on a separate machine to prepare/deploy the WebLink experiment. Confirm the exact WebLink requirements with SR Research and test the whole setup with the lab's EyeLink model before recruiting.

## Pairing mouse and gaze data

Use the same participant/session code in the Spotlight ZIP and the WebLink/EyeLink EDF. Keep both systems on the same computer clock where possible, record the start time of each task, and save a session manifest linking the two files. The mouse reports include a wall-clock experiment start timestamp and within-session event times; EyeLink gaze timestamps are tracker-clock times, so synchronize or record a clock-alignment event before comparing them.

This is not normal free reading: in Spotlight the mouse controls what is visible. Concurrent gaze data therefore measure gaze while the participant navigates a mouse-controlled reveal window. If the goal is to compare eye and mouse measures during ordinary reading, use an unblurred reading condition or a separate eye-tracking-only session instead.