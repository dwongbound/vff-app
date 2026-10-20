// A single light tap of haptic feedback, where the device will give one.
//
// Android (Chrome, Firefox) has the Vibration API. iOS has never shipped it,
// but Safari 18 plays the system's own light haptic when a SWITCH checkbox
// (`<input type="checkbox" switch>`) is toggled — including through its label
// being clicked from script inside a user gesture. That is a side effect of a
// real control rather than an API, so this is best-effort by design: on an
// older iPhone, or a desktop, it does nothing at all and nothing is lost.

let iosSwitch: HTMLLabelElement | null = null;

function switchLabel(): HTMLLabelElement {
  if (iosSwitch?.isConnected) return iosSwitch;
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  iosSwitch = label;
  return label;
}

/** One light tap. Call it from inside a user gesture (a touchend, a click). */
export function hapticTap(): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(10);
      return;
    }
    switchLabel().click();
  } catch {
    // Feedback is a nicety; never let it break the gesture that asked for it.
  }
}
