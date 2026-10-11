import stringify from 'csv-stringify/lib/sync';
import magpieConfig from '@magpie-config';
import {
  buildWilcoxAssociationsForItem,
  computeWilcoxGoPastByWord,
  filterValidHoverRows,
  getHoverDurationMs,
  getRowTime,
  isValidHoverAssociation,
} from './wilcoxReadingMetrics';
import {
  applyOneStopExportFields,
  columnsWithOneStopAfterCondition,
  getOneStopMetadataByItem,
  orderRawTrialColumns,
} from './oneStopExportFields';
import { outOfBoundsWordForIndex } from './motrRawSampling';

function generateUniqueAlphanumericId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const PARTICIPANT_ID_FIELDS = ['SONAId', 'SubjectId', 'SubjectID', 'SonaId'];

function pickNonEmptyString(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

/** Resolve SONA / subject identifier for exports (partial trials may lack welcome rows). */
function resolveSonaId(vm, expData, allRows) {
  const exp = expData && typeof expData === 'object' ? expData : {};
  const fromExp = pickNonEmptyString(
    exp.SONAId,
    exp.SonaId,
    exp.SubjectID,
    exp.SubjectId,
    exp.ProlificID,
    exp.ProlificId
  );
  if (fromExp) return fromExp;

  const fromMeasurements = vm && vm.$magpie && vm.$magpie.measurements
    ? pickNonEmptyString(vm.$magpie.measurements.SubjectID, vm.$magpie.measurements.SubjectId)
    : '';
  if (fromMeasurements) return fromMeasurements;

  if (Array.isArray(allRows)) {
    for (const row of allRows) {
      if (!row) continue;
      const fromRow = pickNonEmptyString(row.SONAId, row.SonaId, row.SubjectID, row.SubjectId);
      if (fromRow) return fromRow;
    }
  }

  const session = vm && vm.$root && vm.$root._motrResultsSession;
  if (session && session.sonaId) return String(session.sonaId).trim();

  return '';
}

function enrichExpDataWithSonaId(vm, expData, allRows) {
  const sonaId = resolveSonaId(vm, expData, allRows);
  if (!sonaId) return { ...(expData || {}) };
  const base = { ...(expData || {}) };
  if (!base.SONAId) base.SONAId = sonaId;
  if (!base.SonaId) base.SonaId = sonaId;
  if (!base.SubjectID) base.SubjectID = sonaId;
  if (!base.SubjectId) base.SubjectId = sonaId;
  return base;
}

function stampParticipantIdFields(out, sonaId) {
  if (!out || !sonaId) return out;
  for (const key of PARTICIPANT_ID_FIELDS) {
    if (out[key] == null || out[key] === '') out[key] = sonaId;
  }
  return out;
}

// ItemId: identifier of the text/trial item (e.g. sentence or passage) being read; one item per screen before the comprehension question.
function isRawSampleRow(row) {
  return row != null && row.recordType === 'raw_position_sample';
}

function isHoverAssociationRow(row) {
  if (row == null || row.mousePositionX == null || row.mousePositionX === '') return false;
  if (isRawSampleRow(row)) return false;
  if (row.recordType === 'hover_association') return true;
  return row.clickDurationMs != null || row.revealMode === 'hover';
}

function isFixationRow(row) {
  return isValidHoverAssociation(row);
}

function getResponseByItem(allRows) {
  const out = {};
  if (!Array.isArray(allRows)) return out;
  for (const r of allRows) {
    if (!r) continue;
    const itemId = r.ItemId != null && r.ItemId !== '' ? r.ItemId : (r.item_id != null && r.item_id !== '' ? r.item_id : null);
    const resp = r.response != null ? String(r.response) : (r.responses && Array.isArray(r.responses) ? r.responses.join('|') : (r.responses && typeof r.responses === 'object' ? JSON.stringify(r.responses) : ''));
    if (itemId != null && (resp !== '' || r.response !== undefined)) {
      if (resp !== '' || out[itemId] == null) out[itemId] = resp;
    }
  }
  return out;
}

function getResponseCorrectByItem(allRows) {
  const out = {};
  if (!Array.isArray(allRows)) return out;
  for (const r of allRows) {
    if (!r) continue;
    const itemId = r.ItemId != null && r.ItemId !== '' ? r.ItemId : (r.item_id != null && r.item_id !== '' ? r.item_id : null);
    const isCorrectRaw = r.response_correct;
    if (itemId == null || isCorrectRaw == null || isCorrectRaw === '') continue;
    out[itemId] = String(isCorrectRaw);
  }
  return out;
}

function padDatePart(n) {
  return String(n).padStart(2, '0');
}

function localDateString(date) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate())
  ].join('-');
}

function localTimeString(date) {
  return [
    padDatePart(date.getHours()),
    padDatePart(date.getMinutes()),
    padDatePart(date.getSeconds())
  ].join(':');
}

/** Build experiment start fields stored in Magpie expData. */
function buildExperimentStartExpFields(startDate) {
  const date = localDateString(startDate);
  const clock = localTimeString(startDate);
  return {
    experiment_start_time: startDate.toISOString(),
    experiment_start_date: date,
    experiment_date: date,
    experiment_start_clock_time: clock,
    experiment_start_time_local: `${date} ${clock}`,
  };
}

/**
 * Parse a wall-clock experiment start instant.
 * Rejects Magpie responseTime values (ms since session start), which are far below real Unix ms.
 */
