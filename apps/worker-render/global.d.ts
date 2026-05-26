interface SceneHandle {
  isReady: () => boolean;
  capture: () => string | null;
  waitForSettled: (opts?: { settleMs?: number; timeoutMs?: number }) => Promise<void>;
  updateParams?: (p: {
    center: { lat: number; lng: number };
    pitch: number;
    yaw: number;
    zoom: number;
    size: number;
  }) => void;
}

interface Window {
  __scene?: SceneHandle | null;
  __sceneReady?: boolean;
}
