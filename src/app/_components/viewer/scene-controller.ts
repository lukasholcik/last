import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { LastState } from "~/lib/geometry/types";

export interface SceneController {
  update: (display: LastState["display"]) => void;
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
    disposed = false;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(36, 1, 0.01, 10000);
  const guides = new THREE.Group(),
    box = new THREE.Box3();
  scene.add(guides);
  function clear() {
    for (const child of [...guides.children]) {
      guides.remove(child);
      const line = child as THREE.Line<
        THREE.BufferGeometry,
        THREE.LineBasicMaterial
      >;
      line.geometry.dispose();
      line.material.dispose();
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
  function update(display: LastState["display"]) {
    if (disposed) return;
    clear();
    box.makeEmpty();
    try {
      for (const [kind, color] of [
        ["top", 0x216356],
        ["bottom", 0xb15d35],
      ] as const)
        for (const curve of display[kind]) {
          const geometry = new THREE.BufferGeometry(),
            material = new THREE.LineBasicMaterial({ color });
          // Attach before populating so a subsequent error still has a disposable owner.
          const line = new THREE.Line(geometry, material);
          line.name = curve.name;
          guides.add(line);
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(curve.points.flat(), 3),
          );
          for (const point of curve.points)
            box.expandByPoint(new THREE.Vector3(...point));
        }
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
      "3D reference guides. Drag to orbit; scroll to zoom. Use reset view to restore framing.",
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
    return { update, fit, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
