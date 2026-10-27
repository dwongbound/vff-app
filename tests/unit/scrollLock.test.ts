import { describe, expect, it } from "vitest";
import { createScrollLock, type Lockable } from "@/lib/scrollLock";

const scroller = (overflow = ""): Lockable => ({ style: { overflow } });

describe("createScrollLock", () => {
  it("freezes the scroller and puts it back", () => {
    const el = scroller();
    const lock = createScrollLock(() => el);
    const release = lock.lock();
    expect(el.style.overflow).toBe("hidden");
    expect(lock.isLocked()).toBe(true);
    release();
    expect(el.style.overflow).toBe("");
    expect(lock.isLocked()).toBe(false);
  });

  it("restores whatever overflow was there before", () => {
    const el = scroller("scroll");
    const lock = createScrollLock(() => el);
    lock.lock()();
    expect(el.style.overflow).toBe("scroll");
  });

  it("stays frozen until the LAST holder lets go, in any order", () => {
    // A date picker inside a modal: the modal closes first, the picker after.
    const el = scroller();
    const lock = createScrollLock(() => el);
    const modal = lock.lock();
    const picker = lock.lock();
    modal();
    expect(el.style.overflow).toBe("hidden");
    expect(lock.isLocked()).toBe(true);
    picker();
    expect(el.style.overflow).toBe("");
    expect(lock.isLocked()).toBe(false);
  });

  it("ignores a second release from the same holder", () => {
    const el = scroller();
    const lock = createScrollLock(() => el);
    const a = lock.lock();
    lock.lock(); // b, still open
    a();
    a();
    expect(el.style.overflow).toBe("hidden");
    expect(lock.isLocked()).toBe(true);
  });

  it("thaws the element it froze, even if the scroller changed since", () => {
    const first = scroller();
    const second = scroller();
    let current = first;
    const lock = createScrollLock(() => current);
    const release = lock.lock();
    current = second;
    release();
    expect(first.style.overflow).toBe("");
    expect(second.style.overflow).toBe("");
  });

  it("counts holders even before the shell has mounted", () => {
    const lock = createScrollLock(() => null);
    const release = lock.lock();
    expect(lock.isLocked()).toBe(true);
    release();
    expect(lock.isLocked()).toBe(false);
  });

  it("takes a fresh reading for each new freeze", () => {
    const el = scroller();
    const lock = createScrollLock(() => el);
    lock.lock()();
    el.style.overflow = "auto";
    const release = lock.lock();
    release();
    expect(el.style.overflow).toBe("auto");
  });
});
