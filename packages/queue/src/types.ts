export interface RenderTilePayload {
  projectId: string;
  col: number;
  row: number;
  centerLat: number;
  centerLng: number;
  cameraPitch: number;
  cameraYaw: number;
  tileWorldMeters: number;
  tilePixelSize: number;
  idempotencyKey: string;
}

export interface StylizeTilePayload {
  projectId: string;
  col: number;
  row: number;
  renderedStorageKey: string;
  modelId: string;
  prompt: string;
  idempotencyKey: string;
}

export const QUEUE_NAMES = {
  RENDER: 'render-tile',
  STYLIZE: 'stylize-tile',
} as const;
