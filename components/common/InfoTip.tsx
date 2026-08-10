"use client";
// The (i) marker next to a checkout item or a rule: hover it on a desktop,
// tap it on a phone, and it explains what the item means and why the club
// cares.
//
// It's a <button>, not a hover-only div, so it works with a finger and a
// keyboard as well as a mouse. The bubble is portaled to <body> and positioned
// with `fixed`: the checkout rows and the rules table both live inside
// clipping/scrolling ancestors that would otherwise cut it off.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BUBBLE_WIDTH = 288; // matches w-72

export default function InfoTip({
  label,
  children,
}: {
  /** What this explains, for screen readers: "Why: Rudder gust lock". */
  label: string;
  children: React.ReactNode;
}) {
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  // Hover opens the bubble; a click PINS it open. Without the distinction a
  // mouse user's click would arrive right after their hover already opened it
  // and read as "close" — which is also exactly what a touch tap looks like.
  const [pinned, setPinned] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Where the marker sat when the bubble was positioned, so a scroll can be
  // told apart from scroll events that are merely still draining — see the
  // scroll handler below.
  const anchorRef = useRef<{ top: number; left: number } | null>(null);
  const bubbleId = useId();
  const open = position !== null;

  function show() {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    anchorRef.current = { top: rect.top, left: rect.left };
    const margin = 8;
    // Keep the bubble on screen horizontally, and flip it above the marker
    // when there isn't room below.
    const left = Math.min(
      Math.max(rect.left - BUBBLE_WIDTH / 2, margin),
      window.innerWidth - BUBBLE_WIDTH - margin
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 180 && rect.top > spaceBelow;
    setPosition(
      openUp
        ? { left, bottom: window.innerHeight - rect.top + 6 }
        : { left, top: rect.bottom + 6 }
    );
  }

  function hide() {
    setPosition(null);
    anchorRef.current = null;
    setPinned(false);
  }

  // A fixed-position bubble would drift away from its marker on scroll, so
  // close it instead of chasing the element. A pinned bubble also closes on
  // Escape or a click anywhere else.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    const onOutside = (e: MouseEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) hide();
    };
    // Close on scroll only once the marker has ACTUALLY moved.
    //
    // Scroll events keep arriving for a frame or two after the scrolling
    // itself has stopped, so opening the bubble as a result of a scroll —
    // which is exactly what happens when tapping an (i) that was partly off
    // screen, since the browser scrolls it into view first — would otherwise
    // see those trailing events and close the bubble the instant it opened.
    // Comparing the marker's own rect (not window.scrollY) also covers the
    // scrollable ancestors this bubble is portaled out of.
    const onScroll = () => {
      const anchor = anchorRef.current;
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!anchor || !rect) return;
      if (Math.abs(rect.top - anchor.top) > 2 || Math.abs(rect.left - anchor.left) > 2) {
        hide();
      }
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Why: ${label}`}
        aria-expanded={open}
        aria-describedby={open ? bubbleId : undefined}
        onClick={(e) => {
          // The row behind this is itself a big tap target that ticks the
          // item — asking "why" must not also check it off.
          e.stopPropagation();
          if (pinned) {
            hide();
            return;
          }
          setPinned(true);
          show();
        }}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (!pinned) setPosition(null);
        }}
        onFocus={show}
        onBlur={() => {
          if (!pinned) setPosition(null);
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-[10px] font-bold italic leading-none text-gray-500 transition-colors hover:border-indigo-500 hover:bg-indigo-600 hover:text-white dark:border-gray-600 dark:text-gray-400"
      >
        i
      </button>

      {open &&
        createPortal(
          <div
            id={bubbleId}
            role="tooltip"
            style={{ left: position.left, top: position.top, bottom: position.bottom }}
            className="fixed z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-700 shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <p className="mb-1 font-semibold text-gray-900 dark:text-gray-100">
              {label}
            </p>
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
