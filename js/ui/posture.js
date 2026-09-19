// Which way the hinge runs on a folding phone.
//
// Chrome reports two viewport segments only while the device is half folded
// (book or tabletop posture). Flat or closed reports one, so every posture
// layout is additive: anything that can't report segments simply stays on the
// normal layout. The posture is mirrored onto <html data-posture> so CSS can
// place content and dialogs on one side of the crease.

const BOOK = '(horizontal-viewport-segments: 2)';
const TABLETOP = '(vertical-viewport-segments: 2)';

export function currentPosture() {
  if (typeof matchMedia !== 'function') return 'flat';
  // An unknown media feature never matches, so old browsers fall through.
  if (matchMedia(BOOK).matches) return 'book';
  if (matchMedia(TABLETOP).matches) return 'tabletop';
  return 'flat';
}

export function watchPosture(onChange) {
  const apply = () => {
    const posture = currentPosture();
    const root = document.documentElement;
    if (root.dataset.posture === posture) return;
    root.dataset.posture = posture;
    onChange?.(posture);
  };
  apply();
  for (const query of [BOOK, TABLETOP]) matchMedia(query).addEventListener?.('change', apply);
  // Folding resizes the page, and Chrome fires segmentschange where supported.
  window.viewport?.addEventListener?.('segmentschange', apply);
  window.addEventListener('resize', apply);
  return apply;
}
