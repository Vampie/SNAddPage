/**
 * Button presses, recorded by a listener registered in index.js right after registerButton.
 * A listener registered in App only got presses replayed for 1 s (SDK), and on the device
 * (v0.0.2) App never received the press at all.
 */

let count = 0;
const listeners = new Set<() => void>();

/** When index.js ran: shows on screen whether PluginHost restarted the plugin. */
export const startedAt = new Date();

export function recordPress(): void {
  count++;
  listeners.forEach(listener => listener());
}

export function pressCount(): number {
  return count;
}

/** Calls `listener` after every press; returns the unsubscribe function. */
export function onPress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
