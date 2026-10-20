"use client";
// Drag a phone sheet by its grip: down to close, up to make it taller, and an
// expanded sheet back down to where it opened. The rules (how far, how fast,
// which way) are lib/sheetDrag.ts; this is the pointer plumbing.
//
// It writes straight to the panel's inline style while a finger is down
// rather than through React state: a re-render per pointermove is a dropped
// frame on an old phone, and the sheet is the one thing on screen that has to
// stay glued to the thumb. Every inline style it sets is taken back off once
// the sheet comes to rest — a panel left holding a transform is the
// containing block for every `fixed` popover inside it (see globals.css).
//
// Phones only: from `sm` up the modal is a centred card, which has no edge to
// be dragged back into.
import { PointerEvent as ReactPointerEvent, RefObject, useCallback, useRef, useState } from "react";
import {
  EXPANDED_RATIO,
  backdropFade,
  dragOffset,
  sheetRelease,
} from "@/lib/sheetDrag";

/** How long the sheet takes to settle after a release, in step with the CSS below. */
const SETTLE_MS = 300;
const SETTLE = `transform ${SETTLE_MS}ms var(--ease-drawer), height ${SETTLE_MS}ms var(--ease-drawer)`;
/** Below `sm` — the sheet layout. */
const PHONE_QUERY = "(max-width: 639.98px)";

interface Drag {
  pointerId: number;
  startY: number;
  lastY: number;
  lastT: number;
  velocity: number;
  height: number;
  /** How much taller the sheet may grow before the pull starts to resist. */
  room: number;
}

export function useSheetDrag({
  panel,
  backdrop,
  canExpand,
  onClose,
}: {
  panel: RefObject<HTMLDivElement | null>;
  backdrop: RefObject<HTMLDivElement | null>;
  canExpand: boolean;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const drag = useRef<Drag | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const el = panel.current;
      if (!el || !e.isPrimary || e.button !== 0) return;
      if (!window.matchMedia(PHONE_QUERY).matches) return;
      // The close button lives in the grip; a tap on it is a tap, not a drag.
      if ((e.target as Element).closest("button, a, input, select, textarea")) return;
      if (settleTimer.current) clearTimeout(settleTimer.current);

      const height = el.offsetHeight;
      const max = window.innerHeight * EXPANDED_RATIO;
      drag.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        lastY: e.clientY,
        lastT: e.timeStamp,
        velocity: 0,
        height,
        room: canExpand && !expanded ? Math.max(0, max - height) : 0,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      el.style.transition = "none";
      if (backdrop.current) backdrop.current.style.transition = "none";
    },
    [panel, backdrop, canExpand, expanded]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      const el = panel.current;
      if (!d || !el || e.pointerId !== d.pointerId) return;
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) {
        // Smoothed, so one late event at release can't fake a flick.
        d.velocity = 0.7 * ((e.clientY - d.lastY) / dt) + 0.3 * d.velocity;
      }
      d.lastY = e.clientY;
      d.lastT = e.timeStamp;

      const offset = dragOffset(e.clientY - d.startY, d.room);
      if (offset >= 0) {
        el.style.transform = `translateY(${offset}px)`;
        el.style.height = "";
      } else {
        // Up: the sheet GROWS from its docked bottom edge rather than lifting
        // off it.
        el.style.transform = "";
        el.style.maxHeight = "none";
        el.style.height = `${d.height - offset}px`;
      }
      if (backdrop.current) {
        backdrop.current.style.opacity = String(backdropFade(offset, d.height));
      }
    },
    [panel, backdrop]
  );

  const finish = useCallback(
    (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const d = drag.current;
      const el = panel.current;
      if (!d || !el || e.pointerId !== d.pointerId) return;
      drag.current = null;

      const dy = e.clientY - d.startY;
      const outcome = cancelled
        ? "stay"
        : sheetRelease({ dy, velocity: d.velocity, height: d.height, expanded, canExpand });

      el.style.transition = SETTLE;
      const shade = backdrop.current;
      if (shade) {
        shade.style.transition = `opacity ${SETTLE_MS}ms var(--ease-drawer)`;
      }

      if (outcome === "close") {
        // Slide out from where the finger let go, not from the top: the
        // modal's own exit animation would snap the sheet back up first, so
        // `data-dragged` stands it down (globals.css) and this transition
        // carries the sheet the rest of the way.
        el.dataset.dragged = "";
        el.style.transform = "translateY(100%)";
        if (shade) shade.style.opacity = "0";
        onClose();
        return;
      }

      if (shade) shade.style.opacity = "";
      el.style.transform = "";

      if (expanded && outcome === "stay") {
        // A pull up on an already-expanded sheet only met the rubber band.
        el.style.height = `${EXPANDED_RATIO * 100}dvh`;
      } else if (outcome === "expand") {
        el.style.maxHeight = "none";
        el.style.height = `${EXPANDED_RATIO * 100}dvh`;
        setExpanded(true);
      } else if (outcome === "collapse" || !expanded) {
        // Back to the height it opens at. That height is `auto`, which can't
        // be transitioned to, so measure it, then animate to the number.
        const from = el.offsetHeight;
        el.style.transition = "none";
        el.style.height = "";
        el.style.maxHeight = "";
        const to = el.offsetHeight;
        el.style.height = `${from}px`;
        el.style.maxHeight = "none";
        void el.offsetHeight; // commit `from` before the transition starts
        el.style.transition = SETTLE;
        el.style.height = `${to}px`;
        setExpanded(false);
      }

      settleTimer.current = setTimeout(() => {
        el.style.transition = "";
        if (outcome === "expand" || (expanded && outcome === "stay")) return;
        el.style.height = "";
        el.style.maxHeight = "";
      }, SETTLE_MS);
    },
    [panel, backdrop, canExpand, expanded, onClose]
  );

  return {
    expanded,
    /** Back to the opening height — for a modal that is opening again. */
    reset: () => setExpanded(false),
    gripProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => finish(e, false),
      onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
    },
  };
}