function parseExperimentStartInstant(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1e11) return null;
    const date = new Date(n);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function resolveExperimentStartInstant(expData, sessionTimes, sessionStartIso) {
  const exp = expData && typeof expData === 'object' ? expData : {};
  const candidates = [
    exp.experiment_start_time,
    exp.experimentStartTime,
    sessionTimes && sessionTimes.experiment_start_time_fallback,
    sessionStartIso,
  ];
  for (const candidate of candidates) {
    const parsed = parseExperimentStartInstant(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function getExpDataFields(expData, allRows, sessionTimes) {
  const fromRows = { device: '', hand: '' };
  let subjectFromRows = '';
  if (Array.isArray(allRows)) {
    for (let i = allRows.length - 1; i >= 0; i--) {
      const r = allRows[i];
      if (r && (r.device != null && r.device !== '' || r.hand != null && r.hand !== '')) {
        if (r.device != null && r.device !== '') fromRows.device = r.device;
        if (r.hand != null && r.hand !== '') fromRows.hand = r.hand;
        break;
      }
    }
  }
  if (Array.isArray(allRows)) {
    for (const r of allRows) {
      if (!r) continue;
      if (r.SONAId != null && r.SONAId !== '') {
        subjectFromRows = r.SONAId;
        break;
      }
      if (r.SubjectId != null && r.SubjectId !== '') {
        subjectFromRows = r.SubjectId;
        break;
      }
      if (r.SubjectID != null && r.SubjectID !== '') {
        subjectFromRows = r.SubjectID;
        break;
      }
      if (r.SonaId != null && r.SonaId !== '') {
        subjectFromRows = r.SonaId;
        break;
      }
      if (r.ProlificID != null && r.ProlificID !== '') {
        subjectFromRows = r.ProlificID;
        break;
      }
      if (r.ProlificId != null && r.ProlificId !== '') {
        subjectFromRows = r.ProlificId;
        break;
      }
    }
  }
  const exp = expData && typeof expData === 'object' ? expData : {};
  const startInstant = resolveExperimentStartInstant(exp, sessionTimes, null);
  const derivedStart = startInstant ? buildExperimentStartExpFields(startInstant) : null;
  const startTime = derivedStart
    ? derivedStart.experiment_start_time
    : pickNonEmptyString(exp.experiment_start_time, exp.experimentStartTime, sessionTimes && sessionTimes.experiment_start_time_fallback);
  const endTime = sessionTimes && sessionTimes.experiment_end_time != null ? sessionTimes.experiment_end_time : '';
  const duration = sessionTimes && sessionTimes.experiment_duration != null ? sessionTimes.experiment_duration : '';
  const durationMs = exp.experiment_duration_ms != null ? exp.experiment_duration_ms : duration;
  const sonaIdValue =
    (exp.SONAId != null && exp.SONAId !== '')
      ? exp.SONAId
      : (exp.ProlificID != null && exp.ProlificID !== ''
        ? exp.ProlificID
        : (exp.ProlificId != null && exp.ProlificId !== ''
          ? exp.ProlificId
          : (exp.SubjectId != null && exp.SubjectId !== ''
            ? exp.SubjectId
            : (exp.SubjectID != null && exp.SubjectID !== ''
              ? exp.SubjectID
              : subjectFromRows))));

  return {
    device: exp.device != null && exp.device !== '' ? exp.device : fromRows.device,
    hand: exp.hand != null && exp.hand !== '' ? exp.hand : fromRows.hand,
    SONAId: sonaIdValue,
    experiment: exp.experiment != null ? exp.experiment : (exp.Experiment != null ? exp.Experiment : ''),
    experiment_date: pickNonEmptyString(exp.experiment_date, derivedStart && derivedStart.experiment_date),
    experiment_start_date: pickNonEmptyString(exp.experiment_start_date, exp.experiment_date, derivedStart && derivedStart.experiment_start_date),
    experiment_start_time: startTime,
    experiment_start_clock_time: pickNonEmptyString(exp.experiment_start_clock_time, derivedStart && derivedStart.experiment_start_clock_time),
    experiment_start_time_local: pickNonEmptyString(exp.experiment_start_time_local, derivedStart && derivedStart.experiment_start_time_local),
    experiment_end_date: sessionTimes && sessionTimes.experiment_end_date != null ? sessionTimes.experiment_end_date : (exp.experiment_end_date != null ? exp.experiment_end_date : ''),
    experiment_end_time: endTime,
    experiment_end_clock_time: sessionTimes && sessionTimes.experiment_end_clock_time != null ? sessionTimes.experiment_end_clock_time : (exp.experiment_end_clock_time != null ? exp.experiment_end_clock_time : ''),
    experiment_end_time_local: sessionTimes && sessionTimes.experiment_end_time_local != null ? sessionTimes.experiment_end_time_local : (exp.experiment_end_time_local != null ? exp.experiment_end_time_local : ''),
    experiment_duration: duration,
    experiment_duration_ms: durationMs
  };
}

const FIXATION_CSV_COLUMNS = columnsWithOneStopAfterCondition([
  'participant_id', 'SONAId', 'Condition', 'ItemId', 'text_presentation_order', 'WordIndex', 'Word',
  'responseTime', 'mousePositionX', 'mousePositionY', 'Regression', 'clickDurationMs',
  'relativeXInWord', 'relativeYInWord',
  'wordPositionTop', 'wordPositionLeft', 'wordPositionBottom', 'wordPositionRight',
  'line_number', 'position_in_line', 'response', 'response_correct', 'position_in_text',
  'text_total_viewing_time_ms',
  'saccade_start_x', 'saccade_start_y', 'saccade_start_time',
  'saccade_end_x', 'saccade_end_y', 'saccade_end_time', 'saccade_length_px',
  'device', 'hand', 'experiment_date', 'experiment_start_date', 'experiment_start_time',
  'experiment_start_clock_time', 'experiment_start_time_local', 'experiment_end_date',
  'experiment_end_time', 'experiment_end_clock_time', 'experiment_end_time_local',
  'experiment_duration', 'experiment_duration_ms',
  'experiment'
]);

const RAW_POSITION_CSV_COLUMNS = columnsWithOneStopAfterCondition([
  'participant_id', 'SONAId', 'Condition', 'ItemId', 'text_presentation_order', 'WordIndex', 'Word',
  'responseTime', 'sampleTimeMs', 'epoch_time_ms', 'mousePositionX', 'mousePositionY',
  'mouse_screen_x_px', 'mouse_screen_y_px',
  'wordPositionTop', 'wordPositionLeft', 'wordPositionBottom', 'wordPositionRight',
  'line_number', 'position_in_line', 'response', 'response_correct',
  'device', 'hand', 'experiment_date', 'experiment_start_date', 'experiment_start_time',
  'experiment_start_clock_time', 'experiment_start_time_local', 'experiment_end_date',
  'experiment_end_time', 'experiment_end_clock_time', 'experiment_end_time_local',
  'experiment_duration', 'experiment_duration_ms',
  'experiment'
]);

const INTEREST_AREA_CSV_COLUMNS = columnsWithOneStopAfterCondition([
  'participant_id', 'SONAId', 'Condition', 'ItemId', 'text_presentation_order',
  'word_index', 'WordIndex', 'word', 'response', 'response_correct', 'line_number', 'position_in_line',
  'click_count', 'skipped',
  'IA_FIRST_RUN_DWELL_TIME', 'IA_DWELL_TIME', 'IA_FIRST_FIXATION_DURATION',
  'go_past_time_ms', 'Wilcox go past', 'IA_REGRESSION_IN', 'IA_REGRESSION_OUT',
  'text_total_viewing_time_ms',
  'first_click_x', 'first_click_duration_ms', 'total_duration_ms', 'next_click_regression',
  'first_click_y',
  'x_distance_from_previous_click_px', 'x_distance_from_previous_click_chars',
  'first_click_x_from_word_left_chars', 'first_click_x_from_word_center_chars',
  'first_click_x_from_line_start_px', 'first_click_x_from_line_start_chars',
  'device', 'hand', 'experiment_date', 'experiment_start_date', 'experiment_start_time',
  'experiment_start_clock_time', 'experiment_start_time_local', 'experiment_end_date',
  'experiment_end_time', 'experiment_end_clock_time', 'experiment_end_time_local',
  'experiment_duration', 'experiment_duration_ms',
  'experiment'
]);

function buildRawPositionReport(allRows, participantId, expData, sessionTimes) {
  const rawRows = allRows.filter(isRawSampleRow);
  if (rawRows.length === 0) return '';
  const pid = participantId != null && String(participantId) ? String(participantId) : '';
  const expFields = getExpDataFields(expData, allRows, sessionTimes);
  const responseByItem = getResponseByItem(allRows);
  const responseCorrectByItem = getResponseCorrectByItem(allRows);
  const oneStopByItem = getOneStopMetadataByItem(allRows);

  const rowsForCsv = rawRows.map((row) => {
    const itemId = row.ItemId != null && row.ItemId !== '' ? row.ItemId : 'NO_ITEM';
    const val = (key) => (row[key] != null && row[key] !== '' ? row[key] : '');
    const out = {
      participant_id: pid,
      SONAId: expFields.SONAId,
      Condition: val('Condition'),
      ItemId: val('ItemId'),
      text_presentation_order: row.presentation_order != null && row.presentation_order !== '' ? Number(row.presentation_order) : '',
      WordIndex: row.Index != null && row.Index !== '' ? row.Index : '',
      Word: outOfBoundsWordForIndex(row.Index, val('Word')),
      responseTime: val('responseTime'),
      sampleTimeMs: row.sampleTimeMs != null && row.sampleTimeMs !== '' ? Math.round(Number(row.sampleTimeMs)) : '',
      epoch_time_ms: val('epoch_time_ms'),
      mousePositionX: val('mousePositionX'),
      mousePositionY: val('mousePositionY'),
      mouse_screen_x_px: val('mouse_screen_x_px'),
      mouse_screen_y_px: val('mouse_screen_y_px'),
      wordPositionTop: val('wordPositionTop'),
      wordPositionLeft: val('wordPositionLeft'),
      wordPositionBottom: val('wordPositionBottom'),
      wordPositionRight: val('wordPositionRight'),
      line_number: val('line_number'),
      position_in_line: val('position_in_line'),
      response: responseByItem[itemId] != null ? responseByItem[itemId] : '',
      response_correct: responseCorrectByItem[itemId] != null ? responseCorrectByItem[itemId] : '',
      device: expFields.device,
      hand: expFields.hand,
      experiment_date: expFields.experiment_date,
      experiment_start_date: expFields.experiment_start_date,
      experiment_start_time: expFields.experiment_start_time,
      experiment_start_clock_time: expFields.experiment_start_clock_time,
      experiment_start_time_local: expFields.experiment_start_time_local,
      experiment_end_date: expFields.experiment_end_date,
      experiment_end_time: expFields.experiment_end_time,
      experiment_end_clock_time: expFields.experiment_end_clock_time,
      experiment_end_time_local: expFields.experiment_end_time_local,
      experiment_duration: expFields.experiment_duration,
      experiment_duration_ms: expFields.experiment_duration_ms,
      experiment: expFields.experiment || (magpieConfig && (magpieConfig.experimentName || magpieConfig.experimentId || magpieConfig.name || 'MoTR_Click')),
    };
    applyOneStopExportFields(out, row, oneStopByItem);
    return out;
  });

  rowsForCsv.sort((a, b) => {
    const poA = a.text_presentation_order === '' ? Infinity : Number(a.text_presentation_order);
    const poB = b.text_presentation_order === '' ? Infinity : Number(b.text_presentation_order);
    if (poA !== poB) return poA - poB;
    const rtA = a.responseTime !== '' ? Number(a.responseTime) : (a.sampleTimeMs !== '' ? Number(a.sampleTimeMs) : Infinity);
    const rtB = b.responseTime !== '' ? Number(b.responseTime) : (b.sampleTimeMs !== '' ? Number(b.sampleTimeMs) : Infinity);
    return rtA - rtB;
  });

  return stringify(rowsForCsv, {
    columns: RAW_POSITION_CSV_COLUMNS,
    header: true,
  });
}

function buildFixationReport(allRows, participantId, expData, sessionTimes) {
  const fixationRows = allRows.filter(isFixationRow);
  if (fixationRows.length === 0) return '';
  const pid = participantId != null && String(participantId) ? String(participantId) : '';
  const expFields = getExpDataFields(expData, allRows, sessionTimes);
  const responseByItem = getResponseByItem(allRows);
  const responseCorrectByItem = getResponseCorrectByItem(allRows);
  const oneStopByItem = getOneStopMetadataByItem(allRows);

  const rowsWithMeta = fixationRows.map(r => {
    const itemId = r.ItemId != null && r.ItemId !== '' ? r.ItemId : 'NO_ITEM';
    const positionInText = r.Index != null && r.Index !== '' ? r.Index : '';
    return {
      ...r,
      participant_id: pid,
      position_in_text: positionInText,
      response: responseByItem[itemId] != null ? responseByItem[itemId] : '',
      response_correct: responseCorrectByItem[itemId] != null ? responseCorrectByItem[itemId] : '',
      ...expFields
    };
  });

  // Compute Regression per fixation within each text (ItemId):
  // Regression = 1 if current click's X is less than previous click's X for that item, else 0.
  const byItemForFixation = {};
  for (const row of rowsWithMeta) {
    const id = row.ItemId != null && row.ItemId !== '' ? row.ItemId : 'NO_ITEM';
    if (!byItemForFixation[id]) byItemForFixation[id] = [];
    byItemForFixation[id].push(row);
  }
  for (const itemId of Object.keys(byItemForFixation)) {
    const group = byItemForFixation[itemId].slice().sort((a, b) => getRowTime(a) - getRowTime(b));
    let prevX = null;
    for (const r of group) {
      const x = r.mousePositionX != null && r.mousePositionX !== '' ? Number(r.mousePositionX) : null;
      let regression = '0';
      if (prevX != null && x != null && x < prevX) regression = '1';
      if (x != null) prevX = x;
      r.Regression = regression;
    }
    // Total viewing time for this text (first to last fixation).
    const times = group.map(r => getRowTime(r)).filter(t => t > 0);
    const textTotalViewingMs = times.length >= 2 ? String(Math.round(Math.max(...times) - Math.min(...times))) : '';
    for (const r of group) r.text_total_viewing_time_ms = textTotalViewingMs;
    // Saccade metrics from this fixation to the next within the same item.
    for (let i = 0; i < group.length; i++) {
      const r = group[i];
      r.saccade_start_x = r.mousePositionX;
      r.saccade_start_y = r.mousePositionY;
      r.saccade_start_time = r.responseTime;
      if (i < group.length - 1) {
        const next = group[i + 1];
        const sx = Number(r.mousePositionX);
        const sy = Number(r.mousePositionY);
        const ex = Number(next.mousePositionX);
        const ey = Number(next.mousePositionY);
        r.saccade_end_x = next.mousePositionX;
        r.saccade_end_y = next.mousePositionY;
        r.saccade_end_time = next.responseTime;
        const lenPx = (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(ex) && Number.isFinite(ey))
          ? Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2)
          : null;
        r.saccade_length_px = lenPx != null ? lenPx.toFixed(2) : '';
      } else {
        r.saccade_end_x = '';
        r.saccade_end_y = '';
        r.saccade_end_time = '';
        r.saccade_length_px = '';
      }
    }
  }

  const rowsForCsv = rowsWithMeta.map(row => {
    const out = {};
    const val = (key) => (row[key] != null && row[key] !== '' ? row[key] : '');
    out.participant_id = pid;
    out.SONAId = val('SONAId');
    out.Condition = val('Condition');
    applyOneStopExportFields(out, row, oneStopByItem);
    out.ItemId = val('ItemId');
    out.text_presentation_order = row.presentation_order != null && row.presentation_order !== '' ? Number(row.presentation_order) : '';
    out.WordIndex = row.Index != null && row.Index !== '' ? row.Index : '';
    out.Word = outOfBoundsWordForIndex(row.Index, val('Word'));
    out.responseTime = val('responseTime');
    out.mousePositionX = val('mousePositionX');
    out.mousePositionY = val('mousePositionY');
    out.Regression = val('Regression');
    out.clickDurationMs = val('clickDurationMs');
    out.relativeXInWord = val('relativeXInWord');
    out.relativeYInWord = val('relativeYInWord');
    out.wordPositionTop = val('wordPositionTop');
    out.wordPositionLeft = val('wordPositionLeft');
    out.wordPositionBottom = val('wordPositionBottom');
    out.wordPositionRight = val('wordPositionRight');
    out.line_number = val('line_number');
    out.position_in_line = val('position_in_line');
    out.response = val('response');
    out.response_correct = val('response_correct');
    out.position_in_text = val('position_in_text');
    out.text_total_viewing_time_ms = val('text_total_viewing_time_ms');
    out.saccade_start_x = val('saccade_start_x');
    out.saccade_start_y = val('saccade_start_y');
    out.saccade_start_time = val('saccade_start_time');
    out.saccade_end_x = val('saccade_end_x');
    out.saccade_end_y = val('saccade_end_y');
    out.saccade_end_time = val('saccade_end_time');
    out.saccade_length_px = val('saccade_length_px');
    out.device = val('device');
    out.hand = val('hand');
    out.experiment_date = val('experiment_date');
    out.experiment_start_date = val('experiment_start_date');
    out.experiment_start_time = val('experiment_start_time');
    out.experiment_start_clock_time = val('experiment_start_clock_time');
    out.experiment_start_time_local = val('experiment_start_time_local');
    out.experiment_end_date = val('experiment_end_date');
    out.experiment_end_time = val('experiment_end_time');
    out.experiment_end_clock_time = val('experiment_end_clock_time');
    out.experiment_end_time_local = val('experiment_end_time_local');
    out.experiment_duration = val('experiment_duration');
    out.experiment_duration_ms = val('experiment_duration_ms');
    out.experiment =
      val('experiment') ||
      (magpieConfig && (magpieConfig.experimentName || magpieConfig.experimentId || magpieConfig.name || 'MoTR_Click'));
    return out;
  });

  rowsForCsv.sort((a, b) => {
    const poA = a.text_presentation_order === '' ? Infinity : Number(a.text_presentation_order);
    const poB = b.text_presentation_order === '' ? Infinity : Number(b.text_presentation_order);
    if (poA !== poB) return poA - poB;
    const rtA = a.responseTime === '' ? Infinity : Number(a.responseTime);
    const rtB = b.responseTime === '' ? Infinity : Number(b.responseTime);
    return rtA - rtB;
  });

  return stringify(rowsForCsv, {
    columns: FIXATION_CSV_COLUMNS,
    header: true
  });
}

function buildInterestAreaReport(allRows, participantId, expData, sessionTimes) {
  const hoverRowsAll = allRows.filter(isHoverAssociationRow);
  const fixationRows = filterValidHoverRows(hoverRowsAll);
  const rawSampleRowsAll = allRows.filter(isRawSampleRow);
  if (fixationRows.length === 0 && rawSampleRowsAll.length === 0) return '';
  const pid = participantId != null && String(participantId) ? String(participantId) : '';
  const expFields = getExpDataFields(expData, allRows, sessionTimes);
  const responseByItem = getResponseByItem(allRows);
  const responseCorrectByItem = getResponseCorrectByItem(allRows);
  const oneStopByItem = getOneStopMetadataByItem(allRows);

  const byItem = {};
  for (const row of fixationRows) {
    const id = row.ItemId != null && row.ItemId !== '' ? row.ItemId : 'NO_ITEM';
    if (!byItem[id]) byItem[id] = [];
    byItem[id].push(row);
  }

  const byItemAllRows = {};
  for (const row of allRows) {
    if (!isRawSampleRow(row) && !isHoverAssociationRow(row)) continue;
    const id = row.ItemId != null && row.ItemId !== '' ? row.ItemId : 'NO_ITEM';
    if (!byItemAllRows[id]) byItemAllRows[id] = [];
    byItemAllRows[id].push(row);
  }

  for (const itemId of Object.keys(byItemAllRows)) {
    if (!byItem[itemId]) byItem[itemId] = [];
  }

  const reportRows = [];
  const firstTimeByItem = {};
  for (const itemId of Object.keys(byItemAllRows)) {
    const rowsForItem = byItemAllRows[itemId];
    firstTimeByItem[itemId] = Math.min(...rowsForItem.map(r => getRowTime(r) || 0));
  }
  const presentationOrderByItem = {};
  for (const itemId of Object.keys(byItemAllRows)) {
    const rowsForItem = byItemAllRows[itemId];
    const firstWithOrder = rowsForItem.find(r => r.presentation_order != null && r.presentation_order !== '');
    if (firstWithOrder) {
      const val = Number(firstWithOrder.presentation_order);
      if (!Number.isNaN(val)) presentationOrderByItem[itemId] = val;
    }
  }

  // Sort items primarily by text presentation order, fallback to first-click time.
  const sortedItemIds = Object.keys(byItemAllRows).sort((a, b) => {
    const pa = presentationOrderByItem[a];
    const pb = presentationOrderByItem[b];
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    const ta = firstTimeByItem[a] || 0;
    const tb = firstTimeByItem[b] || 0;
    return ta - tb;
  });

  let itemOrderCounter = 0;
  for (const itemId of sortedItemIds) {
    itemOrderCounter += 1;
    const rows = byItem[itemId] || [];
    const itemAllRows = byItemAllRows[itemId] || [];
    const fromTotal = Math.max(0, ...itemAllRows.map(r => r.totalWordsInItem).filter(w => w != null && w > 0));
    const fromMaxIndex = Math.max(0, ...itemAllRows.map(r => (r.Index != null && r.Index >= 1 ? Number(r.Index) : 0)));
    const totalWords = fromTotal > 0 ? fromTotal : fromMaxIndex;

    rows.sort((a, b) => getRowTime(a) - getRowTime(b));
    const times = itemAllRows.map(r => getRowTime(r)).filter(t => t > 0);
    const textTotalViewingMs = times.length >= 2 ? Math.round(Math.max(...times) - Math.min(...times)) : '';

    const rawSampleRows = itemAllRows.filter(isRawSampleRow);
    const hoverRows = filterValidHoverRows(itemAllRows.filter(isHoverAssociationRow));
    const wilcoxAssociations = buildWilcoxAssociationsForItem(rawSampleRows, hoverRows);
    const wilcoxGoPastByWord = computeWilcoxGoPastByWord(wilcoxAssociations);

    const wordIndices = new Set();
    for (let i = 1; i <= totalWords; i++) wordIndices.add(i);
    for (const r of rows) if (r.Index != null && r.Index >= 1) wordIndices.add(Number(r.Index));

    for (const wordIndex of [...wordIndices].sort((a, b) => a - b)) {
      const clicks = rows.filter(r => r.Index != null && Number(r.Index) === wordIndex);
      const clickCount = clicks.length;
      const skipped = clickCount === 0;

      const firstClick = clicks[0];
      const lastClick = clicks[clicks.length - 1];
      const sumHoverDuration = (eventRows) => eventRows.reduce(
        (sum, row) => sum + (getHoverDurationMs(row) || 0),
        0
      );

      let firstClickX = '';
      let firstClickY = '';
      let firstClickDurationMs = '';
      let totalDurationMs = '';
      let nextClickRegression = '';
      let firstRunDwellMs = '';
      let goPastTimeMs = '';
      let wilcoxFirstPassMs = '';
      let regressionIn = '';
      let regressionOut = '';
      let xDistanceFromPreviousClick = '';
      let xDistanceFromPreviousClickChars = '';
      let firstClickXFromWordLeftChars = '';
      let firstClickXFromWordCenterChars = '';
      let firstClickXFromLineStartPx = '';
      let firstClickXFromLineStartChars = '';
      let wordText = '';
      let positionInText = wordIndex;
      let lineNumber = '';
      let positionInLine = '';

      if (firstClick) {
        if (firstClick.line_number != null && firstClick.line_number !== '') lineNumber = firstClick.line_number;
        if (firstClick.position_in_line != null && firstClick.position_in_line !== '') positionInLine = firstClick.position_in_line;
        firstClickX = firstClick.mousePositionX;
        firstClickY = firstClick.mousePositionY;
        const firstDuration = getHoverDurationMs(firstClick);
        firstClickDurationMs = firstDuration != null ? firstDuration : '';
        totalDurationMs = sumHoverDuration(clicks);
        wordText = firstClick.Word != null ? firstClick.Word : '';

        const wordLeft = firstClick.wordPositionLeft;
        const wordRight = firstClick.wordPositionRight;
        const wordLen = (firstClick.Word && firstClick.Word.length) || 1;
        const charWidth = (wordRight != null && wordLeft != null && wordRight > wordLeft)
          ? (wordRight - wordLeft) / wordLen
          : null;
        if (charWidth && charWidth > 0) {
          firstClickXFromWordLeftChars = ((firstClick.mousePositionX - wordLeft) / charWidth).toFixed(4);
          const centerX = (wordLeft + wordRight) / 2;
          firstClickXFromWordCenterChars = ((firstClick.mousePositionX - centerX) / charWidth).toFixed(4);
        }

        if (firstClick.xFromLineStartPx != null) {
          firstClickXFromLineStartPx = Number(firstClick.xFromLineStartPx).toFixed(2);
        }
        if (firstClick.xFromLineStartChars != null) {
          firstClickXFromLineStartChars = Number(firstClick.xFromLineStartChars).toFixed(4);
        }
        // Fallback: derive line-start distances from observed clicked words on same line.
        if (firstClickXFromLineStartPx === '' && firstClick.line_number != null && firstClick.line_number !== '') {
          const sameLine = rows.filter(r =>
            r.line_number != null &&
            r.line_number !== '' &&
            String(r.line_number) === String(firstClick.line_number) &&
            r.wordPositionLeft != null &&
            r.wordPositionLeft !== ''
          );
          if (sameLine.length > 0) {
            const lineStartX = Math.min(...sameLine.map(r => Number(r.wordPositionLeft)).filter(v => Number.isFinite(v)));
            if (Number.isFinite(lineStartX) && firstClick.mousePositionX != null && firstClick.mousePositionX !== '') {
              const xFromLineStart = Number(firstClick.mousePositionX) - lineStartX;
              if (Number.isFinite(xFromLineStart)) {
                firstClickXFromLineStartPx = xFromLineStart.toFixed(2);
                if (charWidth && charWidth > 0) {
                  firstClickXFromLineStartChars = (xFromLineStart / charWidth).toFixed(4);
                }
              }
            }
          }
        }

        const prevClicks = rows.filter(r => getRowTime(r) < getRowTime(firstClick) && r.Index != null && Number(r.Index) !== wordIndex);
        const prevClick = prevClicks.length ? prevClicks[prevClicks.length - 1] : null;
        if (prevClick != null && prevClick.mousePositionX != null) {
          xDistanceFromPreviousClick = (firstClick.mousePositionX - prevClick.mousePositionX).toFixed(2);
          if (charWidth && charWidth > 0) {
            xDistanceFromPreviousClickChars = (Number(xDistanceFromPreviousClick) / charWidth).toFixed(4);
          }
        }

        const nextClicks = rows.filter(r => getRowTime(r) > getRowTime(lastClick) && r.Index != null && Number(r.Index) !== wordIndex);
        const nextClick = nextClicks.length ? nextClicks[0] : null;
        if (nextClick != null && nextClick.Index != null) {
          nextClickRegression = Number(nextClick.Index) < wordIndex ? '1' : '0';
        }
        // IA_FIRST_RUN_DWELL_TIME (gaze duration): sum of valid associations on this word before first exit.
        let inFirstRun = false;
        let firstRunDone = false;
        let firstRunSum = 0;
        for (const r of rows) {
          const idx = r.Index != null ? Number(r.Index) : null;
          if (idx === wordIndex) {
            if (!firstRunDone) {
              inFirstRun = true;
              firstRunSum += getHoverDurationMs(r) || 0;
            }
          } else {
            if (inFirstRun) firstRunDone = true;
            inFirstRun = false;
          }
        }
        if (firstRunSum > 0) firstRunDwellMs = String(Math.round(firstRunSum));
        // Go-past time: sum of valid associations on this word until first forward exit (to a later word).
        const firstClickTimeOnWord = Math.min(...clicks.map(c => getRowTime(c) || Infinity));
        const firstForwardExitTime = Math.min(
          ...rows
            .filter(r => r.Index != null && Number(r.Index) > wordIndex && getRowTime(r) > firstClickTimeOnWord)
            .map(r => getRowTime(r) || Infinity)
        );
        if (Number.isFinite(firstForwardExitTime)) {
          const gpSum = sumHoverDuration(
            clicks.filter(c => getRowTime(c) < firstForwardExitTime)
          );
          goPastTimeMs = String(Math.round(gpSum));
        } else {
          goPastTimeMs = totalDurationMs !== '' ? String(Math.round(totalDurationMs)) : '';
        }
        // IA_REGRESSION_IN: any entry into this word from a later word.
        for (const c of clicks) {
          const prevClicksAll = rows.filter(r => getRowTime(r) < getRowTime(c));
          const prev = prevClicksAll.length ? prevClicksAll[prevClicksAll.length - 1] : null;
          if (prev != null && prev.Index != null && Number(prev.Index) > wordIndex) {
            regressionIn = '1';
            break;
          }
        }
        if (regressionIn === '') regressionIn = '0';
        // IA_REGRESSION_OUT: any saccade from this word to an earlier word.
        for (const c of clicks) {
          const nextAll = rows.filter(r => getRowTime(r) > getRowTime(c));
          const next = nextAll.length ? nextAll[0] : null;
          if (next != null && next.Index != null && Number(next.Index) < wordIndex) {
            regressionOut = '1';
            break;
          }
        }
        if (regressionOut === '') regressionOut = '0';
      }

      if (wilcoxGoPastByWord.has(wordIndex)) {
        wilcoxFirstPassMs = String(wilcoxGoPastByWord.get(wordIndex));
      }

      // If there was no click on this word (skipped), we currently leave `word` empty.

      const experiment = (itemAllRows[0] && itemAllRows[0].Experiment) != null ? itemAllRows[0].Experiment : '';
      const condition = (itemAllRows[0] && itemAllRows[0].Condition) != null ? itemAllRows[0].Condition : '';

      const response = responseByItem[itemId] != null ? responseByItem[itemId] : '';
      const responseCorrect = responseCorrectByItem[itemId] != null ? responseCorrectByItem[itemId] : '';
      const metaSource = firstClick || itemAllRows[0] || { ItemId: itemId, Condition: condition };
      const reportRow = {
        participant_id: pid,
        response,
        response_correct: responseCorrect,
        device: expFields.device,
        hand: expFields.hand,
        experiment_date: expFields.experiment_date,
        experiment_start_date: expFields.experiment_start_date,
        experiment_start_time: expFields.experiment_start_time,
        experiment_start_clock_time: expFields.experiment_start_clock_time,
        experiment_start_time_local: expFields.experiment_start_time_local,
        SONAId: expFields.SONAId,
        experiment_end_date: expFields.experiment_end_date,
        experiment_end_time: expFields.experiment_end_time,
        experiment_end_clock_time: expFields.experiment_end_clock_time,
        experiment_end_time_local: expFields.experiment_end_time_local,
        experiment_duration: expFields.experiment_duration,
        experiment_duration_ms: expFields.experiment_duration_ms,
        experiment: expFields.experiment || (magpieConfig && (magpieConfig.experimentName || magpieConfig.experimentId || magpieConfig.name || 'MoTR_Click')),
        Experiment: experiment,
        Condition: condition,
        ItemId: itemId,
        text_presentation_order: presentationOrderByItem[itemId] != null ? presentationOrderByItem[itemId] : itemOrderCounter,
        position_in_text: positionInText,
        line_number: lineNumber,
        position_in_line: positionInLine,
        word_index: wordIndex,
        word: wordText,
        click_count: clickCount,
        skipped: skipped ? '1' : '0',
        IA_FIRST_RUN_DWELL_TIME: firstRunDwellMs,
        IA_DWELL_TIME: totalDurationMs,
        IA_FIRST_FIXATION_DURATION: firstClickDurationMs,
        go_past_time_ms: goPastTimeMs,
        'Wilcox go past': wilcoxFirstPassMs,
        IA_REGRESSION_IN: regressionIn,
        IA_REGRESSION_OUT: regressionOut,
        text_total_viewing_time_ms: textTotalViewingMs === '' ? '' : String(textTotalViewingMs),
        first_click_x: firstClickX,
        first_click_y: firstClickY,
        first_click_duration_ms: firstClickDurationMs,
        total_duration_ms: totalDurationMs,
        next_click_regression: nextClickRegression,
        x_distance_from_previous_click_px: xDistanceFromPreviousClick,
        x_distance_from_previous_click_chars: xDistanceFromPreviousClickChars,
        first_click_x_from_word_left_chars: firstClickXFromWordLeftChars,
        first_click_x_from_word_center_chars: firstClickXFromWordCenterChars,
        first_click_x_from_line_start_px: firstClickXFromLineStartPx,
        first_click_x_from_line_start_chars: firstClickXFromLineStartChars
      };
      applyOneStopExportFields(reportRow, metaSource, oneStopByItem);
      reportRows.push(reportRow);
    }
  }

  if (reportRows.length === 0) return '';

  const rowsForCsv = reportRows.map(row => {
    const val = (key) => (row[key] != null && row[key] !== '' ? row[key] : '');
    return {
      participant_id: val('participant_id'),
      SONAId: val('SONAId'),
      Condition: val('Condition'),
      onestop_level: val('onestop_level'),
      onestop_article_number: val('onestop_article_number'),
      onestop_paragraph_number: val('onestop_paragraph_number'),
      ItemId: val('ItemId'),
      text_presentation_order: val('text_presentation_order'),
      word_index: val('word_index'),
      WordIndex: val('word_index'),
      // Only report a word when that word had at least one click.
      word: (row.click_count != null && Number(row.click_count) > 0) ? val('word') : '',
      response: val('response'),
      response_correct: val('response_correct'),
      line_number: val('line_number'),
      position_in_line: val('position_in_line'),
      click_count: val('click_count'),
      skipped: val('skipped'),
      IA_FIRST_RUN_DWELL_TIME: val('IA_FIRST_RUN_DWELL_TIME'),
      IA_DWELL_TIME: val('IA_DWELL_TIME'),
      IA_FIRST_FIXATION_DURATION: val('IA_FIRST_FIXATION_DURATION'),
      go_past_time_ms: val('go_past_time_ms'),
      'Wilcox go past': val('Wilcox go past'),
      IA_REGRESSION_IN: val('IA_REGRESSION_IN'),
      IA_REGRESSION_OUT: val('IA_REGRESSION_OUT'),
      text_total_viewing_time_ms: val('text_total_viewing_time_ms'),
      first_click_x: val('first_click_x'),
      first_click_y: val('first_click_y'),
      first_click_duration_ms: val('first_click_duration_ms'),
      total_duration_ms: val('total_duration_ms'),
      next_click_regression: val('next_click_regression'),
      x_distance_from_previous_click_px: val('x_distance_from_previous_click_px'),
      x_distance_from_previous_click_chars: val('x_distance_from_previous_click_chars'),
      first_click_x_from_word_left_chars: val('first_click_x_from_word_left_chars'),
      first_click_x_from_word_center_chars: val('first_click_x_from_word_center_chars'),
      first_click_x_from_line_start_px: val('first_click_x_from_line_start_px'),
      first_click_x_from_line_start_chars: val('first_click_x_from_line_start_chars'),
      device: val('device'),
      hand: val('hand'),
      experiment_date: val('experiment_date'),
      experiment_start_date: val('experiment_start_date'),
      experiment_start_time: val('experiment_start_time'),
      experiment_start_clock_time: val('experiment_start_clock_time'),
      experiment_start_time_local: val('experiment_start_time_local'),
      experiment_end_date: val('experiment_end_date'),
      experiment_end_time: val('experiment_end_time'),
      experiment_end_clock_time: val('experiment_end_clock_time'),
      experiment_end_time_local: val('experiment_end_time_local'),
      experiment_duration: val('experiment_duration'),
      experiment_duration_ms: val('experiment_duration_ms'),
      experiment: val('experiment')
    };
  });

  rowsForCsv.sort((a, b) => {
    const poA = a.text_presentation_order === '' ? Infinity : Number(a.text_presentation_order);
    const poB = b.text_presentation_order === '' ? Infinity : Number(b.text_presentation_order);
    if (poA !== poB) return poA - poB;
    const wiA = a.word_index === '' ? -1 : Number(a.word_index);
    const wiB = b.word_index === '' ? -1 : Number(b.word_index);
    return wiA - wiB;
  });

  return stringify(rowsForCsv, {
    columns: INTEREST_AREA_CSV_COLUMNS,
    header: true
  });
}

function getResultsFolderName(participantId) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const id = participantId && String(participantId) ? String(participantId) : 'unknown';
  return `motr_results_${id}_${datePart}`;
}

const SESSION_RAW_METADATA_PREFIXES = ['demo_', 'glb_'];
const SESSION_RAW_METADATA_KEYS = new Set([
  'ProlificId',
  'ProlificID',
  'ParticipantId',
  'SubjectId',
  'SubjectID',
  'SONAId',
  'SonaId',
  'study_key',
  'experiment_start_time',
  'experiment_end_time',
  'experiment_duration',
  'experiment_start_date',
  'experiment_date',
  'experiment_start_clock_time',
  'experiment_start_time_local',
  'experiment_end_date',
  'device',
  'hand',
  'cambridge_score',
  'cambridge_max',
  'cambridge_cefr',
  'onestop_level_pair',
  'onestop_level_block_order',
  'onestop_level_assignment_rule',
  'onestop_reading_article_count',
  'onestop_reading_trial_count',
  'onestop_article_selection_mode',
  'onestop_manual_article_numbers',
]);

const RAW_TRIAL_LOCAL_KEYS = new Set([
  'ItemId',
  'item_id',
  'presentation_order',
  'Index',
  'Word',
  'mousePositionX',
  'mousePositionY',
  'sampleTimeMs',
  'revealMode',
  'clickDurationMs',
  'hoverDurationMs',
  'relativeXInWord',
  'relativeYInWord',
  'totalWordsInItem',
  'allWords',
  'wordPositionTop',
  'wordPositionLeft',
  'wordPositionBottom',
  'wordPositionRight',
  'line_number',
  'position_in_line',
  'response',
  'response_correct',
  'recordType',
  'onestop_level',
  'onestop_article_number',
  'onestop_paragraph_number',
  'onestop_block_level',
  'onestop_paragraph_index',
  'cambridge_item',
  'cambridge_selected',
  'cambridge_correct_answer',
  'cambridge_item_correct',
  'source',
  'responseTime',
]);

function isSessionMetadataKey(key) {
  if (!key) return false;
  if (SESSION_RAW_METADATA_KEYS.has(key)) return true;
  return SESSION_RAW_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function copySessionMetadataValue(target, key, value) {
  if (!isSessionMetadataKey(key)) return;
  if (value == null || value === '') return;
  if (target[key] == null || target[key] === '') target[key] = value;
}

/** Session-level fields for partial checkpoint raw.csv (Prolific ID, demographics, Cambridge summary). */
function collectSessionMetadataForRawExport(allRows, expData) {
  const meta = {};
  const exp = expData && typeof expData === 'object' ? expData : {};
  for (const key of Object.keys(exp)) {
    copySessionMetadataValue(meta, key, exp[key]);
  }

  for (const row of allRows || []) {
    if (!row || typeof row !== 'object') continue;
    if (row.source === 'demographics_onestop') {
      for (const key of Object.keys(row)) {
        if (key.startsWith('demo_')) copySessionMetadataValue(meta, key, row[key]);
      }
    }
    if (row.source === 'cambridge_general_english_summary') {
      for (const key of Object.keys(row)) {
        copySessionMetadataValue(meta, key, row[key]);
      }
    }
    if (row.source === 'welcome') {
      for (const key of ['ProlificId', 'ProlificID', 'SubjectId', 'SubjectID', 'SONAId', 'SonaId', 'study_key']) {
        copySessionMetadataValue(meta, key, row[key]);
      }
    }
    for (const key of ['ProlificId', 'ProlificID', 'ParticipantId', 'SubjectId', 'SubjectID', 'SONAId', 'SonaId']) {
      copySessionMetadataValue(meta, key, row[key]);
    }
  }
  return meta;
}

function stampSessionMetadataOnRawRows(rows, sessionMetadata) {
  if (!sessionMetadata || !Object.keys(sessionMetadata).length) return rows;
  return (rows || []).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const out = { ...row };
    for (const [key, value] of Object.entries(sessionMetadata)) {
      if (RAW_TRIAL_LOCAL_KEYS.has(key)) continue;
      if (out[key] == null || out[key] === '') out[key] = value;
    }
    return out;
  });
}

