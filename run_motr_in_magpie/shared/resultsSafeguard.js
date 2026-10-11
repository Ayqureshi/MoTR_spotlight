import JSZip from 'jszip';
import magpieConfig from '@magpie-config';
import {
  buildFixationReport,
  buildInterestAreaReport,
  buildRawPositionReport,
  buildRawTrialDataCsv,
  buildRawTrialDataCsvForCheckpoint,
  enrichExpDataWithSonaId,
  generateUniqueAlphanumericId,
  localDateString,
  localTimeString,
  resolveExperimentStartInstant,
  resolveSonaId,
} from './resultsReports';
import { getResultsSession } from './resultsSession';
import {
  deleteResultsSnapshot,
  listPendingSnapshots,
  loadResultsSnapshot,
  saveResultsSnapshot,
} from './resultsIndexedDb';
import { isNoUploadMode, isOfflineMode } from './previewMode';
import { getResultsUploadUrl, uploadResultsFiles } from './resultsUpload';
import { buildSyncFiles } from './syncMarkers';

function resolveParticipantId(vm, expData) {
  const exp = expData && typeof expData === 'object' ? expData : {};
  let participantId =
    exp.ParticipantId
    || exp.ProlificID
    || exp.ProlificId
    || exp.SubjectID
    || exp.SubjectId
    || exp.SONAId
    || exp.SonaId
    || (vm.$root && vm.$root.participantId)
    || null;
  if (!participantId || String(participantId).trim() === '') {
    participantId = generateUniqueAlphanumericId();
    if (vm.$magpie.addExpData) vm.$magpie.addExpData({ ParticipantId: participantId });
  }
  return String(participantId).trim();
}

function resolveGithubResultsPath(vm, studyConfig) {
  return (vm.githubResultsPath && String(vm.githubResultsPath).trim())
    || (studyConfig && studyConfig.githubResultsPath && String(studyConfig.githubResultsPath).trim())
    || (magpieConfig.githubResultsPath && typeof magpieConfig.githubResultsPath === 'string'
      ? magpieConfig.githubResultsPath.trim()
      : '');
}

export function resolveExportContext(vm, studyConfig) {
  const allRows = vm.$magpie.getAllData();
  const expData = (vm.$magpie.getExpData && vm.$magpie.getExpData()) || {};
  const session = getResultsSession(vm);
  const participantId = session && session.participantId
    ? session.participantId
    : resolveParticipantId(vm, expData);
  const uploadUrl = getResultsUploadUrl(vm);
  const githubResultsPath = resolveGithubResultsPath(vm, studyConfig);
  const isTest = !!(vm.$magpie && vm.$magpie.debug);
  const folderName = session && session.folderName
    ? session.folderName
    : `motr_results_${participantId}_unknown`;
  return {
    participantId,
    expData,
    allRows,
    uploadUrl,
    githubResultsPath,
    isTest,
    folderName,
    sessionId: session ? session.sessionId : null,
    session,
  };
}

export function buildCheckpointSessionTimes(vm) {
  const expData = (vm.$magpie.getExpData && vm.$magpie.getExpData()) || {};
  const session = getResultsSession(vm);
  const startInstant = resolveExperimentStartInstant(
    expData,
    null,
    session && session.startTime
  );
  return {
    experiment_start_time_fallback: startInstant ? startInstant.toISOString() : '',
  };
}

export function buildCompleteSessionTimes(vm) {
  const checkpointTimes = buildCheckpointSessionTimes(vm);
  const expData = (vm.$magpie.getExpData && vm.$magpie.getExpData()) || {};
  const session = getResultsSession(vm);
  const endTime = new Date();
  const startInstant = resolveExperimentStartInstant(
    expData,
    checkpointTimes,
    session && session.startTime
  );
  const durationMs = startInstant ? (endTime.getTime() - startInstant.getTime()) : '';
  const endDate = localDateString(endTime);
  const endClockTime = localTimeString(endTime);
  return {
    ...checkpointTimes,
    experiment_end_date: endDate,
    experiment_end_time: endTime.toISOString(),
    experiment_end_clock_time: endClockTime,
    experiment_end_time_local: `${endDate} ${endClockTime}`,
    experiment_duration: durationMs !== '' ? String(durationMs) : '',
  };
}

