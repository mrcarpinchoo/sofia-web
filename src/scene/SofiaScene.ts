// three.js view of the panel. It only draws what the simulation computed,
// plus cursor targeting and camera controls.

import * as THREE from 'three';
import type { KinematicConfig, PanelModule, Vec3 } from '../core/types';
import {
  DEFAULT_SPACING,
  PLATE_BOTTOM,
  PLATE_RADIUS,
  PLATE_TOP,
  plateCorners,
} from '../core/kinematics';
import type { Unit } from '../simulation/Simulation';
import type { TargetMode } from '../simulation/targets';

export type ViewName = 'front' | 'iso' | 'single';

interface UnitMeshes {
  root: THREE.Group;
  pivot: THREE.Group;
  pitch: THREE.Group;
  panel: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshStandardMaterial>;
  ideal: THREE.Group;
  ray: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

interface DrawFlags {
  rays: boolean;
  ideal: boolean;
  /** Draw the target sphere and its trail (default true). */
  showTarget?: boolean;
}

const SELECTED_COLOR = 0x83d8d3;
const PLATE_COLOR = 0xb1c7d2;
const COLLISION_COLOR = 0xff4a2e;
const TRAIL_LENGTH = 360;
// Spacing the camera distance and fog below were tuned for.
const REFERENCE_SPACING = 135;
const ORBIT_SPEED = 0.005;

// Target range on the plane, in mm.
const MAX_TARGET_X = 650;
const MAX_TARGET_Y = 550;

export class SofiaScene {
  depth = 400;
  mode: TargetMode = 'auto';

  private readonly container: HTMLElement;
  private readonly onTarget: (target: Vec3) => void;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly world = new THREE.Scene();
  private readonly fog = new THREE.Fog(0x111b29, 1800, 4200);
  private readonly camera = new THREE.PerspectiveCamera(43, 1, 1, 14000);
  private readonly plateGeometry: THREE.ExtrudeGeometry;
  private readonly sphere: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly trail: THREE.Line;
  private readonly trailGeometry = new THREE.BufferGeometry();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly focus = new THREE.Vector3(0, 0, 100);
  private readonly resizeObserver: ResizeObserver;
  // Removes every event listener at once in dispose().
  private readonly listeners = new AbortController();
  private readonly touches = new Map<number, { x: number; y: number }>();

  private units: UnitMeshes[] = [];
  private trailPoints: THREE.Vector3[] = [];
  private selected = 7;
  private view: ViewName = 'iso';
  private az = 0.22;
  private el = 0.23;
  private distance = 1250;
  private fitDistance = 1350;
  private spacing = DEFAULT_SPACING;
  private drag: { x: number; y: number } | null = null;

  constructor(container: HTMLElement, onTarget: (target: Vec3) => void) {
    this.container = container;
    this.onTarget = onTarget;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x111b29);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    container.appendChild(this.renderer.domElement);

    this.world.fog = this.fog;
    this.camera.up.set(0, 1, 0);

    this.world.add(new THREE.HemisphereLight(0xbfe8ff, 0x142536, 2.6));
    let light = new THREE.DirectionalLight(0xffffff, 3.4);
    light.position.set(-400, 700, 900);
    this.world.add(light);
    light = new THREE.DirectionalLight(0x59b6dc, 2);
    light.position.set(600, -300, 300);
    this.world.add(light);

    const grid = new THREE.GridHelper(6000, 100, 0x2d4356, 0x1b2c3e);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -23;
    this.world.add(grid);

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(10000, 10000),
      new THREE.MeshStandardMaterial({ color: 0x132133, roughness: 1 }),
    );
    back.position.z = -24;
    this.world.add(back);

