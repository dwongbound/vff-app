"use client";
// Is the browser online, as far as it can tell?
//
// `navigator.onLine` is a weak signal and it is important to be honest about
// why: it reports whether the device has a network INTERFACE, not whether
// anything is reachable through it. A phone latched onto an FBO's captive
// portal reads as online while nothing gets through, and a phone that has just
// woken up can read as offline a moment before it reconnects.
//
// That is fine for the one job it has here, which is to EXPLAIN a failure that
// has already happened — the request was tried, it didn't land, and this is the
// difference between "no connection" and "back in range" in the message that
// follows. Nothing in this app may refuse to SEND something because this hook
// says false: the request itself is the only real test of a connection, and a
// member on a bad signal must always be allowed to press the button.
import { useEffect, useState } from "react";

export function useOnline(): boolean {
  // Optimistic on the first render, deliberately. That render also happens on
  // the server, where there is no `navigator` at all, and an app that flashes
  // "you are offline" during every cold load has taught its members to read
  // past the one message that will later matter.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const read = () => setOnline(navigator.onLine);
    // Read once on mount as well as on the events: the page may well have been
    // opened while already offline, which fires neither.
    read();
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    return () => {
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
    };
  }, []);

  return online;
}
