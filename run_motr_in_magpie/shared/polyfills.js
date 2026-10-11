// Fallbacks for older lab browsers (e.g. Firefox < 69). The build has no Babel/core-js step,
// so anything newer than the browser supports must be patched in here, before other imports run.

// Firefox 63+: used by magpie-base getAllData() when building the results ZIP.
if (typeof Object.fromEntries !== 'function') {
  Object.fromEntries = function fromEntries(entries) {
    const obj = {};
    for (const [key, value] of entries) obj[key] = value;
    return obj;
  };
}

// Firefox 69+: used to schedule checkpoint saves after a reading trial.
if (typeof window !== 'undefined' && typeof window.queueMicrotask !== 'function') {
  window.queueMicrotask = function queueMicrotask(callback) {
    Promise.resolve().then(callback).catch((err) => setTimeout(() => { throw err; }));
  };
}
