'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPixelatedPass } from 'three/examples/jsm/postprocessing/RenderPixelatedPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { buildGlobeTexture } from './globe_texture';
import { GLOBE_VARIANTS, type GlobeVariant, type GlobeVariantConfig } from './variants';

export interface GlobeProps {
  variant?: GlobeVariant;
  /** Overrides the variant's default block size for the pixelation pass. */
  pixelSize?: number;
  oceanColor?: string;
  landColor?: string;
  borderColor?: string;
  /** Stroke country contours (coastlines + borders). */
  showBorders?: boolean;
  borderWidth?: number;
  showAtmosphere?: boolean;
  /** Phong shading + lights, vs. flat full-bright. */
  lit?: boolean;
  ambientIntensity?: number;
  lightIntensity?: number;
  autoRotate?: boolean;
  /** Auto-rotate speed (OrbitControls units). */
  rotateSpeed?: number;
  /** Axial tilt in degrees. */
  tilt?: number;
  interactive?: boolean;
  className?: string;
}

const ATMOSPHERE_VERTEX = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMOSPHERE_FRAGMENT = `
  varying vec3 vNormal;
  uniform vec3 uColor;
  void main() {
    float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
    gl_FragColor = vec4(uColor, 1.0) * intensity;
  }
`;

const PALETTE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Snap every rendered pixel to the nearest palette colour so the pixelated
// globe stays a hard 2–3 colours instead of muddy anti-aliased blends.
//
// The output is premultiplied, which the transparent background makes
// load-bearing: the canvas composites as premultiplied alpha, so emitting a
// palette colour at alpha 0 would *add* that colour to whatever is behind the
// canvas and wash the page over the globe's whole rectangle.
const PALETTE_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform vec3 uPalette[4];
  uniform int uCount;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    vec3 best = uPalette[0];
    float bestD = 1e9;
    for (int i = 0; i < 4; i++) {
      if (i >= uCount) break;
      float d = distance(c.rgb, uPalette[i]);
      if (d < bestD) { bestD = d; best = uPalette[i]; }
    }
    gl_FragColor = vec4(best * c.a, c.a);
  }
