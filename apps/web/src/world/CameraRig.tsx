import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { rt } from './runtime.ts';

const MAX_YAW = 1.15;
const MAX_PITCH = 0.32;

const look = new Vector3();
const offset = new Vector3();

/** Камера читает позу из rt. Поворот мышью плавный и ограничен, чтобы зал не «плавал». */
export function CameraRig() {
  const { camera, gl } = useThree();
  const free = useRef({ yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, dragging: false, x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const element = gl.domElement;
    const f = free.current;
    const down = (event: PointerEvent) => {
      if (rt.cam.freeLook <= 0) return;
      f.dragging = true;
      f.x = event.clientX;
      f.y = event.clientY;
    };
    const move = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
      if (!f.dragging) return;
      f.targetYaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, f.targetYaw - ((event.clientX - f.x) / window.innerWidth) * 2.2));
      f.targetPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, f.targetPitch - ((event.clientY - f.y) / window.innerHeight) * 1.1));
      f.x = event.clientX;
      f.y = event.clientY;
    };
    const up = () => {
      f.dragging = false;
    };
    const key = (event: KeyboardEvent) => {
      if (rt.cam.freeLook <= 0) return;
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (event.key === 'ArrowLeft') f.targetYaw = Math.min(MAX_YAW, f.targetYaw + 0.14);
      if (event.key === 'ArrowRight') f.targetYaw = Math.max(-MAX_YAW, f.targetYaw - 0.14);
    };
    element.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [gl]);

  useFrame((state, delta) => {
    const c = rt.cam;
    const f = free.current;
    const camera3 = camera as PerspectiveCamera;
    const smoothing = 1 - Math.exp(-delta * 6);
    if (c.freeLook <= 0) {
      f.targetYaw = 0;
      f.targetPitch = 0;
    }
    f.yaw += (f.targetYaw - f.yaw) * smoothing;
    f.pitch += (f.targetPitch - f.pitch) * smoothing;

    const t = state.clock.elapsedTime;
    offset.set(pointer.current.x * c.parallax, -pointer.current.y * c.parallax * 0.5, 0);
    camera.position.copy(c.pos).add(offset);
    if (c.shake > 0) {
      camera.position.x += Math.sin(t * 31) * c.shake * 0.02;
      camera.position.y += Math.sin(t * 37) * c.shake * 0.02;
    }

    look.copy(c.look).sub(c.pos);
    if (Math.abs(f.yaw) > 0.0001) look.applyAxisAngle(camera.up, f.yaw);
    look.y += f.pitch * look.length();
    look.add(camera.position);

    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    if (c.roll !== 0) camera.rotateZ(c.roll);
    if (camera3.fov !== c.fov) {
      camera3.fov = c.fov;
      camera3.updateProjectionMatrix();
    }
  });

  return null;
}
