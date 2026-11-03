import { useSyncExternalStore } from 'react';

const query = window.matchMedia('(max-width: 760px)');

function subscribe(listener: () => void) {
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** Same breakpoint as the `phone` variant in styles/app.css. */
export const useIsPhone = () => useSyncExternalStore(subscribe, () => query.matches);
