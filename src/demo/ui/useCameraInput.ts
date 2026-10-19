import { useEffect, type RefObject } from "react";
import { panBy, zoomAt, type CameraState, type PixelPolicy, type Viewport } from "../../core";

export interface CameraInput {
  readonly host: RefObject<HTMLDivElement | null>;
  /** The camera as it stands now, or null when no scene is mounted. */
  readonly camera: () => CameraState | null;
  readonly viewport: () => Viewport;
  readonly policy: PixelPolicy;
  /** Show a new camera; the caller turns it into a `set-camera` scene change. */
  readonly apply: (camera: CameraState) => void;
}

const PAN_STEP = 24;
const ZOOM_STEP = 1.25;

/** Drag to pan, scroll to zoom about the pointer, and arrow keys and + or − on the focused view. */
export function useCameraInput(input: CameraInput): void {
  const { host, camera, viewport, policy, apply } = input;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let drag: { pointer: number; x: number; y: number } | null = null;
    const update = (change: (current: CameraState) => CameraState) => {
      const current = camera();
      if (current) apply(change(current));
    };
    const down = (event: PointerEvent) => {
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const delta = { x: event.clientX - drag.x, y: event.clientY - drag.y };
      drag = { ...drag, x: event.clientX, y: event.clientY };
      update((current) => panBy(current, delta, viewport(), policy));
    };
    const up = (event: PointerEvent) => {
      if (drag?.pointer === event.pointerId) drag = null;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      update((current) => zoomAt(current, viewport(), point, Math.exp(-event.deltaY * 0.0015), undefined, policy));
    };
    const key = (event: KeyboardEvent) => {
      const { width, height } = viewport();
      const pans: Record<string, { x: number; y: number }> = {
        ArrowLeft: { x: PAN_STEP, y: 0 }, ArrowRight: { x: -PAN_STEP, y: 0 }, ArrowUp: { x: 0, y: PAN_STEP }, ArrowDown: { x: 0, y: -PAN_STEP },
      };
      const factor = event.key === "+" || event.key === "=" ? ZOOM_STEP : event.key === "-" ? 1 / ZOOM_STEP : null;
      if (pans[event.key]) update((current) => panBy(current, pans[event.key], viewport(), policy));
      else if (factor) update((current) => zoomAt(current, viewport(), { x: width / 2, y: height / 2 }, factor, undefined, policy));
      else return;
      event.preventDefault();
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("keydown", key);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("keydown", key);
    };
  }, [host, camera, viewport, policy, apply]);
}
