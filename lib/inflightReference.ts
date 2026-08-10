// The middle of N8318B's in-cockpit card — takeoff, climb, cruise, descent —
// plus the field frequencies printed in its corner.
//
// Reference only, deliberately. These are read in the air, where the app is in
// somebody's pocket and nothing is going to get ticked; the tickable flows stop
// at the hold-short line (lib/checkouts.ts) and pick up again after landing.
// Modelling them as a separate type is what keeps them out of the sign-off
// arithmetic — a "cruise" item can't be an unticked box blocking a sign-off.
//
// Values are transcribed from the card as printed. The airspeeds are MPH: this
// is a 1957 airplane with an MPH airspeed indicator, not a knots one.

export interface ReferenceItem {
  label: string;
  /** The right-hand column on the card: what the item should be set to. */
  action: string;
}

export interface ReferencePhase {
  id: string;
  title: string;
  items: ReferenceItem[];
}

export const INFLIGHT_PHASES: ReferencePhase[] = [
  {
    id: "takeoff",
    title: "Takeoff",
    items: [
      { label: "Airspeed & oil", action: "Alive & green" },
      { label: "Rotate", action: "55–60 MPH" },
    ],
  },
  {
    id: "climb",
    title: "Climb",
    items: [
      { label: "Flaps", action: "Retract slowly" },
      { label: "Mixture", action: "Rich below 3000 ft" },
    ],
  },
  {
    id: "cruise",
    title: "Cruise",
    items: [
      { label: "Lights", action: "As required" },
      { label: "Ammeter", action: "Normal charge" },
      { label: "Power", action: "2200–2450 RPM @ S.L." },
      { label: "Mixture", action: "Lean RoP or LoP" },
      { label: "Temperatures", action: "Steady" },
    ],
  },
  {
    id: "descent",
    title: "Descent / before landing",
    items: [
      { label: "Weather / ATIS", action: "As required" },
      { label: "Altimeter", action: "Set" },
      { label: "Gas / fuel selector", action: "Both" },
      { label: "Mixture", action: "Enrich as required" },
      { label: "Carb heat", action: "As required" },
      { label: "Primer", action: "In & locked" },
      { label: "Seat belts", action: "On" },
      { label: "Lights", action: "As required" },
    ],
  },
];

/** The frequency block from the corner of the card. */
export const FIELD_FREQUENCIES = {
  field: "Boeing Field (KBFI)",
  entries: [
    { label: "ATIS", value: "127.75" },
    { label: "Ground", value: "121.9" },
    { label: "Tower (VFR E)", value: "118.3" },
    { label: "Tower (IFR)", value: "120.6" },
    { label: "Seattle App (N)", value: "120.4" },
    { label: "Seattle VOR", value: "116.80" },
    { label: "Seattle FSS", value: "122.5" },
    { label: "Emergency", value: "121.5" },
  ],
} as const;
