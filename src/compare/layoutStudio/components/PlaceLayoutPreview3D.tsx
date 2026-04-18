import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MOUSE } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LayoutPiece, LayoutPoint, LayoutSlab, PiecePlacement } from "../types";
import {
  distancePointToSegment,
  outwardNormalForEdge,
  planDisplayPoints,
  planWorldOffset,
} from "../utils/blankPlanGeometry";
import { flattenOutlineRingWithArcs, pieceHasArcEdges } from "../utils/blankPlanEdgeArc";
import { isPlanStripPiece, stripFoldsDownFromHinge } from "../utils/pieceRoles";
import { centroid, normalizeClosedRing } from "../utils/geometry";
import { allOutletCutoutRingsPlanWorld } from "../utils/pieceOutlets";
import { allSinkCutoutRingsPlanWorld, coordPerInchForPlan } from "../utils/pieceSinks";
import { DEFAULT_SLAB_THICKNESS_IN } from "../utils/parseThicknessInches";
import { piecePixelsPerInch, piecesHaveAnyScale } from "../utils/sourcePages";
import {
  planCentroidForTexture,
  planPointToSlabInches,
  slabInchesToPlanTextureMatrix,
} from "../utils/slabLayoutTexture";
import { disposeSlabTextureWebGL, loadSlabTextureForWebGL } from "../utils/slabTextureWebGL";

/**
 * Optional overrides for the 3D preview scene. Defaults match the pre-styling behavior that
 * correctly showed slab textures with placement (see {@link DEFAULT_PLACE_LAYOUT_PREVIEW_3D_APPEARANCE}).
 */
export type PlaceLayoutPreview3DAppearance = {
  /** Scene clear color (hex). */
  background: number;
  ambientColor: number;
  ambientIntensity: number;
  keyColor: number;
  keyIntensity: number;
  fillColor: number;
  fillIntensity: number;
  rimColor: number;
  rimIntensity: number;
  toneMappingExposure: number;
  /** Diffuse tint on textured lids (#ffffff = no shift vs slab image). */
  texturedLidTint: number;
  fallbackLidColor: number;
  edgeColor: number;
  groundPlaneColor: number;
  /** Soft sky/ground bounce (HemisphereLight). */
  hemisphereSkyColor: number;
  hemisphereGroundColor: number;
  hemisphereIntensity: number;
  /** Vertical faces: multiply slab texture (slightly dimmer than lid for edge polish). */
  edgeTextureTint: number;
  /**
   * Per-light strength for many weak directionals (cube corners + axis directions) — diffuse wrap.
   */
  diffuseDirectionalFillIntensity: number;
  /** Per-light strength for point lights around the scene center (soft omnidirectional fill). */
  diffusePointFillIntensity: number;
};

/** Defaults tuned for correct slab UVs + brighter slab imagery (still neutral whites). */
export const DEFAULT_PLACE_LAYOUT_PREVIEW_3D_APPEARANCE: PlaceLayoutPreview3DAppearance = {
  background: 0x1e2329,
  ambientColor: 0xffffff,
  /** Diffuse: +50% vs prior; key/fill/rim directionals are −50% for softer directional emphasis. */
  ambientIntensity: 1.11,
  keyColor: 0xffffff,
  keyIntensity: 0.525,
  fillColor: 0xd8e2ff,
  fillIntensity: 0.26,
  rimColor: 0xfff5e6,
  rimIntensity: 0.15,
  toneMappingExposure: 1.14,
  texturedLidTint: 0xffffff,
  fallbackLidColor: 0x9a9a98,
  edgeColor: 0x94908a,
  groundPlaneColor: 0x3a4048,
  hemisphereSkyColor: 0xf8f9ff,
  hemisphereGroundColor: 0x45454d,
  hemisphereIntensity: 0.87,
  edgeTextureTint: 0xf2f0ed,
  diffuseDirectionalFillIntensity: 0.098,
  diffusePointFillIntensity: 0.24,
};

function resolvePlaceLayoutPreview3DAppearance(
  partial?: Partial<PlaceLayoutPreview3DAppearance>
): PlaceLayoutPreview3DAppearance {
  const out = { ...DEFAULT_PLACE_LAYOUT_PREVIEW_3D_APPEARANCE };
  if (!partial) return out;
  for (const key of Object.keys(partial) as (keyof PlaceLayoutPreview3DAppearance)[]) {
    const v = partial[key];
    if (v !== undefined) (out as Record<string, unknown>)[key as string] = v;
  }
  return out;
}

type PlaceLayoutPreview3DProps = {
  workspaceKind: "blank" | "source";
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  slabs: LayoutSlab[];
  pixelsPerInch: number | null;
  /** Extrusion depth in inches (from catalog slab thickness). */
  slabThicknessInches: number;
  /** Partial override of colors, lights, and exposure for the 3D preview. */
  appearance?: Partial<PlaceLayoutPreview3DAppearance>;
};

type ViewAxis = "x" | "y" | "z";

