// Being told, rather than remembering to look.
//
// A notification that arrives while the book is shut cannot come from the
// book — a page that is not open cannot do anything. It has to be *pushed*
// to the device by something that is awake, which for this book is a
// scheduled job in the same GitHub repository that publishes it. Free, and
// already there.
//
// So this file does the phone's half: asks permission, subscribes to the
// browser's push service, and hands back one line to paste into the
// repository's secrets. The job's half is `scripts/send-push.js`.
//
// The line carries three things the job needs and nothing else: where to
// push, what is held, and the price key to value it with. No passphrase, no
// account number, nothing sealed — none of which the job has any use for.

import { state } from './store.js';
import { symbolsHeld, formatShares } from './core/holdings.js';

// The public half of the signing key. It is meant to be public — it is how
// the browser's push service recognises pushes as coming from this book.
export const VAPID_PUBLIC = 'BADN92uRc1xhfprnNWrW62jwyaFxbe-LtEAoz9AjTLklkYPE2pZOm0s_asQzl_9pKh0xm0n7iZ9nHYWtwUoANZg';

export function pushAvailable() {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function pushPermission() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

// base64url → the Uint8Array the PushManager wants.
function decodeKey(base64url) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushAvailable()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

// Asks, then subscribes. Permission has to be asked for from a real tap, so
// this is only ever called from a button.
export async function enableNotifications() {
  if (!pushAvailable()) return { ok: false, error: 'This browser can’t be told anything. Install the book to your home screen and try from there.' };

  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    return { ok: false, error: 'Notifications are turned off for this book. Android’s own settings are the only place that can be undone.' };
  }
  if (permission !== 'granted') return { ok: false, error: 'Not now, then. The button is here whenever.' };

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      // Android will not allow a silent push, and this book has no use for
      // one anyway: every push it sends is something worth reading.
      userVisibleOnly: true,
      applicationServerKey: decodeKey(VAPID_PUBLIC),
    });
  }
  return { ok: true, subscription };
}

export async function disableNotifications() {
  const subscription = await currentSubscription();
  if (subscription) await subscription.unsubscribe();
}

// One line for the repository's secrets.
//
// Holdings go in it because the job has to know what to value, and they
// change rarely — which is the whole premise of this book. When they do
// change, the line is generated again and pasted again.
export function watchLine(subscription) {
  if (!subscription) return '';
  const holdings = [];
  for (const account of state.accounts) {
    for (const position of account.positions ?? []) {
      holdings.push({ s: position.symbol, q: formatShares(position.shares) });
    }
  }
  const payload = {
    v: 1,
    sub: subscription.toJSON ? subscription.toJSON() : subscription,
    holdings,
    key: state.settings.priceKey || '',
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

// What the line is about to say, so it can be shown before it is copied.
export function watchSummary() {
  const held = symbolsHeld(state.accounts).length;
  return {
    held,
    hasKey: Boolean(state.settings.priceKey),
  };
}
