// Browser stub for `@tauri-apps/api/window`.
//
// The Svelte components only call these APIs when Tauri's `__TAURI_INTERNALS__`
// global exists. In the web build it never does, so these stubs are only needed
// to satisfy the import and are never invoked at runtime.

export interface Monitor {
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
  scaleFactor: number;
}

export function getCurrentWindow() {
  return {
    startResizeDragging: async () => {},
    startDragging: async () => {},
    scaleFactor: async () => 1,
    innerSize: async () => ({ width: 0, height: 0 }),
  };
}

export async function currentMonitor(): Promise<Monitor | null> {
  return null;
}
