/**
 * Shell-aware navigation for the document remote.
 *
 * The shell owns the top-level route and listens for `popstate`, so pushing
 * history and re-emitting the event is enough to switch records or remotes
 * without a full page load. The workbench passes `notify: false` for its own
 * query-string updates because React state already matches the new URL.
 *
 * If the history APIs are unavailable, or the call fails (for example in a
 * sandboxed iframe), fall back to a normal browser navigation.
 */
export function navigate(target, options = {}) {
  const href = String(target || '');
  if (!href || typeof window === 'undefined') return false;

  try {
    if (options.replace) {
      window.history.replaceState({}, '', href);
    } else {
      window.history.pushState({}, '', href);
    }
    if (options.notify !== false) {
      if (typeof window.PopStateEvent === 'function') {
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else {
        window.dispatchEvent(new Event('popstate'));
      }
    }
    return true;
  } catch {
    window.location.assign(href);
    return false;
  }
}

/**
 * Builds a shell route for a record in this or another vertical, keeping the
 * shared `?record=` convention. Future cross-vertical links should use this
 * helper instead of hand-building URLs.
 */
export function recordHref(route, recordId) {
  const path = String(route || '').trim();
  const base = path && path !== '/' ? `/${path.replace(/^\/+|\/+$/g, '')}` : '/';
  return recordId ? `${base}?record=${encodeURIComponent(recordId)}` : base;
}