type ViewControlsApi = {
  resetTopDown: () => void;
  /** Step orbit ±45° around the given axis (pass from UI state so this works before async scene setup finishes). */
  stepSelectedAxis: (direction: -1 | 1, axis?: ViewAxis | null) => void;
  /** Side elevation: camera on −Y, up +Z (plan X horizontal, thickness Z vertical). */
  setFrontView: () => void;
  /** Opposite of front: camera on +Y, same up +Z. */
  setBackView: () => void;
  /** Oblique 45° between top (plan) and front (elevation). Resets axis orbit. */
  setIso45View: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

function polygonSignedArea(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  return a / 2;
}

/**
 * Chord polygon in plan space — same frame as sink placement / {@link planDisplayPoints}.
 * Arc radii are sampled into a polyline for extrusion via {@link flattenOutlineRingWithArcs}.
 */
function planOutlineRing(piece: LayoutPiece, allPieces: LayoutPiece[]): { x: number; y: number }[] | null {
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  if (ring.length < 3) return null;
  return ring.map((p) => ({ x: p.x, y: p.y }));
}

/** Midpoint of {@link LayoutPiece.splashMeta}.`bottomEdgeIndex` on this strip (hinge line) in ExtrudeGeometry shape space. */
function splashBottomEdgePivotInShapeSpace(piece: LayoutPiece, allPieces: LayoutPiece[]): THREE.Vector3 | null {
  const meta = piece.splashMeta;
  if (!meta) return null;
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  const n = ring.length;
  if (n < 3) return null;
  const ei = Math.max(0, Math.min(meta.bottomEdgeIndex ?? 0, n - 1));
  const a = ring[ei]!;
  const b = ring[(ei + 1) % n]!;
  return new THREE.Vector3((a.x + b.x) / 2, -(a.y + b.y) / 2, 0);
}

/**
 * Stand the edge strip up: rotate ±π/2 around the bottom edge so the strip faces “up” (centroid ends
 * higher in +Y vs the other sign).
 */
function splashStandQuaternion(piece: LayoutPiece, allPieces: LayoutPiece[]): THREE.Quaternion {
  const meta = piece.splashMeta;
  const fallback = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  if (!meta) return fallback;
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  const n = ring.length;
  if (n < 3) return fallback;
  const ei = Math.max(0, Math.min(meta.bottomEdgeIndex ?? 0, n - 1));
  const a = ring[ei]!;
  const b = ring[(ei + 1) % n]!;
  const aS = new THREE.Vector3(a.x, -a.y, 0);
  const bS = new THREE.Vector3(b.x, -b.y, 0);
  const pivot = new THREE.Vector3().addVectors(aS, bS).multiplyScalar(0.5);
  const u = new THREE.Vector3().subVectors(bS, aS);
  const len = u.length();
  if (len < 1e-9) return fallback;
  u.divideScalar(len);
  const c = centroid(ring);
  const cS = new THREE.Vector3(c.x, -c.y, 0);
  const rel = new THREE.Vector3().subVectors(cS, pivot);
  const qPos = new THREE.Quaternion().setFromAxisAngle(u, Math.PI / 2);
  const qNeg = new THREE.Quaternion().setFromAxisAngle(u, -Math.PI / 2);
  const yPos = rel.clone().applyQuaternion(qPos).y;
  const yNeg = rel.clone().applyQuaternion(qNeg).y;
  const up = yPos >= yNeg ? qPos : qNeg;
  const down = yPos >= yNeg ? qNeg : qPos;
  /** Backsplash: fold so centroid moves “up”; miter strip: fold the other way (down). */
  return stripFoldsDownFromHinge(piece) ? down : up;
}

/** Outer boundary + sink bowl / faucet holes as inner paths (plan coords, same as 2D preview). */
function buildShapeFromPlanWithHoles(
  outerPts: { x: number; y: number }[],
  holeRings: { x: number; y: number }[][]
): THREE.Shape {
  const orderedOuter = polygonSignedArea(outerPts) < 0 ? [...outerPts].reverse() : outerPts;
  const shape = new THREE.Shape();
  const flipY = (y: number) => -y;
  shape.moveTo(orderedOuter[0]!.x, flipY(orderedOuter[0]!.y));
  for (let i = 1; i < orderedOuter.length; i++) {
    shape.lineTo(orderedOuter[i]!.x, flipY(orderedOuter[i]!.y));
  }
  shape.closePath();

  const outerA = polygonSignedArea(orderedOuter);
  for (const ring of holeRings) {
    if (ring.length < 3) continue;
    let holePts = ring;
    if (polygonSignedArea(ring) * outerA > 0) {
      holePts = [...ring].reverse();
    }
    const hole = new THREE.Path();
    hole.moveTo(holePts[0]!.x, flipY(holePts[0]!.y));
    for (let i = 1; i < holePts.length; i++) {
      hole.lineTo(holePts[i]!.x, flipY(holePts[i]!.y));
    }
    hole.closePath();
    shape.holes.push(hole);
  }
  return shape;
}

/**
 * Maps slab inches onto extruded cap UVs. Uses face normals to find caps (|normal.z| large).
 * After {@link applyMiter45ShearToExtrudeGeometry}, {@link THREE.BufferGeometry#computeVertexNormals}
 * runs so cap normals are no longer exactly ±Z; we treat |nz| ≥ 0.5 as a cap so UVs still apply.
 */
function fixLidUVsPlanMapped(
  geom: THREE.ExtrudeGeometry,
  slabW: number,
  slabH: number,
  textureM: { a: number; b: number; c: number; d: number; e: number; f: number }
): void {
  const uv = geom.attributes.uv as THREE.BufferAttribute;
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const normal = geom.attributes.normal as THREE.BufferAttribute;
  if (!uv || !pos || !normal) return;
  const tw = Math.max(slabW, 1e-6);
  const th = Math.max(slabH, 1e-6);
  /**
   * Cap faces are perpendicular to Z (|nz| ≈ 1). After miter shear + computeVertexNormals,
   * strict `|nz| ≈ 1` can fail and we never write UVs → solid black. Side walls have |nz| ≈ 0.
   */
  const minCapNz = 0.5;
  for (let i = 0; i < pos.count; i++) {
    const nz = normal.getZ(i);
    if (Math.abs(nz) < minCapNz) continue;
    const planX = pos.getX(i);
    const planY = -pos.getY(i);
    const { sx, sy } = planPointToSlabInches(textureM, planX, planY);
    /** Keep UVs in texture — out-of-range slab inches clamp at the image edge and smear one column. */
    const sxC = Math.min(Math.max(sx, 0), tw);
    const syC = Math.min(Math.max(sy, 0), th);
    uv.setXY(i, sxC / tw, 1 - syC / th);
  }
  uv.needsUpdate = true;
}

/**
 * Decorative slab texture on vertical wall faces only (|normal.z| tiny). Does not use layout
 * placement — picks a varied region of the slab image from local position. Skips cap vertices
 * so {@link fixLidUVsPlanMapped} stays authoritative on lids; where no “pure side” vertices exist,
 * extrusion’s own side UVs + {@link THREE.MeshStandardMaterial#map} still show grain.
 */
/**
 * Shear vertical wall vertices on miter-tagged edges so the top “outer” rim moves inward with height,
 * approximating opposing 45° cuts at miter joints (plan-normal shear).
 */
function applyMiter45ShearToExtrudeGeometry(
  geom: THREE.BufferGeometry,
  planRing: { x: number; y: number }[],
  miterEdgeIndices: readonly number[],
  extrudeDepth: number,
): void {
  if (!miterEdgeIndices.length || extrudeDepth < 1e-6) return;
  const pos = geom.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const nRing = planRing.length;
  if (nRing < 3) return;
  const depth = extrudeDepth;
  /** Top-of-wall offset in plan (inches) — tuned for a visible 45°-style joint in preview. */
  const miterDelta = depth * 0.5;
  const epsSeg = Math.max(0.02, depth * 0.004);

  for (const ei of miterEdgeIndices) {
    if (ei < 0 || ei >= nRing) continue;
    const a = planRing[ei]!;
    const b = planRing[(ei + 1) % nRing]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const outPl = outwardNormalForEdge(planRing as LayoutPoint[], ei);

    for (let i = 0; i < pos.count; i++) {
      const sx = pos.getX(i);
      const sy = pos.getY(i);
      const sz = pos.getZ(i);
      const px = sx;
      const py = -sy;
      if (distancePointToSegment({ x: px, y: py }, a, b) > epsSeg) continue;
      const t = Math.min(1, Math.max(0, sz / depth));
      if (t < 1e-9) continue;
      const vx = px - mid.x;
      const vy = py - mid.y;
      if (vx * outPl.x + vy * outPl.y <= 1e-6) continue;
      const ox = -outPl.x * miterDelta * t;
      const oy = -outPl.y * miterDelta * t;
      pos.setX(i, sx + ox);
      pos.setY(i, sy - oy);
    }
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
}


function fixSideUVsDecorativeGrain(
  geom: THREE.ExtrudeGeometry,
  slabW: number,
  slabH: number
): void {
  const fract = (t: number) => t - Math.floor(t);
  const uv = geom.attributes.uv as THREE.BufferAttribute;
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const normal = geom.attributes.normal as THREE.BufferAttribute;
  if (!uv || !pos || !normal) return;
  const tw = Math.max(slabW, 1e-6);
  const th = Math.max(slabH, 1e-6);
  const sideNzMax = 0.08;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(normal.getZ(i)) > sideNzMax) continue;
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const fu = 0.18 + 0.64 * fract((x + y) * 0.006 + z * 0.003 + 0.17);
    const fv = 0.12 + 0.76 * fract(z * 0.05 + Math.atan2(y, x) * 0.45 + 0.41);
    const sx = fu * tw;
    const sy = fv * th;
    uv.setXY(i, sx / tw, 1 - sy / th);
  }
  uv.needsUpdate = true;
}

