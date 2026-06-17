'use client';

import { GLOBE_VARIANTS, buildGlobeTexture } from '@mapart/ui/globe';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface GlobeProject {
  id: string;
  name: string;
  year: number | null;
  lat: number;
  lng: number;
}

const GLOBE_RADIUS = 1;
const PIN_RADIUS = GLOBE_RADIUS * 1.012;

/**
 * Latitude/longitude → a point on the globe, matching three's default sphere UV
 * against an equirectangular texture (u=0 at lng −180, v=0 at the north pole).
 */
function latLngToVec3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/**
 * The visualizer home: an interactive globe with one pin per located project.
 * Hover reveals the project's name; click flies into its framed deep-zoom view.
 * Built on `@mapart/ui/globe`'s pure texture helpers with a bespoke pin + raycast
 * layer (the shared `Globe` component is decorative and has no pin model).
 */
export function GlobeHome({ projects }: { projects: GlobeProject[] }) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<GlobeProject | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const tip = tipRef.current;
    if (!mount) return;

    let width = mount.clientWidth || 800;
    let height = mount.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 0, 3.2);

    const config = GLOBE_VARIANTS.realistic;
    const texture = new THREE.CanvasTexture(buildGlobeTexture(config));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const group = new THREE.Group();
    group.rotation.z = THREE.MathUtils.degToRad(23.5);
    scene.add(group);

    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96),
      new THREE.MeshPhongMaterial({
        map: texture,
        shininess: 6,
        specular: new THREE.Color(0x1c3a52),
      }),
    );
    group.add(globe);

    // Fresnel atmosphere shell, matching the realistic variant's glow.
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.14, 64, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color(config.palette.atmosphere) } },
        vertexShader:
          'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'varying vec3 vN; uniform vec3 uColor; void main(){ float i = pow(0.62 - dot(vN, vec3(0.0,0.0,1.0)), 4.0); gl_FragColor = vec4(uColor,1.0) * i; }',
      }),
    );
    scene.add(atmosphere);

    scene.add(new THREE.AmbientLight(0xffffff, config.light.ambient));
    const key = new THREE.DirectionalLight(0xffffff, config.light.key);
    key.position.set(3, 1.5, 2);
    scene.add(key);

    // Pins — one small marker per project, parented to the globe so they spin
    // with it. `userData.project` ties a mesh back to its project for picking.
    const pinGeo = new THREE.SphereGeometry(0.018, 16, 16);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xffcf4d });
    const pinHoverMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pinMeshes: THREE.Mesh[] = [];
    for (const p of projects) {
      const mesh = new THREE.Mesh(pinGeo, pinMat);
      mesh.position.copy(latLngToVec3(p.lat, p.lng, PIN_RADIUS));
      mesh.userData.project = p;
      group.add(mesh);
      pinMeshes.push(mesh);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 5;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredMesh: THREE.Mesh | null = null;
    let pointerInside = false;

    const pick = (): THREE.Mesh | null => {
      raycaster.setFromCamera(pointer, camera);
      // Include the globe so pins on the far side (occluded) don't get picked
      // through the sphere — only accept a pin that's the closest hit.
      const hits = raycaster.intersectObjects([globe, ...pinMeshes], false);
      const first = hits[0];
      if (first && first.object !== globe) return first.object as THREE.Mesh;
      return null;
    };

    const onPointerMove = (e: PointerEvent): void => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      pointerInside = true;
    };
    const onPointerLeave = (): void => {
      pointerInside = false;
    };
    const onClick = (): void => {
      if (hoveredMesh) {
        const p = hoveredMesh.userData.project as GlobeProject;
        router.push(`/?project=${p.id}`);
      }
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('click', onClick);

    const tmp = new THREE.Vector3();
    let raf = 0;
    const animate = (): void => {
      raf = requestAnimationFrame(animate);
      controls.update();

      const next = pointerInside ? pick() : null;
      if (next !== hoveredMesh) {
        if (hoveredMesh) {
          hoveredMesh.material = pinMat;
          hoveredMesh.scale.setScalar(1);
        }
        hoveredMesh = next;
        if (next) {
          next.material = pinHoverMat;
          next.scale.setScalar(1.6);
          setHovered(next.userData.project as GlobeProject);
        } else {
          setHovered(null);
        }
        renderer.domElement.style.cursor = next ? 'pointer' : 'grab';
        controls.autoRotate = !next;
      }

      // Keep the tooltip glued to the hovered pin as the globe turns.
      if (hoveredMesh && tip) {
        hoveredMesh.getWorldPosition(tmp).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * width;
        const y = (-tmp.y * 0.5 + 0.5) * height;
        tip.style.transform = `translate(${x}px, ${y}px)`;
      }

      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      width = mount.clientWidth || width;
      height = mount.clientHeight || height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      texture.dispose();
      pinGeo.dispose();
      pinMat.dispose();
      pinHoverMat.dispose();
      globe.geometry.dispose();
      (globe.material as THREE.Material).dispose();
      atmosphere.geometry.dispose();
      (atmosphere.material as THREE.Material).dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [projects, router]);

  return (
    <div className="globe-stage">
      <div ref={mountRef} className="globe-canvas" />
      <div ref={tipRef} className="globe-tip" style={{ opacity: hovered ? 1 : 0 }}>
        {hovered && (
          <>
            <span className="globe-tip-name">{hovered.name}</span>
            {hovered.year !== null && <span className="globe-tip-year">{hovered.year}</span>}
          </>
        )}
      </div>
      <div className="globe-title">
        <h1>map.art</h1>
        <p>
          {projects.length === 0
            ? 'No located projects yet.'
            : `${projects.length} ${projects.length === 1 ? 'map' : 'maps'} · spin the globe, click a pin to explore`}
        </p>
      </div>
    </div>
  );
}