/** Partial-upload raw.csv: stamp session metadata onto per-trial rows without changing complete export. */
function buildRawTrialDataCsvForCheckpoint(trialRows, allRows, expData, sessionTimes) {
  const sessionMetadata = collectSessionMetadataForRawExport(allRows, expData);
  const stampedRows = stampSessionMetadataOnRawRows(trialRows, sessionMetadata);
  return buildRawTrialDataCsv(stampedRows, expData, sessionTimes);
}

const RAW_EXPERIMENT_FIELD_KEYS = [
  'experiment_date',
  'experiment_start_date',
  'experiment_start_time',
  'experiment_start_clock_time',
  'experiment_start_time_local',
  'experiment_end_date',
  'experiment_end_time',
  'experiment_end_clock_time',
  'experiment_end_time_local',
  'experiment_duration',
  'experiment_duration_ms',
];

function isBogusExperimentStartValue(key, value) {
  if (value == null || value === '') return true;
  if (key === 'experiment_start_time') return !parseExperimentStartInstant(value);
  if (key === 'experiment_start_date' || key === 'experiment_date') {
    return String(value).startsWith('1970-01-01');
  }
  if (key === 'experiment_start_time_local' || key === 'experiment_start_clock_time') {
    return String(value).startsWith('1970-01-01');
  }
  return false;
}