`;

/** Hex → linear-space vec3, matching the composer's working colour space. */
function paletteVec(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

function makePalettePass(palette: THREE.Vector3[]): ShaderPass {
  const filled = palette.slice(0, 4);
  while (filled.length < 4) filled.push((filled[filled.length - 1] ?? new THREE.Vector3()).clone());
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uPalette: { value: filled },
      uCount: { value: Math.min(palette.length, 4) },
    },
    vertexShader: PALETTE_VERTEX,
    fragmentShader: PALETTE_FRAGMENT,
  });
}

export function Globe({
  variant = 'realistic',
  pixelSize,
  oceanColor,
  landColor,
  borderColor,
  showBorders,
  borderWidth,
  showAtmosphere,
  lit,
  ambientIntensity,
  lightIntensity,
  autoRotate = true,
  rotateSpeed,
  tilt,
  interactive = true,
  className,
}: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Applied live each frame so dragging speed/tilt doesn't rebuild the scene.
  const motionRef = useRef({ rotateSpeed: 0.6, tilt: 23.5 });
  motionRef.current.rotateSpeed = rotateSpeed ?? 0.6;
  motionRef.current.tilt = tilt ?? 23.5;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const base = GLOBE_VARIANTS[variant];
    const oceanEff = oceanColor ?? base.palette.ocean;
    const landEff = landColor ?? base.palette.land;
    const showBordersEff = showBorders ?? base.texture.borderWidth > 0;
    // Always stroke country outlines: with the border colour when borders are
    // on, otherwise with the land colour to seal the anti-aliased seams that
    // would otherwise show faint lines between adjacent country fills.
    const strokeColorEff = showBordersEff ? (borderColor ?? base.palette.border) : landEff;
    const strokeWidthEff = showBordersEff ? (borderWidth ?? (base.texture.borderWidth || 0.75)) : 1;
    const effectivePixelSize = pixelSize ?? base.pixelSize;
    const pixelated = effectivePixelSize !== null;
    const config: GlobeVariantConfig = {
      ...base,
      // The pixelated look is always evenly lit — directional shading fights
      // the hard palette, so force it off regardless of the lit prop.
      lit: pixelated ? false : (lit ?? base.lit),
      atmosphere: showAtmosphere ?? base.atmosphere,
      pixelSize: effectivePixelSize,
      texture: { ...base.texture, borderWidth: strokeWidthEff },
      palette: {
        ocean: oceanEff,
        land: landEff,
        border: strokeColorEff,
        atmosphere: base.palette.atmosphere,
      },
    };
    const ambientEff = ambientIntensity ?? base.light.ambient;
    const keyEff = lightIntensity ?? base.light.key;

    const snapPalette = [paletteVec(oceanEff), paletteVec(landEff)];
    if (showBordersEff) snapPalette.push(paletteVec(strokeColorEff));

    let width = mount.clientWidth || 400;
    let height = mount.clientHeight || 400;

    const renderer = new THREE.WebGLRenderer({ antialias: !pixelated, alpha: true });
    renderer.setPixelRatio(pixelated ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    camera.position.set(0, 0, 3.6);

    // Mipmaps + anisotropy keep the spinning texture from shimmering; the
    // blocky look comes from the pixel pass, not from nearest-filtering.
    const texture = new THREE.CanvasTexture(buildGlobeTexture(config));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const segments = pixelated ? 48 : 96;
    const geometry = new THREE.SphereGeometry(1, segments, segments);
    const material = config.lit
      ? new THREE.MeshPhongMaterial({
          map: texture,
          shininess: 6,
          specular: new THREE.Color(0x1c3a52),
        })
      : new THREE.MeshBasicMaterial({ map: texture });
    const globeMesh = new THREE.Mesh(geometry, material);

    const group = new THREE.Group();
    group.rotation.z = THREE.MathUtils.degToRad(motionRef.current.tilt);
    group.add(globeMesh);
    scene.add(group);

    if (config.lit) {
      scene.add(new THREE.AmbientLight(0xffffff, ambientEff));
      const key = new THREE.DirectionalLight(0xffffff, keyEff);
      key.position.set(3, 1.5, 2);
      scene.add(key);
    }

    let atmosphereMesh: THREE.Mesh | null = null;
    if (config.atmosphere) {
      atmosphereMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.12, 64, 64),
        new THREE.ShaderMaterial({
          transparent: true,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          uniforms: { uColor: { value: new THREE.Color(config.palette.atmosphere) } },
          vertexShader: ATMOSPHERE_VERTEX,
          fragmentShader: ATMOSPHERE_FRAGMENT,
        }),
      );
      scene.add(atmosphereMesh);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableRotate = interactive;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = motionRef.current.rotateSpeed;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    let composer: EffectComposer | null = null;
    if (config.pixelSize !== null) {
      composer = new EffectComposer(renderer);
      const pixelPass = new RenderPixelatedPass(config.pixelSize, scene, camera);
      pixelPass.normalEdgeStrength = 0;
      pixelPass.depthEdgeStrength = 0;
      composer.addPass(pixelPass);
      composer.addPass(makePalettePass(snapPalette));
      composer.addPass(new OutputPass());
      composer.setSize(width, height);
    }

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.autoRotateSpeed = motionRef.current.rotateSpeed;
      group.rotation.z = THREE.MathUtils.degToRad(motionRef.current.tilt);
      controls.update();
      if (composer) composer.render();
      else renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      width = mount.clientWidth || width;
      height = mount.clientHeight || height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer?.setSize(width, height);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      texture.dispose();
      geometry.dispose();
      material.dispose();
      if (atmosphereMesh) {
        atmosphereMesh.geometry.dispose();
        (atmosphereMesh.material as THREE.Material).dispose();
      }
      composer?.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [
    variant,
    pixelSize,
    oceanColor,
    landColor,
    borderColor,
    showBorders,
    borderWidth,
    showAtmosphere,
    lit,
    ambientIntensity,
    lightIntensity,
    autoRotate,
    interactive,
  ]);

  return <div ref={mountRef} className={className} />;
}