export function filterRowsForTrial(allRows, trial) {
  if (!Array.isArray(allRows)) return [];
  const itemId = trial && trial.item_id != null ? trial.item_id : (trial ? trial.ItemId : null);
  if (itemId == null) return allRows.slice();
  return allRows.filter((row) => {
    if (!row) return false;
    const rowItemId = row.ItemId != null && row.ItemId !== ''
      ? row.ItemId
      : (row.item_id != null && row.item_id !== '' ? row.item_id : null);
    return rowItemId != null && String(rowItemId) === String(itemId);
  });
}

function buildCheckpointManifest(session, context) {
  return JSON.stringify({
    sessionId: session.sessionId,
    participantId: context.participantId,
    SONAId: context.sonaId || '',
    folderName: context.folderName,
    trialsCompleted: session.trialsCompleted.slice().sort((a, b) => a - b),
    updatedAt: new Date().toISOString(),
  }, null, 2);
}

function isReadingTrial(trial) {
  return trial
    && trial.onestop_article_number != null
    && String(trial.onestop_article_number).trim() !== '';
}

function articleCheckpointKey(trial) {
  return `${String(trial.onestop_article_number).trim()}|${String(trial.onestop_level || '').trim()}`;
}

/** True when the participant just finished the last paragraph of an article (reading trials only). */
export function isLastParagraphOfArticle(vm, trial, trialIndex) {
  if (!isReadingTrial(trial)) return false;
  const trials = vm.trials || [];
  const key = articleCheckpointKey(trial);
  for (let i = trialIndex + 1; i < trials.length; i += 1) {
    const next = trials[i];
    if (!isReadingTrial(next)) continue;
    if (articleCheckpointKey(next) !== key) return true;
  }
  return true;
}

function collectArticleTrialIndices(vm, trial, trialIndex) {
  if (!isReadingTrial(trial)) return [];
  const trials = vm.trials || [];
  const key = articleCheckpointKey(trial);
  const indices = [];
  for (let i = trialIndex; i >= 0; i -= 1) {
    const t = trials[i];
    if (!isReadingTrial(t)) break;
    if (articleCheckpointKey(t) !== key) break;
    indices.unshift(i);
  }
  return indices;
}

function buildTrialCheckpointFiles(trialRows, trialIndex, allRows, participantId, expData, sessionTimes) {
  const trialNum = String(trialIndex + 1).padStart(2, '0');
  const files = [
    {
      name: `trials/trial_${trialNum}_fixation.csv`,
      content: buildFixationReport(trialRows, participantId, expData, sessionTimes),
    },
    {
      name: `trials/trial_${trialNum}_raw.csv`,
      content: buildRawTrialDataCsvForCheckpoint(trialRows, allRows, expData, sessionTimes),
    },
  ];
  const rawPositionCsv = buildRawPositionReport(trialRows, participantId, expData, sessionTimes);
  if (rawPositionCsv) {
    files.splice(1, 0, {
      name: `trials/trial_${trialNum}_raw_position_samples.csv`,
      content: rawPositionCsv,
    });
  }
  return files;
}

export function buildCompleteResultsFiles(allRows, participantId, expData, sessionTimes) {
  const fixationCsv = buildFixationReport(allRows, participantId, expData, sessionTimes);
  const interestAreaCsv = buildInterestAreaReport(allRows, participantId, expData, sessionTimes);
  const rawPositionCsv = buildRawPositionReport(allRows, participantId, expData, sessionTimes);
  const rawTrialCsv = buildRawTrialDataCsv(allRows, expData, sessionTimes);
  const files = [
    { name: 'fixation_report.csv', content: fixationCsv },
    { name: 'interest_area_report.csv', content: interestAreaCsv },
    { name: 'raw_trial_data.csv', content: rawTrialCsv },
  ];
  if (rawPositionCsv) {
    files.push({ name: 'raw_position_samples.csv', content: rawPositionCsv });
  }
  return files;
}

export async function uploadCompleteResults(context, sessionTimes, resultsScope = 'complete') {
  if (isNoUploadMode() || isOfflineMode()) return [];
  const files = buildCompleteResultsFiles(
    context.allRows,
    context.participantId,
    context.expData,
    sessionTimes
  );
  const sessionComplete = JSON.stringify({
    sessionId: context.sessionId,
    participantId: context.participantId,
    folderName: context.folderName,
    completedAt: new Date().toISOString(),
    trialsCompleted: context.session && Array.isArray(context.session.trialsCompleted)
      ? context.session.trialsCompleted.slice().sort((a, b) => a - b)
      : [],
  }, null, 2);
  files.push({ name: 'session_complete.json', content: sessionComplete });

  let zipBase64 = '';
  try {
    const blob = await createResultsDownloadBlob(files, context.folderName);
    const { blobToBase64 } = await import('./resultsUploadCore.js');
    zipBase64 = await blobToBase64(blob);
  } catch (err) {
    console.warn('Could not build email ZIP for complete upload:', err);
  }

  return uploadResultsFiles(
    context.uploadUrl,
    context.participantId,
    context.folderName,
    files,
    context.isTest,
    context.githubResultsPath,
    resultsScope,
    { zipBase64 }
  );
}