function stampExperimentFieldsOnRawRow(out, expFields) {
  if (!out || !expFields) return out;
  for (const key of RAW_EXPERIMENT_FIELD_KEYS) {
    const replacement = expFields[key];
    if (replacement == null || replacement === '') continue;
    if (isBogusExperimentStartValue(key, out[key]) || out[key] == null || out[key] === '') {
      out[key] = replacement;
    }
  }
  return out;
}

function buildRawTrialDataCsv(allRows, expData, sessionTimes = null) {
  if (!Array.isArray(allRows) || allRows.length === 0) return '';
  const excludeKeys = new Set(['allWords']);
  const oneStopByItem = getOneStopMetadataByItem(allRows);
  const expFields = getExpDataFields(expData || {}, allRows, sessionTimes);
  const sonaId = pickNonEmptyString(
    expData && expData.SONAId,
    expData && expData.SonaId,
    expData && expData.SubjectID,
    expData && expData.SubjectId
  );
  const columns = [];
  for (const row of allRows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (excludeKeys.has(key)) continue;
      if (!columns.includes(key)) columns.push(key);
    }
  }
  for (const key of RAW_EXPERIMENT_FIELD_KEYS) {
    if (!columns.includes(key)) columns.push(key);
  }
  if (columns.length === 0) return '';
  let orderedColumns = orderRawTrialColumns(columns);
  if (sonaId) {
    for (const key of PARTICIPANT_ID_FIELDS) {
      if (!orderedColumns.includes(key)) orderedColumns.push(key);
    }
  }
  const filteredRows = allRows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const out = {};
    for (const key of orderedColumns) {
      out[key] = row[key];
    }
    if (Object.prototype.hasOwnProperty.call(out, 'Word')) {
      out.Word = outOfBoundsWordForIndex(out.Index, out.Word);
    }
    stampParticipantIdFields(out, sonaId);
    applyOneStopExportFields(out, row, oneStopByItem);
    stampExperimentFieldsOnRawRow(out, expFields);
    return out;
  });
  return stringify(filteredRows, { columns: orderedColumns, header: true });
}

export {
  generateUniqueAlphanumericId,
  enrichExpDataWithSonaId,
  buildExperimentStartExpFields,
  parseExperimentStartInstant,
  resolveExperimentStartInstant,
  buildFixationReport,
  buildInterestAreaReport,
  buildRawPositionReport,
  buildRawTrialDataCsv,
  buildRawTrialDataCsvForCheckpoint,
  getResultsFolderName,
  localDateString,
  localTimeString,
  getExpDataFields,
  resolveSonaId,
};
