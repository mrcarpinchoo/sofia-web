import { trajectory } from '../core/trajectories';
import type { TrajectoryType } from '../core/trajectories';
import type { Vec3 } from '../core/types';

export type TargetMode = 'auto' | 'cursor' | 'camera';

export interface TargetContext {
  phase: number;
  path: TrajectoryType;
  depth: number;
  target: Vec3;
}

type TargetProvider = (context: TargetContext) => Vec3;

// All providers return a target in the global mounting frame, in millimeters.
// A future calibrated camera adapter can register here without editing IK or filters.
export class TargetInputs {
  private readonly providers = new Map<TargetMode, TargetProvider>([
    ['auto', (s) => trajectory(s.phase, s.path, 1, s.depth)],
    ['cursor', (s) => s.target],
    ['camera', (s) => s.target],
  ]);

  register(mode: TargetMode, provider: TargetProvider) {
    this.providers.set(mode, provider);
  }

  sample(mode: TargetMode, context: TargetContext): Vec3 {
    const provider = this.providers.get(mode);
    if (!provider) throw new Error('Entrada desconocida');
    const target = provider(context);
    if (target.length !== 3 || !target.every(Number.isFinite)) {
      throw new TypeError('El objetivo debe contener tres coordenadas finitas en mm');
    }
    return [...target];
  }
}
