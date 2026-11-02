/** Holds the File that should be loaded when the editor route mounts. */
let pending: File | null = null;

export function setPendingEditorFile(f: File | null) {
  pending = f;
}

export function takePendingEditorFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}