export async function createResultsDownloadBlob(files, folderName) {
  const zip = new JSZip();
  const folder = folderName && String(folderName) ? String(folderName) : 'motr_results';
  for (const file of files || []) {
    if (!file || file.content == null || file.content === '') continue;
    zip.file(`${folder}/${file.name}`, file.content);
  }
  return zip.generateAsync({ type: 'blob' });
}

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadResultsFiles(files, folderName) {
  const blob = await createResultsDownloadBlob(files, folderName);
  triggerBlobDownload(blob, `${folderName || 'motr_results'}.zip`);
}

export async function uploadReadingTrialCheckpoint(vm, trial, trialIndex, studyConfig) {
  if (isNoUploadMode()) return;
  const context = resolveExportContext(vm, studyConfig);
  const session = getResultsSession(vm);
  if (!session) return;

  if (!Array.isArray(session.trialsCompleted)) session.trialsCompleted = [];
  if (!session.trialsCompleted.includes(trialIndex)) {
    session.trialsCompleted.push(trialIndex);
  }

  if (isOfflineMode() || !context.uploadUrl) return;

  if (!isLastParagraphOfArticle(vm, trial, trialIndex)) {
    return;
  }

  const articleIndices = collectArticleTrialIndices(vm, trial, trialIndex);
  const expData = enrichExpDataWithSonaId(vm, context.expData, context.allRows);
  const sonaId = resolveSonaId(vm, expData, context.allRows);
  if (sonaId && !session.sonaId) session.sonaId = sonaId;
  const sessionTimes = buildCheckpointSessionTimes(vm);

  const checkpointFiles = [];
  const trials = vm.trials || [];
  for (const idx of articleIndices) {
    const articleTrial = trials[idx];
    if (!articleTrial) continue;
    const trialRows = filterRowsForTrial(context.allRows, articleTrial);
    checkpointFiles.push(
      ...buildTrialCheckpointFiles(
        trialRows,
        idx,
        context.allRows,
        context.participantId,
        expData,
        sessionTimes
      )
    );
  }

  const manifest = buildCheckpointManifest(session, { ...context, sonaId });
  checkpointFiles.push({ name: 'checkpoint_manifest.json', content: manifest });

  const articleNum = String(trial.onestop_article_number).trim();
  const level = String(trial.onestop_level || '').trim();
  const checkpointLabel = `article_${articleNum}_${level}`;

  // Spread concurrent participant uploads slightly to reduce GitHub API bursts.
  await new Promise((resolve) => {
    setTimeout(resolve, Math.floor(Math.random() * 4000));
  });

  await uploadResultsFiles(
    context.uploadUrl,
    context.participantId,
    context.folderName,
    checkpointFiles,
    context.isTest,
    context.githubResultsPath,
    'partial',
    { checkpointLabel }
  );
}

/** Offline mode: write a cumulative backup to the local lab server after this many reading screens. */
export const OFFLINE_CHECKPOINT_EVERY = 5;

/**
 * Offline mode: POST all data collected so far to the local lab server (serve.js), which writes
 * it to Results/<folderName>/<label>/. Nothing leaves the computer. Throws if the server refuses.
 */
export async function saveOfflineResultsToLocalServer(vm, label, extraFiles = []) {
  const context = resolveExportContext(vm, null);
  const sessionTimes = label === 'complete'
    ? buildCompleteSessionTimes(vm)
    : buildCheckpointSessionTimes(vm);
  const files = buildCompleteResultsFiles(
    context.allRows,
    context.participantId,
    context.expData,
    sessionTimes
  ).concat(buildSyncFiles(vm), extraFiles);
  const res = await fetch(new URL('offline-save', window.location.href).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderName: context.folderName,
      label,
      files: files.filter((file) => file && file.content),
    }),
  });
  if (!res.ok) throw new Error(`Local save failed (${res.status})`);
  return res.json();
}

