import studyConfig from './studyConfig';
import { isOfflineMode } from '@motr-shared/previewMode.js';

export default {
  experimentId: studyConfig.experimentId,
  studyKey: studyConfig.studyKey,
  githubResultsPath: studyConfig.githubResultsPath,
  serverUrl: isOfflineMode() ? '' : 'https://cui-motr-new.herokuapp.com/',
  socketUrl: isOfflineMode() ? '' : 'wss://cui-motr-new.herokuapp.com/socket',
  completionUrl: studyConfig.completionUrl,
  contactEmail: studyConfig.contactEmail,
  mode: studyConfig.mode,
  language: studyConfig.language,
  resultsUploadUrl: studyConfig.resultsUploadUrl,
};
