/**
 * Registry of full-screen overlays (image viewer, story viewer, feed video
 * viewer) so Android's hardware back button closes the top overlay first
 * instead of popping the route underneath it. NativeStartup consults this
 * before falling back to router history.
 */

type Closer = () => void;

const stack: Closer[] = [];

/** Register an open overlay. Returns its unregister function (call on close). */
export function pushOverlay(close: Closer): () => void {
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Close the top-most overlay. Returns false when no overlay is open. */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}