    // The bevel grows the outline, so the shape starts smaller to end at full size.
    const bevel = -PLATE_BOTTOM;
    const corners = plateCorners(PLATE_RADIUS - bevel / Math.cos(Math.PI / 6));
    const shape = new THREE.Shape(corners.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.closePath();
    this.plateGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: PLATE_TOP - bevel,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      steps: 1,
    });

    this.sphere = new THREE.Mesh(
      new THREE.SphereGeometry(10, 24, 16),
      new THREE.MeshStandardMaterial({
        color: 0xff334e,
        emissive: 0xe50e30,
        emissiveIntensity: 0.4,
        roughness: 0.28,
      }),
    );
    this.world.add(this.sphere);

    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(15, 16.5, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff687d,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    this.world.add(this.halo);

    this.trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(TRAIL_LENGTH * 3), 3),
    );
    this.trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(
      this.trailGeometry,
      new THREE.LineBasicMaterial({ color: 0xfd687b, transparent: true, opacity: 0.25 }),
    );
    this.trail.frustumCulled = false;
    this.world.add(this.trail);

    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  build(modules: PanelModule[], config: KinematicConfig) {
    for (const unit of this.units) this.disposeUnit(unit);
    this.units = modules.map((module, i) => this.createUnit(module, config, i));
    this.reposition(modules, config);
  }

  reposition(modules: PanelModule[], config: KinematicConfig) {
    this.spacing = config.spacing;
    this.units.forEach((unit, i) => unit.root.position.fromArray(modules[i].base));
    const factor = this.spacing / REFERENCE_SPACING;
    this.fitDistance = 1350 * factor;
    this.fog.near = 1800 * factor;
    this.fog.far = 4200 * factor;
    this.setView(this.view);
  }

  select(index: number) {
    this.selected = index;
    this.units.forEach((unit, j) => {
      unit.panel.material.color.setHex(index === j ? SELECTED_COLOR : PLATE_COLOR);
    });
    if (this.view === 'single') this.setView('single');
  }

  setView(view: ViewName) {
    this.view = view;
    if (view === 'front') {
      this.az = 0;
      this.el = 0;
      this.distance = this.fitDistance;
      this.focus.set(0, 0, 90);
    } else if (view === 'iso') {
      this.az = 0.24;
      this.el = 0.3;
      this.distance = this.fitDistance;
      this.focus.set(0, 0, 100);
    } else {
      this.az = 0.5;
      this.el = 0.28;
      this.distance = 650;
      const unit = this.units[this.selected];
      if (unit) this.focus.copy(unit.root.position).add(new THREE.Vector3(0, 0, 100));
    }
    this.units.forEach((unit, i) => {
      unit.root.visible = view !== 'single' || i === this.selected;
    });
    this.updateCamera();
  }

  zoom(factor: number) {
    this.distance = Math.max(260, Math.min(6500, this.distance * factor));
    this.updateCamera();
  }

  update(
    units: Unit[],
    target: Vec3,
    flags: DrawFlags,
    colliding: ReadonlySet<number>,
    trailSample = false,
  ) {
    const { rays, ideal, showTarget = true } = flags;
    units.forEach((state, i) => {
      const unit = this.units[i];
      unit.pivot.rotation.x = state.q[0];
      unit.pitch.rotation.y = state.q[1];
      unit.ideal.rotation.set(state.ik.q[0], state.ik.q[1], 0, 'XYZ');
      unit.ideal.visible = ideal;
      unit.ray.visible = rays;
      const material = unit.panel.material;
      material.color.setHex(
        colliding.has(i) ? COLLISION_COLOR : i === this.selected ? SELECTED_COLOR : PLATE_COLOR,
      );
      material.emissiveIntensity = 1;
      material.emissive.setHex(state.ik.unreachable ? 0x4a1a06 : 0);
      unit.ray.material.opacity = i === this.selected ? 0.65 : 0.13;
    });

    this.sphere.visible = showTarget;
    this.halo.visible = showTarget;
    this.trail.visible = showTarget;
    this.sphere.position.fromArray(target);
    this.halo.position.copy(this.sphere.position);
    this.halo.quaternion.copy(this.camera.quaternion);

    if (trailSample) {
      this.trailPoints.push(new THREE.Vector3(...target));
      if (this.trailPoints.length > TRAIL_LENGTH) this.trailPoints.shift();
      const attribute = this.trailGeometry.getAttribute('position');
      this.trailPoints.forEach((p, i) => attribute.setXYZ(i, p.x, p.y, p.z));
      attribute.needsUpdate = true;
      this.trailGeometry.setDrawRange(0, this.trailPoints.length);
    }
    this.renderer.render(this.world, this.camera);
  }

  clearTrail() {
    this.trailPoints = [];
    this.trailGeometry.setDrawRange(0, 0);
  }

  /** Releases the WebGL context and everything attached to the page. */
  dispose() {
    this.listeners.abort();
    this.resizeObserver.disconnect();
    for (const unit of this.units) this.disposeUnit(unit);
    this.units = [];
    this.world.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    this.plateGeometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private createUnit(module: PanelModule, config: KinematicConfig, index: number): UnitMeshes {
    const root = new THREE.Group();
    root.position.fromArray(module.base);
    const [m0, m1, m2] = module.mount;
    root.setRotationFromMatrix(
      new THREE.Matrix4().set(...m0, 0, ...m1, 0, ...m2, 0, 0, 0, 0, 1),
    );

    const dark = new THREE.MeshStandardMaterial({ color: 0x273f54, metalness: 0.65, roughness: 0.48 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x839aac, metalness: 0.72, roughness: 0.35 });

    const base = this.cylinder(36, 18, dark);
    base.position.z = 0;
    root.add(base);
    const rim = this.cylinder(37, 2, metal);
    rim.position.z = 9;
    root.add(rim);
    const stand = this.cylinder(8, Math.max(1, config.z12 - 10), metal);
    stand.position.z = (config.z12 + 10) / 2;
    root.add(stand);

    const pivot = new THREE.Group();
    pivot.position.z = config.z12;
    root.add(pivot);
    pivot.add(new THREE.Mesh(new THREE.SphereGeometry(13, 16, 12), dark));

    // Nested X then Y rotations reflect the serial mounting, not an unconstrained lookAt.
    const pitch = new THREE.Group();
    pivot.add(pitch);
    const shaft = this.cylinder(4, config.z23, metal);
    shaft.position.z = config.z23 / 2;
    pitch.add(shaft);

    const panel = new THREE.Mesh(
      this.plateGeometry,
      new THREE.MeshStandardMaterial({
        color: index === this.selected ? SELECTED_COLOR : PLATE_COLOR,
        metalness: 0.32,
        roughness: 0.52,
      }),
    );
    panel.position.z = config.z23;
    pitch.add(panel);
    panel.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(this.plateGeometry),
        new THREE.LineBasicMaterial({ color: 0x46687b }),
      ),
    );

    const dot = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 1, 12), dark);
    dot.rotation.x = Math.PI / 2;
    dot.position.z = config.z23 + PLATE_TOP + 0.3;
    pitch.add(dot);

    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 450)]),
      new THREE.LineBasicMaterial({ color: 0x68c9c2, transparent: true, opacity: 0.16 }),
    );
    pitch.add(ray);

    const ideal = new THREE.Group();
    ideal.position.z = config.z12;
    root.add(ideal);
    const idealPanel = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.plateGeometry),
      new THREE.LineBasicMaterial({ color: 0xfbd092, transparent: true, opacity: 0.5 }),
    );
    idealPanel.position.z = config.z23;
    ideal.add(idealPanel);

    this.world.add(root);
    return { root, pivot, pitch, panel, ideal, ray };
  }

  private disposeUnit(unit: UnitMeshes) {
    this.world.remove(unit.root);
    unit.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      if (object.geometry !== this.plateGeometry) object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    });
  }

  private cylinder(radius: number, height: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 40), material);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  private updateCamera() {
    const extra = this.container.clientWidth < 600 ? 1.25 : 1;
    const d = this.distance * extra;
    this.camera.position
      .copy(this.focus)
      .add(
        new THREE.Vector3(
          Math.sin(this.az) * Math.cos(this.el) * d,
          Math.sin(this.el) * d,
          Math.cos(this.az) * Math.cos(this.el) * d,
        ),
      );
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateCamera();
  }

  private orbit(dx: number, dy: number) {
    this.az += dx * ORBIT_SPEED;
    this.el = Math.max(-1, Math.min(1, this.el + dy * ORBIT_SPEED));
    this.updateCamera();
  }

  /** Moves the target to where the pointer hits the plane at the chosen depth. */
  private point(event: PointerEvent) {
    if (this.mode !== 'cursor') return;
    const bounds = this.container.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.depth);
    if (this.raycaster.ray.intersectPlane(plane, hit)) {
      this.onTarget([
        Math.max(-MAX_TARGET_X, Math.min(MAX_TARGET_X, hit.x)),
        Math.max(-MAX_TARGET_Y, Math.min(MAX_TARGET_Y, hit.y)),
        this.depth,
      ]);
    }
  }

  private bindInput() {
    const { container } = this;
    const { signal } = this.listeners;
    container.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    container.addEventListener('pointerdown', (e) => this.pointerDown(e), { signal });
    container.addEventListener('pointermove', (e) => this.pointerMove(e), { signal });
    container.addEventListener('pointerup', (e) => this.pointerEnd(e), { signal });
    container.addEventListener('pointercancel', (e) => this.pointerEnd(e), { signal });
    container.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? 1.08 : 0.92);
      },
      { passive: false, signal },
    );
    container.addEventListener(
      'keydown',
      (e) => {
        if (e.key === '+' || e.key === '=') this.zoom(0.9);
        if (e.key === '-') this.zoom(1.1);
      },
      { signal },
    );
  }

  private pointerDown(event: PointerEvent) {
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.container.setPointerCapture(event.pointerId);
      if (this.touches.size === 1) this.point(event);
    } else if (event.button === 2 || event.shiftKey) {
      this.drag = { x: event.clientX, y: event.clientY };
      this.container.setPointerCapture(event.pointerId);
    } else {
      this.point(event);
    }
  }

  private pointerMove(event: PointerEvent) {
    if (event.pointerType === 'touch') {
      this.touchMove(event);
    } else if (this.drag) {
      this.orbit(event.clientX - this.drag.x, event.clientY - this.drag.y);
      this.drag = { x: event.clientX, y: event.clientY };
    } else {
      this.point(event);
    }
  }

  private pointerEnd(event: PointerEvent) {
    this.drag = null;
    this.touches.delete(event.pointerId);
  }

  /** One finger orbits (or moves the target in Cursor mode); two orbit and pinch. */
  private touchMove(event: PointerEvent) {
    const previous = this.touches.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;

    if (this.touches.size === 1) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.mode === 'cursor') this.point(event);
      else this.orbit(dx, dy);
      return;
    }
    const other = [...this.touches.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (!other) return;
    const before = Math.hypot(previous.x - other.x, previous.y - other.y);
    const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (before > 0 && after > 0) this.zoom(before / after);
    // Each finger reports its own move, so half of it belongs to the shared drag.
    this.orbit(dx / 2, dy / 2);
  }
}