export function PlaceLayoutPreview3D({
  workspaceKind,
  pieces,
  placements,
  slabs,
  pixelsPerInch,
  slabThicknessInches,
  appearance: appearanceProp,
}: PlaceLayoutPreview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitControlsRef = useRef<OrbitControls | null>(null);
  const viewControlsRef = useRef<ViewControlsApi | null>(null);
  const [selectedViewAxis, setSelectedViewAxis] = useState<ViewAxis>("z");
  const [panDragEnabled, setPanDragEnabled] = useState(false);
  const panDragEnabledRef = useRef(panDragEnabled);
  panDragEnabledRef.current = panDragEnabled;
  const selectedAxisRef = useRef<ViewAxis>("z");
  selectedAxisRef.current = selectedViewAxis;
  const [slabTexturesLoading, setSlabTexturesLoading] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !piecesHaveAnyScale(pieces, pixelsPerInch)) return;

    let cancelled = false;
    let pendingSlabTextureLoads = 0;

    const slabById = new Map(slabs.map((s) => [s.id, s]));
    const placementByPiece = new Map(placements.map((p) => [p.pieceId, p]));

    const thicknessIn = Math.max(0.08, slabThicknessInches || DEFAULT_SLAB_THICKNESS_IN);
    const coordPerInch = coordPerInchForPlan(workspaceKind, pixelsPerInch);

    const appearance = resolvePlaceLayoutPreview3DAppearance(appearanceProp);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(appearance.background);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 5000);
    camera.up.set(0, 1, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = appearance.toneMappingExposure;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.screenSpacePanning = true;
    orbitControlsRef.current = controls;
    {
      const pan = panDragEnabledRef.current;
      controls.mouseButtons.LEFT = pan ? MOUSE.PAN : MOUSE.ROTATE;
      controls.mouseButtons.RIGHT = pan ? MOUSE.ROTATE : MOUSE.PAN;
    }

    /** Rotates camera offset around `controls.target` after OrbitControls (world axes: X/Y = plan, Z = thickness). */
    const axisOrbitQuat = new THREE.Quaternion();
    const _invAxisOrbitQuat = new THREE.Quaternion();
    const _offsetScratch = new THREE.Vector3();
    const _fwdScratch = new THREE.Vector3();
    const _axisDragQuat = new THREE.Quaternion();
    const worldX = new THREE.Vector3(1, 0, 0);
    const worldY = new THREE.Vector3(0, 1, 0);
    const worldZ = new THREE.Vector3(0, 0, 1);

    let maxSceneDimForNudge = 40;

    scene.add(new THREE.AmbientLight(appearance.ambientColor, appearance.ambientIntensity));
    scene.add(
      new THREE.HemisphereLight(
        appearance.hemisphereSkyColor,
        appearance.hemisphereGroundColor,
        appearance.hemisphereIntensity
      )
    );
    const dir = new THREE.DirectionalLight(appearance.keyColor, appearance.keyIntensity);
    dir.position.set(80, 120, 60);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(appearance.fillColor, appearance.fillIntensity);
    fill.position.set(-60, 40, -80);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(appearance.rimColor, appearance.rimIntensity);
    rim.position.set(-20, -90, 140);
    scene.add(rim);
    const bounce = new THREE.DirectionalLight(0xffffff, 0.19);
    bounce.position.set(40, -30, -100);
    scene.add(bounce);
    const lift = new THREE.DirectionalLight(0xf2f6ff, 0.17);
    lift.position.set(0, 180, 20);
    scene.add(lift);

    /** Many weak directionals ≈ diffuse studio wrap (no single harsh source). */
    const diffuseDirColor = 0xf0f3fa;
    const diffuseScale = 420;
    const diffuseDirections: [number, number, number][] = [
      [1, 1, 1],
      [1, 1, -1],
      [1, -1, 1],
      [1, -1, -1],
      [-1, 1, 1],
      [-1, 1, -1],
      [-1, -1, 1],
      [-1, -1, -1],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      [1, 1, 0],
      [-1, 1, 0],
      [1, -1, 0],
      [-1, -1, 0],
    ];
    for (const [x, y, z] of diffuseDirections) {
      const d = new THREE.DirectionalLight(diffuseDirColor, appearance.diffuseDirectionalFillIntensity);
      d.position.set(x * diffuseScale, y * diffuseScale, z * diffuseScale);
      scene.add(d);
    }

    /** Point lights with gentle falloff — fills concave areas and vertical faces. */
    const ptColor = 0xe8eef8;
    const ptDist = 2200;
    const ptDecay = 2;
    const ptR = 480;
    const pointPositions: [number, number, number][] = [
      [ptR, ptR * 0.4, ptR],
      [-ptR, ptR * 0.35, ptR],
      [ptR, ptR * 0.45, -ptR],
      [-ptR, ptR * 0.4, -ptR],
      [0, ptR * 0.9, 0],
      [ptR * 0.6, -ptR * 0.2, ptR * 0.5],
      [-ptR * 0.55, -ptR * 0.15, -ptR * 0.45],
      [ptR * 0.4, ptR * 0.5, -ptR * 0.6],
    ];
    for (const [px, py, pz] of pointPositions) {
      const p = new THREE.PointLight(ptColor, appearance.diffusePointFillIntensity, ptDist, ptDecay);
      p.position.set(px, py, pz);
      scene.add(p);
    }

    const textureCache = new Map<string, THREE.Texture>();
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    /**
     * Exact same bitmap URL as placement: {@link useResolvedLayoutSlabs} writes the winning
     * candidate into `imageUrl`, and {@link PlaceWorkspace} uses that alone for the slab `<img>`.
     * Do not fall through to `imageCandidates` here or 3D can disagree with layout.
     */
    const loadTextureForSlab = async (slab: LayoutSlab): Promise<THREE.Texture | null> => {
      const u = slab.imageUrl?.trim();
      if (!u) return null;
      const cached = textureCache.get(u);
      if (cached) return cached;
      const tex = await loadSlabTextureForWebGL(u, maxAniso);
      if (tex) textureCache.set(u, tex);
      return tex;
    };

    /** Nudge for Z-axis orbit when camera is directly above target; uses `maxSceneDimForNudge` (updated when bounds are known). */
    const nudgeCameraOffVerticalIfNeeded = () => {
      const t = controls.target;
      _offsetScratch.copy(camera.position).sub(t);
      if (_offsetScratch.lengthSq() < 1e-12) return;
      const xy = Math.hypot(_offsetScratch.x, _offsetScratch.y);
      const eps = Math.max(maxSceneDimForNudge * 0.012, 1.5);
      if (xy < eps) {
        _offsetScratch.x += eps;
        camera.position.copy(t).add(_offsetScratch);
      }
    };

    const applyAxisOrbitStep = (direction: -1 | 1, axisOverride?: ViewAxis | null) => {
      const ax = axisOverride ?? selectedAxisRef.current;
      if (!ax) return;
      const axisVec = ax === "x" ? worldX : ax === "y" ? worldY : worldZ;
      if (ax === "z") nudgeCameraOffVerticalIfNeeded();
      _axisDragQuat.setFromAxisAngle(axisVec, direction * (Math.PI / 4));
      /**
       * Keep `camera.position` in sync with `axisOrbitQuat` the same frame. Otherwise the RAF loop
       * un-rotates with the *new* q while the camera still reflects the *old* q, which corrupts the
       * orbit offset and makes ±45° steps look like no rotation.
       */
      const t = controls.target;
      _offsetScratch.copy(camera.position).sub(t);
      _offsetScratch.applyQuaternion(_axisDragQuat);
      camera.position.copy(t).add(_offsetScratch);
      axisOrbitQuat.premultiply(_axisDragQuat);
      axisOrbitQuat.normalize();
      controls.update();
    };

    /** Stubs for view presets until bounds/async setup completes; axis stepping works immediately. */
    viewControlsRef.current = {
      resetTopDown: () => {},
      setFrontView: () => {},
      setBackView: () => {},
      setIso45View: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
      stepSelectedAxis: applyAxisOrbitStep,
    };

    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    const box = new THREE.Box3();

    const addPieceMesh = (
      geom: THREE.ExtrudeGeometry,
      tex: THREE.Texture | null,
      piece: LayoutPiece,
      extrudeDepth: number,
    ): THREE.Mesh => {
      const lidMat = new THREE.MeshStandardMaterial({
        ...(tex ? { map: tex } : {}),
        color: tex ? appearance.texturedLidTint : appearance.fallbackLidColor,
        roughness: tex ? 0.44 : 0.45,
        metalness: 0.02,
      });
      const sideMat = new THREE.MeshStandardMaterial({
        ...(tex ? { map: tex } : {}),
        color: tex ? appearance.edgeTextureTint : appearance.edgeColor,
        roughness: tex ? 0.5 : 0.42,
        metalness: 0.03,
      });
      const mesh = new THREE.Mesh(geom, [lidMat, sideMat]);
      if (isPlanStripPiece(piece)) {
        const q = splashStandQuaternion(piece, pieces);
        mesh.quaternion.copy(q);
        /** Planar inward (slab thickness into counter); rotate in XY only — do not add R(inward).z or hinge floats above z = counter top. */
        const pivot = splashBottomEdgePivotInShapeSpace(piece, pieces);
        const meta = piece.splashMeta;
        if (pivot && meta) {
          const ring = normalizeClosedRing(planDisplayPoints(piece, pieces));
          const ei = Math.max(0, Math.min(meta.bottomEdgeIndex ?? 0, ring.length - 1));
          const out = outwardNormalForEdge(ring, ei);
          const tSign = stripFoldsDownFromHinge(piece) ? -1 : 1;
          const inward = new THREE.Vector3(-out.x * extrudeDepth * tSign, out.y * extrudeDepth * tSign, 0);
          inward.applyQuaternion(q);
          mesh.position.set(pivot.x + inward.x, pivot.y + inward.y, extrudeDepth);
        }
      }
      scene.add(mesh);
      meshes.push(mesh);
      geometries.push(geom);
      materials.push(lidMat, sideMat);
      geom.computeBoundingBox();
      if (isPlanStripPiece(piece)) {
        mesh.updateMatrixWorld(true);
        const wb = new THREE.Box3().setFromObject(mesh);
        box.union(wb);
      } else if (geom.boundingBox) {
        box.union(geom.boundingBox);
      }
      return mesh;
    };

    void (async () => {
      for (const piece of pieces) {
        if (cancelled) return;
        const pl = placementByPiece.get(piece.id);
        if (!pl?.slabId || !pl.placed) continue;
        const slab = slabById.get(pl.slabId);
        if (!slab || slab.widthIn <= 0 || slab.heightIn <= 0) continue;
        const planScalePerInch =
          workspaceKind === "blank" ? 1 : piecePixelsPerInch(piece, pixelsPerInch);
        if (!planScalePerInch) continue;
        const pieceExtrudeDepth = thicknessIn * planScalePerInch;
        const pieceCoordPerInch =
          workspaceKind === "blank" ? coordPerInch : planScalePerInch;

        const planCentroid = planCentroidForTexture(piece, pieces);
        if (!planCentroid) continue;

        const chordPts = planOutlineRing(piece, pieces);
        if (!chordPts || chordPts.length < 3) continue;

        const off = planWorldOffset(piece, pieces);
        const arcCenterOff = { x: off.ox, y: off.oy };
        const chordLayout = chordPts.map((p) => ({ x: p.x, y: p.y }));
        const pts: { x: number; y: number }[] = pieceHasArcEdges(piece)
          ? flattenOutlineRingWithArcs(piece, chordLayout, arcCenterOff, 32).map((p) => ({
              x: p.x,
              y: p.y,
            }))
          : chordPts;

        const holeRings = [
          ...allSinkCutoutRingsPlanWorld(piece, pieces, pieceCoordPerInch),
          ...allOutletCutoutRingsPlanWorld(piece, pieces, pieceCoordPerInch),
        ];

        const shape = buildShapeFromPlanWithHoles(pts, holeRings);
        let geom: THREE.ExtrudeGeometry;
        try {
          geom = new THREE.ExtrudeGeometry(shape, {
            depth: pieceExtrudeDepth,
            bevelEnabled: false,
          });
        } catch {
          geom = new THREE.ExtrudeGeometry(buildShapeFromPlanWithHoles(pts, []), {
            depth: pieceExtrudeDepth,
            bevelEnabled: false,
          });
        }

        const miterIdx = piece.edgeTags?.miterEdgeIndices;
        if (miterIdx?.length) {
          applyMiter45ShearToExtrudeGeometry(geom, chordPts, miterIdx, pieceExtrudeDepth);
        }

        /** ExtrudeGeometry already computes vertex normals; a second pass blends rim normals and breaks {@link fixLidUVsPlanMapped}. */

        const textureM = slabInchesToPlanTextureMatrix({
          placement: pl,
          planCentroid,
          slabCentroid: { x: pl.x, y: pl.y },
          planScalePerInch,
        });
        fixLidUVsPlanMapped(geom, slab.widthIn, slab.heightIn, textureM);
        fixSideUVsDecorativeGrain(geom, slab.widthIn, slab.heightIn);

        if (isPlanStripPiece(piece)) {
          const pivot = splashBottomEdgePivotInShapeSpace(piece, pieces);
          if (pivot) geom.translate(-pivot.x, -pivot.y, 0);
        }

        /**
         * Do not await slab texture before adding geometry. `fetch` / `TextureLoader` can hang on
         * some URLs; blocking here left the scene empty (blank 3D) until load completed.
         */
        if (cancelled) {
          geom.dispose();
          return;
        }
        const mesh = addPieceMesh(geom, null, piece, pieceExtrudeDepth);
        const mats = mesh.material as THREE.MeshStandardMaterial[];
        const lidMat = mats[0]!;
        const sideMat = mats[1]!;
        pendingSlabTextureLoads += 1;
        if (pendingSlabTextureLoads === 1) {
          setSlabTexturesLoading(true);
        }
        void loadTextureForSlab(slab)
          .then((tex) => {
            if (cancelled || !tex) return;
            tex.needsUpdate = true;
            lidMat.map = tex;
            lidMat.color.setHex(appearance.texturedLidTint);
            lidMat.roughness = 0.44;
            lidMat.metalness = 0.02;
            lidMat.map.needsUpdate = true;
            lidMat.needsUpdate = true;
            sideMat.map = tex;
            sideMat.color.setHex(appearance.edgeTextureTint);
            sideMat.roughness = 0.5;
            sideMat.metalness = 0.03;
            sideMat.map.needsUpdate = true;
            sideMat.needsUpdate = true;
          })
          .finally(() => {
            pendingSlabTextureLoads -= 1;
            if (!cancelled && pendingSlabTextureLoads <= 0) {
              setSlabTexturesLoading(false);
            }
          });
      }

      if (cancelled) return;

      if (meshes.length === 0) {
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(120, 80),
          new THREE.MeshStandardMaterial({ color: appearance.groundPlaneColor, roughness: 0.88 })
        );
        plane.rotation.x = -Math.PI / 2;
        scene.add(plane);
      }

      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      if (meshes.length > 0 && !box.isEmpty()) {
        box.getCenter(center);
        box.getSize(size);
      } else {
        center.set(0, 0, 0);
        size.set(120, thicknessIn, 80);
      }

      const maxDim = Math.max(size.x, size.y, size.z, 40);

      /** Matches the + button; default equals this many zoom-ins from the base distance. */
      const zoomInFactor = 0.82;
      const defaultZoomInClicks = 5;
      const topViewDistance = maxDim * 2.5 * Math.pow(zoomInFactor, defaultZoomInClicks);

      const clampCameraPlanes = () => {
        camera.near = Math.max(maxDim * 0.02, 0.1);
        camera.far = Math.max(maxDim * 50, 5000);
        camera.updateProjectionMatrix();
      };

      const resetAxisOrbit = () => {
        axisOrbitQuat.identity();
      };

      const resetTopDown = () => {
        resetAxisOrbit();
        camera.up.set(0, 1, 0);
        camera.position.set(center.x, center.y, center.z + topViewDistance);
        controls.target.copy(center);
        clampCameraPlanes();
        controls.update();
      };

      const setFrontView = () => {
        resetAxisOrbit();
        // Elevation from −Y toward +Y: shows the “front” plan face (camera at +Y was −Y-facing / read as back).
        // World Z = extrusion depth; use Z as screen-up so the view isn’t degenerate (up ∥ view with default Y-up).
        camera.up.set(0, 0, 1);
        camera.position.set(center.x, center.y - topViewDistance, center.z);
        controls.target.copy(center);
        clampCameraPlanes();
        controls.update();
      };

      const setBackView = () => {
        resetAxisOrbit();
        camera.up.set(0, 0, 1);
        camera.position.set(center.x, center.y + topViewDistance, center.z);
        controls.target.copy(center);
        clampCameraPlanes();
        controls.update();
      };

      const setIso45View = () => {
        resetAxisOrbit();
        // Bisect top offset (0,0,+1) and front offset (0,−1,0) → same X as scene; looks between plan and elevation.
        camera.up.set(0, 1, 0);
        const dir = new THREE.Vector3(0, -1, 1).normalize();
        camera.position.copy(center).add(dir.multiplyScalar(topViewDistance));
        controls.target.copy(center);
        clampCameraPlanes();
        controls.update();
      };

      const zoomBy = (factor: number) => {
        const offset = camera.position.clone().sub(controls.target);
        const len = offset.length();
        if (len < 1e-6) return;
        offset.multiplyScalar(factor);
        camera.position.copy(controls.target).add(offset);
        controls.update();
      };

      maxSceneDimForNudge = maxDim;

      resetTopDown();

      viewControlsRef.current = {
        resetTopDown,
        stepSelectedAxis: applyAxisOrbitStep,
        setFrontView,
        setBackView,
        setIso45View,
        zoomIn: () => zoomBy(zoomInFactor),
        zoomOut: () => zoomBy(1 / zoomInFactor),
      };
    })();

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 2 || h < 2) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    let rafId = 0;
    const loop = () => {
      rafId = requestAnimationFrame(loop);
      const t = controls.target;

      _invAxisOrbitQuat.copy(axisOrbitQuat).invert();
      _offsetScratch.copy(camera.position).sub(t);
      _offsetScratch.applyQuaternion(_invAxisOrbitQuat);
      camera.position.copy(t).add(_offsetScratch);

      controls.update();

      _offsetScratch.copy(camera.position).sub(t);
      _offsetScratch.applyQuaternion(axisOrbitQuat);
      camera.position.copy(t).add(_offsetScratch);
      /**
       * World up for lookAt must stay a **world** axis (do not apply `axisOrbitQuat` to `up`).
       * For oblique / elevation / 45° views, prefer +Z as the screen-up hint so turntable (Z) orbits
       * do not introduce roll; for nearly top-down views (eye along ±world Z), use +Y.
       */
      _fwdScratch.copy(camera.position).sub(t);
      const dist = _fwdScratch.length();
      if (dist > 1e-9) {
        _fwdScratch.multiplyScalar(1 / dist);
        const az = Math.abs(_fwdScratch.z);
        if (az > 0.88) {
          camera.up.set(0, 1, 0);
        } else {
          camera.up.set(0, 0, 1);
        }
      } else {
        camera.up.set(0, 1, 0);
      }
      camera.lookAt(t);

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelled = true;
      setSlabTexturesLoading(false);
      viewControlsRef.current = null;
      orbitControlsRef.current = null;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      for (const m of meshes) {
        scene.remove(m);
      }
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      textureCache.forEach((t) => disposeSlabTextureWebGL(t));
      textureCache.clear();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    pieces,
    placements,
    slabs,
    pixelsPerInch,
    slabThicknessInches,
    workspaceKind,
    appearanceProp,
  ]);

  useEffect(() => {
    const c = orbitControlsRef.current;
    if (!c) return;
    if (panDragEnabled) {
      c.mouseButtons.LEFT = MOUSE.PAN;
      c.mouseButtons.RIGHT = MOUSE.ROTATE;
    } else {
      c.mouseButtons.LEFT = MOUSE.ROTATE;
      c.mouseButtons.RIGHT = MOUSE.PAN;
    }
  }, [panDragEnabled]);

  if (!piecesHaveAnyScale(pieces, pixelsPerInch)) {
    return (
      <div className="ls-place-layout-preview-empty ls-place-layout-preview-empty--fullscreen glass-panel">
        <p className="ls-muted">Set scale on the Plan tab to preview 3D placement.</p>
      </div>
    );
  }

  return (
    <div className="ls-place-layout-preview-3d-wrap">
      {slabTexturesLoading ? (
        <div
          className="ls-place-layout-preview-3d-texture-loading"
          role="status"
          aria-live="polite"
          aria-label="Loading slab textures for 3D preview"
        >
          <div className="ls-place-layout-preview-3d-texture-loading-inner">
            <span className="ls-place-layout-preview-3d-texture-loading-spinner" aria-hidden />
            <span className="ls-place-layout-preview-3d-texture-loading-label">Loading slab textures…</span>
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="ls-place-layout-preview-3d"
        title="Choose X, Y, or Z on the toolbar, then use ← → to rotate the view ±45° around that world axis (Z = slab thickness)."
      />
      <div className="ls-place-layout-preview-3d-controls" role="toolbar" aria-label="3D view controls">
        <button
          type="button"
          className={
            panDragEnabled
              ? "ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn ls-place-layout-preview-3d-axis-pill ls-place-layout-preview-3d-axis-pill--active"
              : "ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn ls-place-layout-preview-3d-axis-pill"
          }
          aria-pressed={panDragEnabled}
          onClick={() => setPanDragEnabled((v) => !v)}
          title={
            panDragEnabled
              ? "Left-drag pans the view; right-drag orbits. Click to use left-drag for orbit."
              : "Click to use left-drag for pan; right-drag orbits."
          }
        >
          Pan
        </button>
        <div
          className="ls-place-layout-preview-3d-view-col"
          role="group"
          aria-label="Top, back, and front views"
        >
          <button
            type="button"
            className="ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn"
            onClick={() => viewControlsRef.current?.setBackView()}
            title="Back elevation (opposite side from Front)"
          >
            Back
          </button>
          <div
            className="ls-place-layout-preview-3d-view-row"
            role="group"
            aria-label="Top view"
          >
            <button
              type="button"
              className="ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn"
              onClick={() => viewControlsRef.current?.resetTopDown()}
              title="Plan view from above"
            >
              Top
            </button>
          </div>
          <button
            type="button"
            className="ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn"
            onClick={() => viewControlsRef.current?.setFrontView()}
            title="Front elevation (side view)"
          >
            Front
          </button>
        </div>
        <div
          className="ls-place-layout-preview-3d-axis-rot"
          role="group"
          aria-label="Rotate around world axis"
        >
          <span className="ls-place-layout-preview-3d-axis-rot-lbl">Axis</span>
          {(["x", "y", "z"] as const).map((ax) => (
            <button
              key={ax}
              type="button"
              className={
                selectedViewAxis === ax
                  ? "ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn ls-place-layout-preview-3d-axis-pill ls-place-layout-preview-3d-axis-pill--active"
                  : "ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn ls-place-layout-preview-3d-axis-pill"
              }
              onClick={() => setSelectedViewAxis(ax)}
              aria-pressed={selectedViewAxis === ax}
              title={`Rotate around ${ax.toUpperCase()} (world axis)`}
            >
              {ax.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            className="ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn ls-place-layout-preview-3d-control-btn--icon"
            onClick={() => viewControlsRef.current?.stepSelectedAxis(-1, selectedViewAxis)}
            title={`Rotate −45° around ${selectedViewAxis.toUpperCase()}`}
            aria-label={`Rotate 45 degrees negative around ${selectedViewAxis.toUpperCase()} axis`}
          >
            ←
          </button>
          <button
            type="button"
            className="ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn ls-place-layout-preview-3d-control-btn--icon"
            onClick={() => viewControlsRef.current?.stepSelectedAxis(1, selectedViewAxis)}
            title={`Rotate +45° around ${selectedViewAxis.toUpperCase()}`}
            aria-label={`Rotate 45 degrees positive around ${selectedViewAxis.toUpperCase()} axis`}
          >
            →
          </button>
        </div>
        <button
          type="button"
          className="ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn"
          onClick={() => viewControlsRef.current?.setIso45View()}
          title="45° oblique view (between top plan and front elevation)"
        >
          45°
        </button>
        <button
          type="button"
          className="ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn"
          onClick={() => viewControlsRef.current?.zoomIn()}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn"
          onClick={() => viewControlsRef.current?.zoomOut()}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
      </div>
    </div>
  );
}
