"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { HeelMesh } from "~/lib/heel/model";
import styles from "./heel.module.css";

type CameraView = "Oblique" | "Side" | "Rear";
interface PreviewController {
  update: (mesh: HeelMesh, sections: boolean) => void;
  view: (view: CameraView) => void;
}

export function HeelPreview({ mesh }: { mesh: HeelMesh }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<PreviewController | null>(null);
  const [cameraView, setCameraView] = useState<CameraView>("Oblique");
  const [sections, setSections] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      // The numeric editor and exact projected meshes remain usable without WebGL.
      queueMicrotask(() => setUnavailable(true));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#e9ede6");
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Generated heel solid. Drag to rotate, scroll to zoom.",
    );
    renderer.domElement.setAttribute("role", "img");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 3000);
    camera.up.set(0, 0, 1);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.minDistance = 45;
    orbit.maxDistance = 650;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x536156, 2.5);
    hemi.position.set(0, 0, 200);
    scene.add(hemi);
    const light = new THREE.DirectionalLight(0xfff8ea, 3.8);
    light.position.set(-100, -70, 210);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, {
      left: -130,
      right: 130,
      top: 150,
      bottom: -100,
      near: 1,
      far: 500,
    });
    light.shadow.normalBias = 0.4;
    scene.add(light);
    const fill = new THREE.DirectionalLight(0xc2d8d2, 1.8);
    fill.position.set(90, 100, 80);
    scene.add(fill);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: "#e9ede6", roughness: 1 }),
    );
    plane.position.set(0, 25, -0.15);
    plane.receiveShadow = true;
    scene.add(plane);
    const grid = new THREE.GridHelper(300, 30, 0xa3b2a8, 0xd0d9cf);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 25, -0.08);
    scene.add(grid);
    const solidMaterial = new THREE.MeshStandardMaterial({
      color: 0x426f64,
      roughness: 0.34,
      metalness: 0.12,
      side: THREE.FrontSide,
    });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xd7e9d7 });
    const sectionMaterial = new THREE.LineBasicMaterial({
      color: 0x92b5a3,
      transparent: true,
      opacity: 0.65,
    });
    const body = new THREE.Mesh(new THREE.BufferGeometry(), solidMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);
    const outlines = new THREE.Group();
    scene.add(outlines);
    const clearOutlines = () => {
      for (const child of [...outlines.children]) {
        if (child instanceof THREE.LineLoop)
          (child.geometry as THREE.BufferGeometry).dispose();
        outlines.remove(child);
      }
    };
    let target = new THREE.Vector3(0, 25, 35);
    let distance = 230;
    const view = (name: CameraView) => {
      const direction =
        name === "Side"
          ? new THREE.Vector3(1, 0, 0.03)
          : name === "Rear"
            ? new THREE.Vector3(0, -1, 0.03)
            : new THREE.Vector3(-1.25, -1.5, 0.8).normalize();
      camera.position.copy(target).addScaledVector(direction, distance);
      orbit.target.copy(target);
      orbit.update();
    };
    controller.current = {
      view,
      update(next, showSections) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(next.positions.flat(), 3),
        );
        geometry.setIndex(next.triangles.flat());
        geometry.computeVertexNormals();
        body.geometry.dispose();
        body.geometry = geometry;
        clearOutlines();
        const boundaries = [next.caps.bottom.boundary, next.caps.top.boundary];
        if (showSections) {
          for (const fraction of [0.25, 0.5, 0.75]) {
            boundaries.push(
              next.sections[Math.round((next.sections.length - 1) * fraction)]!
                .boundary,
            );
          }
        }
        for (const [index, boundary] of boundaries.entries()) {
          const line = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(
              boundary.map((id) => new THREE.Vector3(...next.positions[id]!)),
            ),
            index < 2 ? edgeMaterial : sectionMaterial,
          );
          outlines.add(line);
        }
        const [min, max] = [next.bounds.min, next.bounds.max];
        target = new THREE.Vector3(
          (min[0] + max[0]) / 2,
          (min[1] + max[1]) / 2,
          (min[2] + max[2]) / 2,
        );
        distance = Math.max(
          170,
          (max[2] - min[2]) * 2.8,
          (max[1] - min[1]) * 2.8,
        );
      },
    };
    view("Oblique");
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth,
        height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(container);
    renderer.setAnimationLoop(() => {
      orbit.update();
      renderer.render(scene, camera);
    });
    return () => {
      controller.current = null;
      resize.disconnect();
      renderer.setAnimationLoop(null);
      orbit.dispose();
      clearOutlines();
      body.geometry.dispose();
      solidMaterial.dispose();
      edgeMaterial.dispose();
      sectionMaterial.dispose();
      plane.geometry.dispose();
      plane.material.dispose();
      grid.geometry.dispose();
      const gridMaterials: THREE.Material[] = Array.isArray(grid.material)
        ? (grid.material as THREE.Material[])
        : [grid.material];
      gridMaterials.forEach((material) => material.dispose());
      light.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    controller.current?.update(mesh, sections);
  }, [mesh, sections]);
  useEffect(() => {
    controller.current?.view(cameraView);
  }, [cameraView]);

  return (
    <section className={styles.preview} aria-label="Solid preview">
      <div className={styles.panelHeading}>
        <div>
          <span className={styles.kicker}>01 / GENERATED SOLID</span>
          <h2>Form in space</h2>
        </div>
        <span className={styles.liveBadge}>LIVE</span>
      </div>
      <div
        className={styles.cameraButtons}
        role="group"
        aria-label="Preview camera"
      >
        {(["Oblique", "Side", "Rear"] as const).map((view) => (
          <button
            key={view}
            type="button"
            aria-pressed={cameraView === view}
            onClick={() => {
              setCameraView(view);
              controller.current?.view(view);
            }}
          >
            {view}
          </button>
        ))}
      </div>
      <div
        className={styles.scene}
        ref={host}
        data-testid="heel-solid-preview"
      />
      {unavailable && (
        <p className={styles.webglFallback}>
          3D preview unavailable in this browser. Exact mesh projections remain
          available.
        </p>
      )}
      <div className={styles.previewFooter}>
        <span>Drag to orbit · scroll to zoom</span>
        <label>
          <input
            type="checkbox"
            checked={sections}
            onChange={(event) => setSections(event.target.checked)}
          />{" "}
          Sections
        </label>
      </div>
      <span className={styles.groundTag}>GROUND / z = 0 mm</span>
    </section>
  );
}
