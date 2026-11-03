import { useSyncExternalStore } from 'react';
import { engine } from '../../state/store';

/** Values that change every frame, delivered at the telemetry rate instead of 120 Hz. */
export const useTelemetry = () =>
  useSyncExternalStore(engine.subscribeTelemetry, engine.getTelemetry);
