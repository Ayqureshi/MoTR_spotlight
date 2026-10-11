<template>
  <Screen title="Save results">
    <Slide>
      <p>The session is complete. Your results are being saved automatically.</p>
      <p v-if="saving">Saving results…</p>
      <button type="button" :disabled="saving" @click="downloadResults">
        {{ downloaded ? 'Download results ZIP again' : 'Download results ZIP' }}
      </button>
      <p v-if="downloaded">Results ZIP downloaded.</p>
      <p v-if="savedLocally">Results also saved to the Results folder next to Start-SONA.cmd / Start-PROLIFIC.cmd.</p>
      <p v-if="localSaveError" role="alert">Could not save to the Results folder ({{ localSaveError }}). Use the ZIP download.</p>
      <p v-if="error" role="alert">Could not prepare the results ZIP: {{ error }}</p>
    </Slide>
  </Screen>
</template>

<script>
import { Screen, Slide } from 'magpie-base';
import {
  buildCompleteResultsFiles,
  buildCompleteSessionTimes,
  downloadResultsFiles,
  resolveExportContext,
  saveOfflineResultsToLocalServer,
} from '../resultsSafeguard';
import { buildSyncFiles } from '../syncMarkers';

export default {
  name: 'OfflineResultsScreen',
  components: { Screen, Slide },
  data() {
    return {
      saving: false,
      downloaded: false,
      savedLocally: false,
      localSaveError: '',
      error: '',
    };
  },
  mounted() {
    // Save to the Results folder and download the ZIP as soon as the final screen appears.
    this.downloadResults();
  },
  methods: {
    async downloadResults() {
      if (this.saving) return;
      this.saving = true;
      this.error = '';
      try {
        const context = resolveExportContext(this, null);
        const sessionTimes = buildCompleteSessionTimes(this);
        const files = buildCompleteResultsFiles(
          context.allRows,
          context.participantId,
          context.expData,
          sessionTimes
        );
        if (!files.some((file) => file.content)) {
          throw new Error('No experiment data to save.');
        }
        const sessionFile = {
          name: 'offline_session.json',
          content: JSON.stringify({
            studyKey: context.session && context.session.studyKey
              ? context.session.studyKey
              : context.expData.study_key || '',
            participantId: context.participantId,
            sessionId: context.sessionId || '',
            trialsCompleted: context.session && Array.isArray(context.session.trialsCompleted)
              ? context.session.trialsCompleted.slice().sort((a, b) => a - b)
              : [],
            exportedAt: new Date().toISOString(),
            uploadAttempted: false,
          }, null, 2),
        };
        files.push(...buildSyncFiles(this), sessionFile);
        try {
          await saveOfflineResultsToLocalServer(this, 'complete', [sessionFile]);
          this.savedLocally = true;
          this.localSaveError = '';
        } catch (err) {
          this.localSaveError = err && err.message ? err.message : String(err);
        }
        await downloadResultsFiles(files, context.folderName);
        this.downloaded = true;
      } catch (err) {
        this.error = err && err.message ? err.message : String(err);
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>