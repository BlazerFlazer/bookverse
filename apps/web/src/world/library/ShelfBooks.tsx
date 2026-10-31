import { useCursor } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, Color, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three';
import type { BookSummaryDto } from '@bookverse/shared';
import { useWorld } from '../../stores/world.ts';
import { coverSpecOf } from '../assets.ts';
import { BOOK_H, BOOK_W } from '../book/geometry.ts';
import { rt } from '../runtime.ts';
import { makeSpineCanvas } from '../textures/cover.ts';
import { HALL, REAL_BOOK_SLOTS, bayCenterZ, slotPosition, type ShelfSlot } from './layout.ts';

export const SHELF_BOOK_SCALE = 0.24;

/** Толщина книги зависит от настоящего объёма текста. */
export function bookThickness(totalWords: number): number {
  return Math.min(0.3, 0.1 + Math.sqrt(totalWords) / 620);
}

export function slotFor(index: number): ShelfSlot {
  return REAL_BOOK_SLOTS[index % REAL_BOOK_SLOTS.length]!;
}

function ShelfBook({ book, slot, onPick, onHover }: { book: BookSummaryDto; slot: ShelfSlot; onPick: (book: BookSummaryDto) => void; onHover: (book: BookSummaryDto | null) => void }) {
  const mesh = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const flying = useWorld((s) => s.flying?.publicId === book.publicId);
  const stage = useWorld((s) => s.stage);
  useCursor(hovered && stage === 'library');

  const thickness = bookThickness(book.totalWords) * SHELF_BOOK_SCALE;
  const materials = useMemo(() => {
    const spine = new CanvasTexture(makeSpineCanvas(coverSpecOf(book), 640));
    spine.colorSpace = SRGBColorSpace;
    spine.anisotropy = 4;
    const leather = new MeshStandardMaterial({ color: new Color(book.cover.leather), roughness: 0.55 });
    const pages = new MeshStandardMaterial({ color: '#d9c7a2', roughness: 0.85 });
    const face = new MeshStandardMaterial({ map: spine, roughness: 0.45, emissive: new Color('#ffb060'), emissiveMap: spine, emissiveIntensity: 0.08 });
    return [face, pages, pages, pages, leather, leather];
  }, [book]);

  useEffect(() => () => {
    (materials[0]!.map as CanvasTexture).dispose();
    materials.forEach((m) => m.dispose());
  }, [materials]);

  const [x, y, z] = slotPosition(slot);
  // Настоящие книги чуть светятся, чтобы их было легко заметить среди декорации.
  useFrame((state) => {
    const face = materials[0]!;
    const breath = 0.1 + Math.sin(state.clock.elapsedTime * 1.6 + z) * 0.05;
    const target = hovered ? 0.55 : breath;
    face.emissiveIntensity += (target - face.emissiveIntensity) * 0.12;
    if (mesh.current) {
      const out = hovered && stage === 'library' ? 0.07 : 0;
      const base = slot.side * (HALL.wall - 0.18);
      mesh.current.position.x += (base - slot.side * out - mesh.current.position.x) * 0.14;
    }
  });

  return (
    <mesh
      ref={mesh}
      visible={!flying}
      position={[x, y, z]}
      rotation={[0, slot.side === -1 ? 0 : Math.PI, 0]}
      material={materials}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        onHover(book);
      }}
      onPointerOut={() => {
        setHovered(false);
        onHover(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onPick(book);
      }}
    >
      <boxGeometry args={[BOOK_W * SHELF_BOOK_SCALE, BOOK_H * SHELF_BOOK_SCALE, thickness]} />
    </mesh>
  );
}

/** Невидимые зоны пролётов: клик приближает камеру к полке. */
function BayTargets({ onFocus }: { onFocus: (side: -1 | 1, bay: number) => void }) {
  const bays = [0, 1, 2];
  return (
    <>
      {bays.flatMap((bay) =>
        ([-1, 1] as const).map((side) => (
          <mesh
            key={`${side}-${bay}`}
            position={[side * (HALL.wall - 0.3), 2.4, bayCenterZ(bay)]}
            rotation={[0, -side * Math.PI / 2, 0]}
            onClick={(event) => {
              event.stopPropagation();
              onFocus(side, bay);
            }}
          >
            <planeGeometry args={[HALL.bay - 0.6, 4.6]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        )),
      )}
    </>
  );
}

export function ShelfBooks({ books, onPick, onHover, onFocus }: { books: BookSummaryDto[]; onPick: (book: BookSummaryDto) => void; onHover: (book: BookSummaryDto | null) => void; onFocus: (side: -1 | 1, bay: number) => void }) {
  const stage = useWorld((s) => s.stage);
  return (
    <>
      {stage === 'library' && <BayTargets onFocus={onFocus} />}
      {books.slice(0, REAL_BOOK_SLOTS.length).map((book, index) => (
        <ShelfBook key={book.publicId} book={book} slot={slotFor(index)} onPick={onPick} onHover={onHover} />
      ))}
    </>
  );
}

/** Прожектор на выбранной книге. Стоит вне зала, чтобы число источников света не менялось. */
export function SelectedSpot() {
  const light = useRef<import('three').SpotLight>(null);
  useFrame(() => {
    if (!light.current) return;
    light.current.intensity = rt.library.spot * 34;
    light.current.position.copy(rt.library.spotPos);
    light.current.target.position.copy(rt.vortex.center);
    light.current.target.updateMatrixWorld();
  });
  return <spotLight ref={light} angle={0.46} penumbra={0.9} distance={9} decay={1.5} color="#ffd9a4" intensity={0} />;
}
