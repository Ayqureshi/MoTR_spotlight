/**
 * EyeLink WebLink synchronisation (offline lab sessions).
 *
 * - Every sync event and raw mouse sample carries epoch_time_ms (display-PC wall clock, ms).
 * - At passage start / question the page URL hash changes to #motr_pNN_start / #motr_pNN_question.
 *   WebLink logs URL changes in the EDF with tracker timestamps, so the offline merge script
 *   (offline_kit/sync/merge_weblink.py) can match the two clocks.
 * - Word boxes are converted to screen pixels (what EyeLink uses) and exported as .ias files.
 */
import { isOfflineMode } from './previewMode';
import { getResultsSession } from './resultsSession';

/** Wall-clock time in ms with sub-ms resolution where the browser allows it. */
export function nowEpochMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    const origin = performance.timeOrigin
      || (performance.timing && performance.timing.navigationStart);
    if (origin) return Math.round((origin + performance.now()) * 1000) / 1000;
  }
  return Date.now();
}

// Offset of the page viewport on the screen, in CSS px. Mouse events give it exactly
// (screenX - clientX); before any mouse event we fall back to browser hints.
let viewportOffsetFromMouse = null;
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    viewportOffsetFromMouse = { x: e.screenX - e.clientX, y: e.screenY - e.clientY };
  }, { capture: true, passive: true });
}

export function getScreenGeometry() {
  const w = typeof window !== 'undefined' ? window : {};
  const scr = w.screen || {};
  const dpr = w.devicePixelRatio || 1;
  let offset;
  let method;
  if (viewportOffsetFromMouse) {
    offset = viewportOffsetFromMouse;
    method = 'mouse_event';
  } else if (typeof w.mozInnerScreenX === 'number') {
    offset = { x: w.mozInnerScreenX, y: w.mozInnerScreenY };
    method = 'mozInnerScreen';
  } else if (w.innerWidth === scr.width && w.innerHeight === scr.height) {
    offset = { x: 0, y: 0 };
    method = 'fullscreen';
  } else {
    const border = Math.max(0, (w.outerWidth - w.innerWidth) / 2);
    offset = { x: (w.screenX || 0) + border, y: (w.screenY || 0) + (w.outerHeight - w.innerHeight) - border };
    method = 'estimated';
  }
  return {
    screen_width_px: Math.round((scr.width || 0) * dpr),
    screen_height_px: Math.round((scr.height || 0) * dpr),
    device_pixel_ratio: dpr,
    viewport_offset_x_css: offset.x,
    viewport_offset_y_css: offset.y,
    viewport_width_css: w.innerWidth,
    viewport_height_css: w.innerHeight,
    viewport_offset_method: method,
  };
}

/** Convert viewport (client) CSS px to physical screen px, the coordinate space of EyeLink gaze. */
export function toScreenPx(x, y, geometry) {
  const g = geometry || getScreenGeometry();
  return {
    x: Math.round((x + g.viewport_offset_x_css) * g.device_pixel_ratio),
    y: Math.round((y + g.viewport_offset_y_css) * g.device_pixel_ratio),
  };
}

function passageTag(trialIndex) {
  return `p${String(trialIndex).padStart(2, '0')}`;
}

/** Interest Area Set (Data Viewer RECTANGLE format) for the words currently on screen. */
function buildIasForPassage(rootEl, geometry) {
  const spans = rootEl ? rootEl.querySelectorAll('.readingText span[data-index]') : [];
  const lines = [];
  spans.forEach((span) => {
    const r = span.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const tl = toScreenPx(r.left, r.top, geometry);
    const br = toScreenPx(r.right, r.bottom, geometry);
    const label = String(span.textContent || '').trim().replace(/\s+/g, '_') || '.';
    lines.push(['RECTANGLE', span.getAttribute('data-index'), tl.x, tl.y, br.x, br.y, label].join('\t'));
  });
  return lines.join('\r\n');
}

/**
 * Record a passage event (PASSAGE_START, PASSAGE_QUESTION, PASSAGE_END), mark the URL for WebLink,
 * and on PASSAGE_START capture the word boxes. Offline mode only; never throws.
 */
export function markPassageEvent(vm, eventName, trialIndex, itemId) {
  if (!isOfflineMode() || !vm || trialIndex == null) return;
  try {
    const epoch = nowEpochMs();
    const geometry = getScreenGeometry();
    const tag = passageTag(trialIndex);
    const suffix = eventName.replace(/^PASSAGE_/, '').toLowerCase();
    const marker = `motr_${tag}_${suffix}`;

    if (eventName !== 'PASSAGE_END' && typeof window !== 'undefined' && window.location) {
      window.location.replace(`#${marker}`);
    }

    const session = getResultsSession(vm);
    if (session) {
      if (!Array.isArray(session.syncEvents)) session.syncEvents = [];
      session.syncEvents.push({
        event: eventName,
        marker,
        trial_index: trialIndex,
        ItemId: itemId != null ? itemId : '',
        epoch_time_ms: epoch,
        performance_now_ms: typeof performance !== 'undefined' ? performance.now() : '',
        ...geometry,
      });
      // Capture word boxes at start, then again when the question is requested (the text is
      // still in the DOM then, and the mouse has moved, so the screen offset is exact).
      if (eventName === 'PASSAGE_START' || eventName === 'PASSAGE_QUESTION') {
        const ias = buildIasForPassage(vm.$el, geometry);
        if (!session.iasFiles) session.iasFiles = {};
        const name = `ias_passage_${String(trialIndex).padStart(2, '0')}.ias`;
        if (ias || !session.iasFiles[name]) session.iasFiles[name] = ias;
      }
    }
  } catch (err) {
    console.warn('Sync marker failed:', err);
  }
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** sync_events.csv + one .ias per passage, for inclusion in offline saves. */
export function buildSyncFiles(vm) {
  const session = getResultsSession(vm);
  if (!session || !Array.isArray(session.syncEvents) || session.syncEvents.length === 0) return [];
  const columns = Object.keys(session.syncEvents[0]);
  const csv = [columns.join(',')]
    .concat(session.syncEvents.map((row) => columns.map((c) => csvCell(row[c])).join(',')))
    .join('\r\n');
  const files = [{ name: 'sync_events.csv', content: csv }];
  for (const [name, content] of Object.entries(session.iasFiles || {})) {
    if (content) files.push({ name, content });
  }
  return files;
}
