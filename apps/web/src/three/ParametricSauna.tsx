import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { boardTexture } from './textures.ts';
import type { ViewerOptions, ViewerSpecs } from './types.ts';

/**
 * A convincing cabin built from numbers alone (width/depth/height in mm,
 * wood colour, door, lighting), so every catalogue model renders even before
 * its GLB exists: board-textured walls, a glass front or door, two bench
 * levels visible through the glass, a roof fascia, and the selected lights.
 */

const WALL = 0.07;

function useBoards(color: string, repeatX: number, repeatY = 1, horizontal = false) {
  const tex = useMemo(() => {
    const t = boardTexture(color, 8, horizontal).clone();
    t.needsUpdate = true;
    t.repeat.set(repeatX, repeatY);
    return t;
  }, [color, repeatX, repeatY, horizontal]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

function glassProps(door: ViewerOptions['door']): { color: string; opacity: number; roughness: number } {
  switch (door) {
    case 'bronze':
      return { color: '#5a3d22', opacity: 0.5, roughness: 0.08 };
    case 'satin':
      return { color: '#f3f3f0', opacity: 0.78, roughness: 0.6 };
    default:
      return { color: '#cfe1e3', opacity: 0.2, roughness: 0.04 };
  }
}

function Glass({ door, w, h, position, rotation }: { door: ViewerOptions['door']; w: number; h: number; position: [number, number, number]; rotation?: [number, number, number] }) {
  const g = glassProps(door);
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <boxGeometry args={[w, h, 0.012]} />
        <meshStandardMaterial color={g.color} transparent opacity={g.opacity} roughness={g.roughness} metalness={0.1} depthWrite={false} />
      </mesh>
      {/* black frame */}
      {[
        [0, h / 2 - 0.012, w, 0.024],
        [0, -h / 2 + 0.012, w, 0.024],
        [-w / 2 + 0.012, 0, 0.024, h],
        [w / 2 - 0.012, 0, 0.024, h],
      ].map(([x, y, fw, fh], i) => (
        <mesh key={i} position={[x!, y!, 0]}>
          <boxGeometry args={[fw!, fh!, 0.03]} />
          <meshStandardMaterial color="#1b1b1a" roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Benches({ w, d, h, wood, options }: { w: number; d: number; h: number; wood: THREE.Texture; options: ViewerOptions }) {
  const inner = w - WALL * 2 - 0.02;
  const lower = Math.min(0.45, h * 0.22);
  const upper = Math.min(1.0, h * 0.48);
  const depthUpper = Math.min(0.6, d * 0.42);
  const depthLower = Math.min(0.45, d * 0.28);
  const back = -d / 2 + WALL;
  return (
    <group>
      <mesh position={[0, upper, back + depthUpper / 2]} castShadow receiveShadow>
        <boxGeometry args={[inner, 0.045, depthUpper]} />
        <meshStandardMaterial map={wood} roughness={0.8} />
      </mesh>
      <mesh position={[0, upper / 2, back + depthUpper - 0.02]}>
        <boxGeometry args={[inner, upper, 0.02]} />
        <meshStandardMaterial map={wood} roughness={0.85} />
      </mesh>
      <mesh position={[0, lower, back + depthUpper + depthLower / 2]} castShadow receiveShadow>
        <boxGeometry args={[inner, 0.045, depthLower]} />
        <meshStandardMaterial map={wood} roughness={0.8} />
      </mesh>
      {/* backrest boards */}
      {[0.2, 0.36].map(y => (
        <mesh key={y} position={[0, upper + y, back + 0.03]}>
          <boxGeometry args={[inner, 0.08, 0.025]} />
          <meshStandardMaterial map={wood} roughness={0.8} />
        </mesh>
      ))}
      {options.backrestLight && (
        <>
          <mesh position={[0, upper + 0.12, back + 0.02]}>
            <boxGeometry args={[inner * 0.96, 0.012, 0.01]} />
            <meshStandardMaterial color="#ffd9a0" emissive="#ffb35c" emissiveIntensity={3} toneMapped={false} />
          </mesh>
          <pointLight position={[0, upper + 0.3, back + 0.25]} intensity={0.9} distance={2.4} color="#ffb870" />
        </>
      )}
      {options.benchLight && (
        <>
          <mesh position={[0, upper - 0.04, back + depthUpper - 0.04]}>
            <boxGeometry args={[inner * 0.96, 0.01, 0.01]} />
            <meshStandardMaterial color="#ffd9a0" emissive="#ffb35c" emissiveIntensity={3} toneMapped={false} />
          </mesh>
          <pointLight position={[0, lower + 0.1, back + depthUpper + 0.1]} intensity={0.6} distance={1.6} color="#ffb870" />
        </>
      )}
      {/* heater */}
      <group position={[inner / 2 - 0.22, 0, d / 2 - WALL - 0.3]}>
        <mesh position={[0, options.woodStove ? 0.35 : 0.45, 0]} castShadow>
          {options.woodStove ? <cylinderGeometry args={[0.2, 0.22, 0.7, 20]} /> : <boxGeometry args={[0.38, 0.55, 0.28]} />}
          <meshStandardMaterial color="#2a2a29" roughness={0.6} metalness={0.5} />
        </mesh>
        <mesh position={[0, options.woodStove ? 0.75 : 0.78, 0]}>
          <dodecahedronGeometry args={[0.13, 0]} />
          <meshStandardMaterial color="#6f6a63" roughness={1} />
        </mesh>
      </group>
    </group>
  );
}

function Stars({ w, d, y }: { w: number; d: number; y: number }) {
  const points = useMemo(() => {
    const out: [number, number, number][] = [];
    let s = 7;
    const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 40; i++) out.push([(r() - 0.5) * (w - 0.3), y, (r() - 0.5) * (d - 0.3)]);
    return out;
  }, [w, d, y]);
  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.008, 6, 6]} />
          <meshStandardMaterial color="#fff" emissive="#fff4dd" emissiveIntensity={4} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function BoxCabin({ w, d, h, options, panorama, corner }: { w: number; d: number; h: number; options: ViewerOptions; panorama?: boolean; corner?: boolean }) {
  const sideTex = useBoards(options.woodColor, Math.max(1, d / 0.9));
  const frontTex = useBoards(options.woodColor, Math.max(1, w / 0.9));
  const innerTex = useBoards(options.woodColor, Math.max(1, w / 1.2), 1, true);
  const roofTex = useBoards(options.woodColor, 3, 1, true);
  const wood = <meshStandardMaterial map={sideTex} roughness={0.78} />;
  const doorW = Math.min(0.7, w * 0.42);
  const doorH = Math.min(1.9, h * 0.9);
  const front = d / 2 - WALL / 2;
  const glassFront = panorama || corner;
  return (
    <group>
      {/* floor */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial map={innerTex} roughness={0.9} />
      </mesh>
      {/* back + sides */}
      <mesh position={[0, h / 2, -d / 2 + WALL / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, WALL]} />
        <meshStandardMaterial map={frontTex} roughness={0.78} />
      </mesh>
      <mesh position={[-w / 2 + WALL / 2, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[WALL, h, d]} />
        {wood}
      </mesh>
      {panorama ? (
        <Glass door={options.door === 'timber' ? 'clear' : options.door} w={d - 0.08} h={h - 0.1} position={[w / 2 - WALL / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} />
      ) : (
        <mesh position={[w / 2 - WALL / 2, h / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[WALL, h, d]} />
          {wood}
        </mesh>
      )}
      {/* front */}
      {glassFront ? (
        <>
          <Glass door={options.door === 'timber' ? 'clear' : options.door} w={w - 0.08} h={h - 0.1} position={[0, h / 2, front]} />
          <mesh position={[-w / 2 + doorW * 0.5 + 0.1, h * 0.48, front + 0.03]}>
            <boxGeometry args={[0.02, 0.32, 0.03]} />
            <meshStandardMaterial color="#1b1b1a" metalness={0.6} roughness={0.3} />
          </mesh>
        </>
      ) : (
        <>
          {/* wood panel left of the door, glass door on the right */}
          <mesh position={[-doorW / 2 - 0.02, h / 2, front]} castShadow>
            <boxGeometry args={[w - doorW - 0.04, h, WALL]} />
            <meshStandardMaterial map={frontTex} roughness={0.78} />
          </mesh>
          <mesh position={[w / 2 - 0.02, h / 2, front]}>
            <boxGeometry args={[0.04, h, WALL]} />
            <meshStandardMaterial map={frontTex} roughness={0.78} />
          </mesh>
          <mesh position={[w / 2 - doorW / 2 - 0.04, (h + doorH) / 2, front]}>
            <boxGeometry args={[doorW, h - doorH, WALL]} />
            <meshStandardMaterial map={frontTex} roughness={0.78} />
          </mesh>
          {options.door === 'timber' ? (
            <group position={[w / 2 - doorW / 2 - 0.04, doorH / 2, front + 0.005]}>
              <mesh castShadow>
                <boxGeometry args={[doorW, doorH, WALL * 0.8]} />
                <meshStandardMaterial map={frontTex} roughness={0.7} />
              </mesh>
              <Glass door="clear" w={0.12} h={doorH * 0.7} position={[-doorW * 0.18, 0.05, WALL * 0.42]} />
            </group>
          ) : (
            <Glass door={options.door} w={doorW} h={doorH} position={[w / 2 - doorW / 2 - 0.04, doorH / 2, front]} />
          )}
          <mesh position={[w / 2 - doorW + 0.04, doorH * 0.5, front + 0.05]}>
            <boxGeometry args={[0.025, 0.3, 0.03]} />
            <meshStandardMaterial color="#1b1b1a" metalness={0.6} roughness={0.3} />
          </mesh>
        </>
      )}
      {/* ceiling + fascia */}
      <mesh position={[0, h - 0.02, 0]} receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial map={innerTex} roughness={0.9} />
      </mesh>
      <mesh position={[0, h + 0.05, 0]} castShadow>
        <boxGeometry args={[w + 0.1, 0.1, d + 0.1]} />
        <meshStandardMaterial map={roofTex} color="#e9e2d6" roughness={0.8} />
      </mesh>
      <mesh position={[0, h + 0.11, 0]}>
        <boxGeometry args={[w + 0.06, 0.02, d + 0.06]} />
        <meshStandardMaterial color="#2b2b2a" roughness={0.9} />
      </mesh>
      <Benches w={w} d={d} h={h} wood={innerTex} options={options} />
      {options.starCeiling && <Stars w={w} d={d} y={h - 0.05} />}
    </group>
  );
}

function Barrel({ w, d, options }: { w: number; d: number; options: ViewerOptions }) {
  const r = w / 2;
  const staves = useBoards(options.woodColor, 10, 1, false);
  const g = glassProps(options.door);
  return (
    <group>
      <mesh position={[0, r + 0.12, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, d, 40, 1, true]} />
        <meshStandardMaterial map={staves} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
      {/* back disc */}
      <mesh position={[0, r + 0.12, -d / 2]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[r, 40]} />
        <meshStandardMaterial map={staves} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* front glass with timber ring */}
      <mesh position={[0, r + 0.12, d / 2]}>
        <circleGeometry args={[r * 0.97, 40]} />
        <meshStandardMaterial color={g.color} transparent opacity={g.opacity} roughness={g.roughness} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, r + 0.12, d / 2]}>
        <torusGeometry args={[r * 0.985, 0.04, 8, 48]} />
        <meshStandardMaterial map={staves} roughness={0.8} />
      </mesh>
      {/* stainless bands */}
      {[-d * 0.32, d * 0.32].map(z => (
        <mesh key={z} position={[0, r + 0.12, z]}>
          <torusGeometry args={[r + 0.012, 0.012, 6, 64]} />
          <meshStandardMaterial color="#b9bcbf" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      {/* cradles */}
      {[-d * 0.36, d * 0.36].map(z => (
        <mesh key={z} position={[0, 0.08, z]} castShadow>
          <boxGeometry args={[w * 0.92, 0.16, 0.12]} />
          <meshStandardMaterial map={staves} roughness={0.85} />
        </mesh>
      ))}
      {/* inner benches along both sides */}
      {[-1, 1].map(sx => (
        <mesh key={sx} position={[sx * r * 0.55, r * 0.75, 0]} castShadow>
          <boxGeometry args={[r * 0.5, 0.045, d * 0.8]} />
          <meshStandardMaterial map={staves} roughness={0.8} />
        </mesh>
      ))}
      {options.backrestLight && <pointLight position={[0, r * 1.2, 0]} intensity={0.8} distance={2.5} color="#ffb870" />}
    </group>
  );
}

function Hex({ w, h, options }: { w: number; h: number; options: ViewerOptions }) {
  const R = w / 2;
  const wallH = h * 0.72;
  const tex = useBoards(options.woodColor, 12);
  const roof = useBoards('#3b3936', 10, 1, true);
  const g = glassProps(options.door);
  const apothem = R * Math.cos(Math.PI / 6);
  return (
    <group>
      <mesh position={[0, wallH / 2, 0]} castShadow receiveShadow rotation={[0, Math.PI / 6, 0]}>
        <cylinderGeometry args={[R, R, wallH, 6, 1, true]} />
        <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
      <mesh position={[0, wallH + (h - wallH) * 0.42, 0]} castShadow rotation={[0, Math.PI / 6, 0]}>
        <coneGeometry args={[R * 1.14, (h - wallH) * 0.85, 6]} />
        <meshStandardMaterial map={roof} roughness={0.9} />
      </mesh>
      <mesh position={[0, h * 0.94, 0]} rotation={[0, Math.PI / 6, 0]}>
        <cylinderGeometry args={[R * 0.2, R * 0.2, h * 0.12, 6]} />
        <meshStandardMaterial map={tex} roughness={0.8} />
      </mesh>
      {/* door on the face towards the viewer */}
      <mesh position={[0, wallH * 0.45, apothem + 0.01]}>
        <planeGeometry args={[R * 0.55, wallH * 0.86]} />
        <meshStandardMaterial color={g.color} transparent opacity={Math.max(0.35, g.opacity)} roughness={g.roughness} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[R, 6]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {options.backrestLight && <pointLight position={[0, wallH * 0.7, 0]} intensity={1} distance={3} color="#ffb870" />}
    </group>
  );
}

function GardenHouse({ w, d, h, options }: { w: number; d: number; h: number; options: ViewerOptions }) {
  const wallH = h * 0.66;
  const porch = d * 0.28;
  const bodyD = d - porch;
  const tex = useBoards(options.woodColor, Math.max(2, bodyD / 0.6));
  const ftex = useBoards(options.woodColor, Math.max(2, w / 0.6));
  const roofTex = useBoards('#34322f', 8, 1, true);
  const rise = h - wallH;
  const slope = Math.hypot(w / 2 + 0.25, rise);
  const angle = Math.atan2(rise, w / 2 + 0.25);
  const g = glassProps(options.door);
  const bodyZ = -porch / 2;
  return (
    <group>
      {/* body */}
      <mesh position={[0, wallH / 2, bodyZ]} castShadow receiveShadow>
        <boxGeometry args={[w, wallH, bodyD]} />
        <meshStandardMaterial map={tex} roughness={0.8} />
      </mesh>
      {/* gable triangles */}
      {[bodyZ + bodyD / 2 + 0.001, bodyZ - bodyD / 2 - 0.001].map((z, i) => (
        <mesh key={i} position={[0, wallH, z]} rotation={[0, i ? Math.PI : 0, 0]}>
          <shapeGeometry args={[new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)])]} />
          <meshStandardMaterial map={ftex} roughness={0.8} />
        </mesh>
      ))}
      {/* roof planes */}
      {[-1, 1].map(sx => (
        <mesh key={sx} position={[(sx * (w / 2 + 0.25)) / 2, wallH + rise / 2, 0]} rotation={[0, 0, -sx * angle]} castShadow>
          <boxGeometry args={[slope, 0.06, d + 0.3]} />
          <meshStandardMaterial map={roofTex} roughness={0.95} />
        </mesh>
      ))}
      {/* deck + posts */}
      <mesh position={[0, 0.05, d / 2 - porch / 2]} receiveShadow castShadow>
        <boxGeometry args={[w, 0.1, porch]} />
        <meshStandardMaterial map={ftex} roughness={0.9} />
      </mesh>
      {[-1, 1].map(sx => (
        <mesh key={sx} position={[sx * (w / 2 - 0.08), wallH / 2, d / 2 - 0.08]} castShadow>
          <boxGeometry args={[0.1, wallH, 0.1]} />
          <meshStandardMaterial map={tex} roughness={0.8} />
        </mesh>
      ))}
      {/* door and window on the facade */}
      <mesh position={[-w * 0.2, wallH * 0.43, bodyZ + bodyD / 2 + 0.01]}>
        <planeGeometry args={[0.8, wallH * 0.86]} />
        <meshStandardMaterial color={g.color} transparent opacity={Math.max(0.35, g.opacity)} roughness={g.roughness} depthWrite={false} />
      </mesh>
      <mesh position={[w * 0.22, wallH * 0.6, bodyZ + bodyD / 2 + 0.01]}>
        <planeGeometry args={[w * 0.28, wallH * 0.36]} />
        <meshStandardMaterial color="#cfe1e3" transparent opacity={0.4} roughness={0.05} depthWrite={false} />
      </mesh>
      {options.backrestLight && <pointLight position={[0, wallH * 0.7, bodyZ]} intensity={1} distance={3} color="#ffb870" />}
    </group>
  );
}

export function ParametricSauna({ specs, options }: { specs: ViewerSpecs; options: ViewerOptions }) {
  const w = specs.widthMm / 1000;
  const d = specs.depthMm / 1000;
  const h = specs.heightMm / 1000;
  switch (specs.form) {
    case 'barrel':
      return <Barrel w={w} d={d} options={options} />;
    case 'hex':
      return <Hex w={w} h={h} options={options} />;
    case 'cabin':
      return <GardenHouse w={w} d={d} h={h} options={options} />;
    case 'panorama':
      return <BoxCabin w={w} d={d} h={h} options={options} panorama />;
    case 'corner':
      return <BoxCabin w={w} d={d} h={h} options={options} corner />;
    default:
      return <BoxCabin w={w} d={d} h={h} options={options} />;
  }
}
