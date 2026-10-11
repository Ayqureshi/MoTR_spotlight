import {
  appendOneStopTrialMeta,
  readOneStopTrialMetaFromEl,
} from './oneStopExportFields';
import { nowEpochMs, toScreenPx } from './syncMarkers';

/** Wilcox et al. (2024) MoTR raw sampling rate: 20 Hz (50 ms). */
export const RAW_SAMPLE_INTERVAL_MS = 50;

/** Word-column marker when the cursor is outside text interest areas. */
export const OUT_OF_BOUNDS_WORD_CODE = '999';

const OUT_OF_BOUNDS_WORD_LEGACY = '114';

export function outOfBoundsWordForIndex(index, word) {
  const idx = index != null && index !== '' ? Number(index) : null;
  if (idx != null && Number.isFinite(idx) && idx < 1) return OUT_OF_BOUNDS_WORD_CODE;
  if (word === OUT_OF_BOUNDS_WORD_LEGACY || word === Number(OUT_OF_BOUNDS_WORD_LEGACY)) {
    return OUT_OF_BOUNDS_WORD_CODE;
  }
  return word;
}

export function installRawPositionSampling(vm) {
  if (!vm || vm._motrRawSampleIntervalId) return;
  vm._motrRawSampleIntervalId = setInterval(() => saveRawPositionSample(vm), RAW_SAMPLE_INTERVAL_MS);
}

export function uninstallRawPositionSampling(vm) {
  if (!vm || !vm._motrRawSampleIntervalId) return;
  clearInterval(vm._motrRawSampleIntervalId);
  vm._motrRawSampleIntervalId = null;
}

export function saveRawPositionSample(vm) {
  if (!vm || !vm.showFirstDiv || !vm.$el || !vm.isCursorMoving) return;
  const readingText = vm.$el.querySelector('.readingText');
  if (!readingText) return;

  const expEl = vm.$el.querySelector('.experiment_id');
  const itemEl = vm.$el.querySelector('.item_id');
  const conditionEl = vm.$el.querySelector('.condition_id');
  if (!expEl || !itemEl) return;

  const x = vm.mousePosition && vm.mousePosition.x != null ? vm.mousePosition.x : null;
  const y = vm.mousePosition && vm.mousePosition.y != null ? vm.mousePosition.y : null;
  if (x == null || y == null) return;

  const trialIndexEl = vm.$el.querySelector('.trial_index');
  const presentationOrder = trialIndexEl && trialIndexEl.value !== ''
    ? parseInt(trialIndexEl.value, 10)
    : null;

  let index = vm.currentIndex != null ? vm.currentIndex : -1;
  if (typeof index === 'string') index = parseInt(index, 10);
  if (Number.isNaN(index)) index = -1;

  let word = null;
  let wordRect = null;
  let lineNumber = null;
  let positionInLine = null;
  if (index >= 1) {
    const span = vm.$el.querySelector(`.readingText span[data-index="${index}"]`);
    if (span) {
      word = span.innerHTML;
      const rect = span.getBoundingClientRect();
      wordRect = { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
      if (typeof vm.getWordLineAndPositionInLine === 'function') {
        const lineMeta = vm.getWordLineAndPositionInLine(index);
        lineNumber = lineMeta.lineNumber;
        positionInLine = lineMeta.positionInLine;
      }
    }
  }

  const subjectId = vm.$magpie && vm.$magpie.measurements && vm.$magpie.measurements.SubjectID
    ? vm.$magpie.measurements.SubjectID
    : '';

  const payload = {
    recordType: 'raw_position_sample',
    Experiment: expEl.value,
    Condition: conditionEl ? conditionEl.value : '',
    ItemId: itemEl.value,
    presentation_order: presentationOrder,
    Index: index,
    Word: outOfBoundsWordForIndex(index, word),
    mousePositionX: Math.round(x),
    mousePositionY: Math.round(y),
    sampleTimeMs: performance.now(),
    epoch_time_ms: nowEpochMs(),
    SubjectId: subjectId,
    SubjectID: subjectId,
  };

  const screenPos = toScreenPx(x, y);
  payload.mouse_screen_x_px = screenPos.x;
  payload.mouse_screen_y_px = screenPos.y;

  if (wordRect) {
    payload.wordPositionTop = wordRect.top;
    payload.wordPositionLeft = wordRect.left;
    payload.wordPositionBottom = wordRect.bottom;
    payload.wordPositionRight = wordRect.right;
  }
  if (lineNumber != null) payload.line_number = lineNumber;
  if (positionInLine != null) payload.position_in_line = positionInLine;

  appendOneStopTrialMeta(payload, readOneStopTrialMetaFromEl(vm.$el));

  if (typeof $magpie !== 'undefined' && $magpie.addTrialData) {
    $magpie.addTrialData(payload);
  }
}
