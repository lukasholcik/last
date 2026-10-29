import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CrossSectionId } from "~/lib/geometry/section-types";
import type { LastState, Vec3 } from "~/lib/geometry/types";
import { upperSectionCurves } from "./section-display";

export interface SceneController {
  update: (display: LastState["display"]) => void;
  select: (id: CrossSectionId | null) => void;
  fit: () => void;
  dispose: () => void;
}

/** Display samples only. This module is dynamically imported after client mount. */
export function createScene(
  container: HTMLElement,
  onFailure: (error: unknown) => void,
): SceneController {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  let controls: OrbitControls | undefined,
    observer: ResizeObserver | undefined,
    disposed = false,
    selectedSection: CrossSectionId | null = null;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(36, 1, 0.01, 10000);
  const guides = new THREE.Group(),
    box = new THREE.Box3();
  scene.add(guides);
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0x63736b, 2));
  const keyLight = new THREE.DirectionalLight(0xfff1de, 2.5);
  keyLight.position.set(180, -100, 300);
  scene.add(keyLight);
  function clear() {
    for (const child of [...guides.children]) {
      guides.remove(child);
      const object = child as
        | THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
        | THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      object.geometry.dispose();
      object.material.dispose();
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    controls?.removeEventListener("change", render);
    controls?.dispose();
    renderer.domElement.removeEventListener("webglcontextlost", lost);
    clear();
    renderer.dispose();
    renderer.domElement.remove();
  }
  function fail(error: unknown) {
    dispose();
    onFailure(error);
  }
  function lost(event: Event) {
    event.preventDefault();
    fail(new Error("WebGL context lost"));
  }
  function render() {
    if (!disposed) {
      try {
        renderer.render(scene, camera);
      } catch (error) {
        fail(error);
      }
    }
  }
  function fit() {
    if (box.isEmpty() || disposed || !controls) return;
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1),
      direction = new THREE.Vector3(1, -0.35, 0.8).normalize();
    const right = new THREE.Vector3()
        .crossVectors(camera.up, direction)
        .normalize(),
      up = new THREE.Vector3().crossVectors(direction, right);
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let distance = 1;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const delta = new THREE.Vector3(x, y, z).sub(center),
            depth = delta.dot(direction);
          distance = Math.max(
            distance,
            Math.abs(delta.dot(right)) / (tangent * camera.aspect) + depth,
            Math.abs(delta.dot(up)) / tangent + depth,
          );
        }
    distance *= 1.2;
    controls.target.copy(center);
    camera.position.copy(center).add(direction.multiplyScalar(distance));
    camera.near = Math.max(distance / 1000, 0.01);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.15;
    controls.maxDistance = distance * 15;
    controls.update();
    render();
  }
  function resize() {
    const width = container.clientWidth,
      height = container.clientHeight;
    if (!width || !height || disposed) return;
    try {
      const changed = camera.aspect !== width / height;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (changed && !box.isEmpty()) fit();
      else render();
    } catch (error) {
      fail(error);
    }
  }
  function addLine(points: Vec3[], color: number, name: string) {
    const geometry = new THREE.BufferGeometry(),
      material = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geometry, material);
    line.name = name;
    // Own resources before populating, including on a failed display update.
    guides.add(line);
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points.flat(), 3),
    );
    for (const point of points) box.expandByPoint(new THREE.Vector3(...point));
    return line;
  }
  function select(id: CrossSectionId | null) {
    if (disposed) return;
    selectedSection = id;
    for (const child of guides.children) {
      if (!child.userData.sectionId) continue;
      const active = child.userData.sectionId === id;
      if (child.userData.frameAxis) {
        child.visible = active;
      } else {
        const line = child as THREE.Line<
          THREE.BufferGeometry,
          THREE.LineBasicMaterial
        >;
        line.material.color.setHex(active ? 0xb17655 : 0x5d7569);
        line.material.opacity = active ? 1 : 0.35;
        line.renderOrder = active ? 3 : 2;
      }
    }
    render();
  }
  function update(display: LastState["display"]) {
    if (disposed) return;
    clear();
    box.makeEmpty();
    try {
      if (display.surface) {
        const geometry = new THREE.BufferGeometry(),
          material = new THREE.MeshStandardMaterial({
            color: 0xadb9a5,
            roughness: 0.83,
            metalness: 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "shared-last-surface";
        guides.add(mesh);
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(display.surface.positions, 3),
        );
        geometry.setIndex(display.surface.indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        if (geometry.boundingBox) box.union(geometry.boundingBox);
      }
      for (const [kind, color, curves] of [
        ["top", 0x216356, display.top],
        ["bottom", 0xb15d35, display.bottom],
        [
          "section",
          0x6a6680,
          upperSectionCurves(display.section, display.bottom),
        ],
      ] as const)
        for (const curve of curves) {
          const line = addLine(curve.points, color, curve.name);
          line.userData.guide = kind;
        }
      for (const section of display.crossSections ?? []) {
        const points = section.posedSamples;
        if (!points.length) continue;
        const ring = addLine([...points, points[0]!], 0x5d7569, section.label);
        ring.userData.sectionId = section.id;
        ring.material.transparent = true;
        ring.material.depthTest = false;
        ring.material.depthWrite = false;
        const origin = new THREE.Vector3(...section.frame.origin);
        const axisLength = Math.max(section.width, section.height, 20) * 0.65;
        for (const [name, vector, color] of [
          ["transverse", section.frame.transverse, 0xb17655],
          ["up", section.frame.up, 0x597c81],
        ] as const) {
          const axis = addLine(
            [
              origin.toArray(),
              origin
                .clone()
                .addScaledVector(new THREE.Vector3(...vector), axisLength)
                .toArray(),
            ],
            color,
            `${section.frame.label} ${name}`,
          );
          axis.userData.sectionId = section.id;
          axis.userData.frameAxis = true;
          axis.material.depthTest = false;
          axis.material.depthWrite = false;
          axis.renderOrder = 4;
        }
      }
      for (const wrap of display.heelWraps ?? []) {
        if (wrap.status !== "configured" || !wrap.points.length) continue;
        const line = addLine(wrap.points, 0xa16e52, wrap.id);
        line.userData.heelWrap = wrap.id;
        line.material.depthTest = false;
        line.material.depthWrite = false;
        line.renderOrder = 3;
      }
      select(selectedSection);
      resize();
      fit();
    } catch (error) {
      fail(error);
    }
  }
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.setAttribute(
      "aria-label",
      "3D prototype shared last surface with rebuilt section rings and configured heel wraps. Drag to orbit; scroll to zoom. Use reset view to restore framing.",
    );
    renderer.domElement.addEventListener("webglcontextlost", lost);
    container.append(renderer.domElement);
    camera.up.set(0, 0, 1);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.addEventListener("change", render);
    observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    if (disposed)
      throw new Error("Unable to initialize the 3D reference viewer");
    return { update, select, fit, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