/** Run checkpoint upload and IndexedDB snapshot after the UI advances (non-blocking). */
export function deferReadingTrialSafeguards(vm, trial, trialIndex, studyConfig) {
  if (isNoUploadMode()) return;
  if (isOfflineMode()) {
    const session = getResultsSession(vm);
    if (session) {
      if (!Array.isArray(session.trialsCompleted)) session.trialsCompleted = [];
      if (!session.trialsCompleted.includes(trialIndex)) {
        session.trialsCompleted.push(trialIndex);
        const done = session.trialsCompleted.length;
        if (done % OFFLINE_CHECKPOINT_EVERY === 0) {
          const label = `after_${String(done).padStart(2, '0')}_passages`;
          queueMicrotask(() => {
            saveOfflineResultsToLocalServer(vm, label).catch((err) => {
              console.warn('Offline checkpoint save failed:', err);
            });
          });
        }
      }
    }
    return;
  }
  queueMicrotask(() => {
    uploadReadingTrialCheckpoint(vm, trial, trialIndex, studyConfig).catch((err) => {
      console.warn('Trial checkpoint upload failed:', err);
    });
    persistResultsSnapshot(vm, studyConfig).catch((err) => {
      console.warn('Results snapshot failed:', err);
    });
  });
}

export async function persistResultsSnapshot(vm, studyConfig) {
  if (isNoUploadMode()) return;
  const context = resolveExportContext(vm, studyConfig);
  const session = getResultsSession(vm);
  if (!session) return;

  const sessionTimes = buildCheckpointSessionTimes(vm);
  const files = buildCompleteResultsFiles(
    context.allRows,
    context.participantId,
    context.expData,
    sessionTimes
  );

  await saveResultsSnapshot(session.sessionId, {
    participantId: context.participantId,
    folderName: context.folderName,
    uploadUrl: context.uploadUrl,
    githubResultsPath: context.githubResultsPath,
    isTest: context.isTest,
    files,
    trialsCompleted: session.trialsCompleted || [],
    pendingComplete: true,
    savedAt: new Date().toISOString(),
  });
}

async function uploadSnapshotPayload(snapshot) {
  if (isNoUploadMode() || isOfflineMode()) return false;
  if (!snapshot || !snapshot.uploadUrl || !snapshot.folderName || !Array.isArray(snapshot.files)) {
    return false;
  }
  const sessionComplete = JSON.stringify({
    sessionId: snapshot.sessionId,
    participantId: snapshot.participantId,
    folderName: snapshot.folderName,
    completedAt: new Date().toISOString(),
    trialsCompleted: Array.isArray(snapshot.trialsCompleted)
      ? snapshot.trialsCompleted.slice().sort((a, b) => a - b)
      : [],
    recoveredFromSnapshot: true,
  }, null, 2);
  const files = snapshot.files.slice();
  files.push({ name: 'session_complete.json', content: sessionComplete });

  let zipBase64 = '';
  try {
    const blob = await createResultsDownloadBlob(files, snapshot.folderName);
    const { blobToBase64 } = await import('./resultsUploadCore.js');
    zipBase64 = await blobToBase64(blob);
  } catch (err) {
    console.warn('Could not build email ZIP for snapshot upload:', err);
  }

  await uploadResultsFiles(
    snapshot.uploadUrl,
    snapshot.participantId,
    snapshot.folderName,
    files,
    !!snapshot.isTest,
    snapshot.githubResultsPath || '',
    'complete',
    { zipBase64 }
  );
  return true;
}

export async function retryPendingSnapshotUpload(vm, studyConfig) {
  if (isNoUploadMode() || isOfflineMode()) return false;
  const session = getResultsSession(vm);
  if (session) {
    const snapshot = await loadResultsSnapshot(session.sessionId);
    if (snapshot && snapshot.pendingComplete) {
      try {
        await uploadSnapshotPayload(snapshot);
        await deleteResultsSnapshot(session.sessionId);
        return true;
      } catch (err) {
        console.warn('Pending session snapshot upload failed:', err);
      }
    }
  }

  let pending = [];
  try {
    pending = await listPendingSnapshots();
  } catch (err) {
    console.warn('Could not list pending snapshots:', err);
    return false;
  }

  for (const snapshot of pending) {
    try {
      await uploadSnapshotPayload(snapshot);
      await deleteResultsSnapshot(snapshot.sessionId);
      return true;
    } catch (err) {
      console.warn('Pending snapshot upload failed:', err);
    }
  }
  return false;
}

export { initResultsSession, getResultsSession, ensureExperimentStartRecorded } from './resultsSession';
