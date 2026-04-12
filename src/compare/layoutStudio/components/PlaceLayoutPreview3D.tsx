import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LayoutPiece, LayoutSlab, PiecePlacement } from "../types";
import { buildSplashRectanglePoints, planDisplayPoints } from "../utils/blankPlanGeometry";
import { centroid, normalizeClosedRing } from "../utils/geometry";
import { allSinkCutoutRingsPlanWorld, coordPerInchForPlan } from "../utils/pieceSinks";
import { DEFAULT_SLAB_THICKNESS_IN } from "../utils/parseThicknessInches";
import { planPointToSlabInches, slabInchesToPlanTextureMatrix } from "../utils/slabLayoutTexture";

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
  pixelsPerInch: number;
  /** Extrusion depth in inches (from catalog slab thickness). */
  slabThicknessInches: number;
  /** Partial override of colors, lights, and exposure for the 3D preview. */
  appearance?: Partial<PlaceLayoutPreview3DAppearance>;
};

type ViewControlsApi = {
  resetTopDown: () => void;
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
 * (Slab placement uses arc-flattened outlines elsewhere; sinks use chord edges + normals, so 3D must match.)
 */
function planOutlineRing(piece: LayoutPiece, allPieces: LayoutPiece[]): { x: number; y: number }[] | null {
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  if (ring.length < 3) return null;
  return ring.map((p) => ({ x: p.x, y: p.y }));
}

/** Centroid of chord outline — pairs with {@link planOutlineRing} for slab→plan texture matrix in 3D. */
function planCentroidChord(piece: LayoutPiece, allPieces: LayoutPiece[]): { x: number; y: number } | null {
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  if (ring.length < 3) return null;
  return centroid(ring);
}

/**
 * After standing a splash strip up (rotate plan XY toward vertical), the inner edge (p0–p1 from
 * {@link buildSplashRectanglePoints}, countertop side) should be “down” vs the outer edge: lower
 * world +Y than the outer edge midpoint (contact edge at the bottom of the backsplash).
 */
function splashRotationXForInnerEdgeDown(piece: LayoutPiece, allPieces: LayoutPiece[]): number {
  const meta = piece.splashMeta;
  if (!meta) return -Math.PI / 2;
  const parent = allPieces.find((p) => p.id === meta.parentPieceId);
  if (!parent) return -Math.PI / 2;
  const parentDisp = planDisplayPoints(parent, allPieces);
  const rect = buildSplashRectanglePoints(parentDisp, meta.parentEdgeIndex, meta.heightIn);
  const [p0, p1, p2, p3] = rect;
  const innerMid = new THREE.Vector3((p0.x + p1.x) / 2, -(p0.y + p1.y) / 2, 0);
  const outerMid = new THREE.Vector3((p2.x + p3.x) / 2, -(p2.y + p3.y) / 2, 0);
  const eNeg = new THREE.Euler(-Math.PI / 2, 0, 0);
  const ePos = new THREE.Euler(Math.PI / 2, 0, 0);
  const iyNeg = innerMid.clone().applyEuler(eNeg).y;
  const oyNeg = outerMid.clone().applyEuler(eNeg).y;
  const iyPos = innerMid.clone().applyEuler(ePos).y;
  const oyPos = outerMid.clone().applyEuler(ePos).y;
  if (iyNeg < oyNeg) return -Math.PI / 2;
  if (iyPos < oyPos) return Math.PI / 2;
  return -Math.PI / 2;
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
 * Maps slab inches onto extruded cap UVs. Must run against normals from {@link THREE.ExtrudeGeometry}
 * only — do not call {@link THREE.BufferGeometry#computeVertexNormals} again afterward, or rim
 * normals blend and this no longer matches cap faces.
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
  const eps = 1e-3;
  for (let i = 0; i < pos.count; i++) {
    const nz = normal.getZ(i);
    if (Math.abs(Math.abs(nz) - 1) > eps) continue;
    const planX = pos.getX(i);
    const planY = -pos.getY(i);
    const { sx, sy } = planPointToSlabInches(textureM, planX, planY);
    uv.setXY(i, sx / slabW, 1 - sy / slabH);
  }
  uv.needsUpdate = true;
}

/**
 * Decorative slab texture on vertical wall faces only (|normal.z| tiny). Does not use layout
 * placement — picks a varied region of the slab image from local position. Skips cap vertices
 * so {@link fixLidUVsPlanMapped} stays authoritative on lids; where no “pure side” vertices exist,
 * extrusion’s own side UVs + {@link THREE.MeshStandardMaterial#map} still show grain.
 */
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
  const viewControlsRef = useRef<ViewControlsApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pixelsPerInch || pixelsPerInch <= 0) return;

    let cancelled = false;

    const slabById = new Map(slabs.map((s) => [s.id, s]));
    const placementByPiece = new Map(placements.map((p) => [p.pieceId, p]));

    const thicknessIn = Math.max(0.08, slabThicknessInches || DEFAULT_SLAB_THICKNESS_IN);
    const extrudeDepth =
      workspaceKind === "blank" ? thicknessIn : thicknessIn * pixelsPerInch;

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

    const texLoader = new THREE.TextureLoader();
    texLoader.crossOrigin = "anonymous";

    const textureCache = new Map<string, THREE.Texture>();
    const loadTexture = (url: string): Promise<THREE.Texture | null> => {
      if (textureCache.has(url)) return Promise.resolve(textureCache.get(url)!);
      return new Promise((resolve) => {
        texLoader.load(
          url,
          (tex: THREE.Texture) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            textureCache.set(url, tex);
            resolve(tex);
          },
          undefined,
          () => resolve(null)
        );
      });
    };

    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    const box = new THREE.Box3();

    const addPieceMesh = (geom: THREE.ExtrudeGeometry, tex: THREE.Texture | null, piece: LayoutPiece) => {
      const lidMat = new THREE.MeshStandardMaterial({
        map: tex ?? undefined,
        color: tex ? appearance.texturedLidTint : appearance.fallbackLidColor,
        roughness: tex ? 0.44 : 0.45,
        metalness: 0.02,
      });
      if (!tex) lidMat.map = null;
      const sideMat = new THREE.MeshStandardMaterial({
        map: tex ?? undefined,
        color: tex ? appearance.edgeTextureTint : appearance.edgeColor,
        roughness: tex ? 0.5 : 0.42,
        metalness: 0.03,
      });
      if (!tex) sideMat.map = null;
      const mesh = new THREE.Mesh(geom, [lidMat, sideMat]);
      if (piece.pieceRole === "splash") {
        mesh.rotation.x = splashRotationXForInnerEdgeDown(piece, pieces);
      }
      scene.add(mesh);
      meshes.push(mesh);
      geometries.push(geom);
      materials.push(lidMat, sideMat);
      geom.computeBoundingBox();
      if (piece.pieceRole === "splash") {
        mesh.updateMatrixWorld(true);
        const wb = new THREE.Box3().setFromObject(mesh);
        box.union(wb);
      } else if (geom.boundingBox) {
        box.union(geom.boundingBox);
      }
    };

    void (async () => {
      const planScalePerInch = workspaceKind === "blank" ? 1 : pixelsPerInch;

      for (const piece of pieces) {
        if (cancelled) return;
        const pl = placementByPiece.get(piece.id);
        if (!pl?.slabId || !pl.placed) continue;
        const slab = slabById.get(pl.slabId);
        if (!slab || slab.widthIn <= 0 || slab.heightIn <= 0) continue;

        const planCentroid = planCentroidChord(piece, pieces);
        if (!planCentroid) continue;

        const pts = planOutlineRing(piece, pieces);
        if (!pts || pts.length < 3) continue;

        const holeRings = allSinkCutoutRingsPlanWorld(piece, pieces, coordPerInch);

        const shape = buildShapeFromPlanWithHoles(pts, holeRings);
        let geom: THREE.ExtrudeGeometry;
        try {
          geom = new THREE.ExtrudeGeometry(shape, {
            depth: extrudeDepth,
            bevelEnabled: false,
          });
        } catch {
          geom = new THREE.ExtrudeGeometry(buildShapeFromPlanWithHoles(pts, []), {
            depth: extrudeDepth,
            bevelEnabled: false,
          });
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

        const tex = await loadTexture(slab.imageUrl);
        if (cancelled) {
          geom.dispose();
          return;
        }
        addPieceMesh(geom, tex, piece);
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
        size.set(120, extrudeDepth, 80);
      }

      const maxDim = Math.max(size.x, size.y, size.z, 40);

      /** Matches the + button; default equals this many zoom-ins from the base distance. */
      const zoomInFactor = 0.82;
      const defaultZoomInClicks = 5;
      const topViewDistance = maxDim * 2.5 * Math.pow(zoomInFactor, defaultZoomInClicks);

      const resetTopDown = () => {
        camera.up.set(0, 1, 0);
        camera.position.set(center.x, center.y, center.z + topViewDistance);
        controls.target.copy(center);
        camera.near = maxDim * 0.02;
        camera.far = maxDim * 50;
        camera.updateProjectionMatrix();
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

      resetTopDown();

      viewControlsRef.current = {
        resetTopDown,
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
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelled = true;
      viewControlsRef.current = null;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      for (const m of meshes) {
        scene.remove(m);
      }
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      textureCache.forEach((t) => t.dispose());
      textureCache.clear();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [pieces, placements, slabs, pixelsPerInch, slabThicknessInches, workspaceKind, appearanceProp]);

  if (!pixelsPerInch || pixelsPerInch <= 0) {
    return (
      <div className="ls-place-layout-preview-empty ls-place-layout-preview-empty--fullscreen glass-panel">
        <p className="ls-muted">Set scale on the Plan tab to preview 3D placement.</p>
      </div>
    );
  }

  return (
    <div className="ls-place-layout-preview-3d-wrap">
      <div ref={containerRef} className="ls-place-layout-preview-3d" />
      <div className="ls-place-layout-preview-3d-controls" role="toolbar" aria-label="3D view controls">
        <button
          type="button"
          className="ls-btn ls-btn-secondary ls-place-layout-preview-3d-control-btn"
          onClick={() => viewControlsRef.current?.resetTopDown()}
          title="Plan view from above"
        >
          Top view
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
