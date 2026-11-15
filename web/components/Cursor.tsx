"use client";

import { useEffect, useRef } from "react";

/** A trailing glow ring plus a page spotlight. Mouse-only; off for touch and prefers-reduced-motion. The native cursor stays. */
export function Cursor() {
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!matchMedia("(pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ring.current!;
    let x = -100, y = -100, rx = x, ry = y, frame = 0;
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      document.documentElement.style.setProperty("--mx", `${x}px`);
      document.documentElement.style.setProperty("--my", `${y}px`);
      el.dataset.hover = String(!!(e.target as Element).closest("a,button,input,select,textarea,label,.interactive"));
      el.dataset.on = "true";
    };
    const tick = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      el.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      frame = requestAnimationFrame(tick);
    };
    const leave = () => (el.dataset.on = "false");
    addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    frame = requestAnimationFrame(tick);
    return () => {
      removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={ring} aria-hidden className="cursor-ring" data-on="false" />;
}
