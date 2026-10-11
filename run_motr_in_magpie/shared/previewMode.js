/** True when URL requests demographics-only preview (no consent, Cambridge, or reading). */
export function isDemographicsPreviewMode() {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('preview') === 'demographics') return true;
  const hash = window.location.hash.replace(/^#/, '');
  return hash === 'demographics-preview' || hash === 'preview=demographics';
}

/** True when URL requests reading-only preview (instruction + reading trials, no upload). */
export function isReadingPreviewMode() {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('preview') === 'reading') return true;
  const hash = window.location.hash.replace(/^#/, '');
  return hash === 'reading-preview' || hash === 'preview=reading';
}

/** True when the study is running locally without remote services or uploads. */
export function isOfflineMode() {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('offline') === '1') return true;
  return window.location.hash.replace(/^#/, '') === 'offline';
}

/**
 * Offline mode leaves socketUrl empty, so magpie-base installs a proxy socket that sets a
 * "no socket URL" warning as soon as Vue observes it; Screen then overlays that warning on
 * every page. Swap in an inert socket, clear the warning, and drop any later attempt to
 * set it again (other magpie warnings still show).
 */
export function silenceOfflineSocketWarning(magpie) {
  if (!magpie || !isOfflineMode()) return;
  const desc = Object.getOwnPropertyDescriptor(magpie, 'warning');
  if (desc && desc.set && desc.configurable) {
    Object.defineProperty(magpie, 'warning', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(value) {
        if (typeof value === 'string' && /socket url/i.test(value)) return;
        desc.set.call(magpie, value);
      },
    });
  }
  magpie.socket = Object.freeze({});
  magpie.warning = null;
}

/** True when results must not be uploaded or persisted (reading preview implies this). */
export function isNoUploadMode() {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('noUpload') === '1') return true;
  return isReadingPreviewMode();
}
