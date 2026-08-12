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

/**
 * The club's home field, as the frequency block in the corner of the card.
 *
 * KTOA — Zamperini Field, Torrance — which is where the airplane lives. (The
 * card this file was first transcribed from carried Boeing Field's block, a
 * different airplane's card in a different state.)
 *
 * The tower is split north/south, so both are here: 124.0 is the south tower
 * and is also the CTAF when the tower is closed, which is the number a member
 * wants at dusk. SoCal is split by runway — 124.3 for the 11s inbound and the
 * 29s outbound, 127.2 the other way round — so each entry says which.
 *
 * Transcribed from the FAA chart supplement data published by AirNav and
 * SkyVector (both agreeing) rather than from memory. Verify against the current
 * supplement before trusting any of it in the air: this is a convenience copy,
 * not a source of truth, and the airport is entitled to change a frequency
 * without telling this file.
 */
export const FIELD_FREQUENCIES = {
  field: "Zamperini Field (KTOA)",
  entries: [
    { label: "ATIS", value: "125.6" },
    { label: "Ground", value: "120.9" },
    { label: "Tower (S) / CTAF", value: "124.0" },
    { label: "Tower (N)", value: "133.075" },
    { label: "SoCal (11s in, 29s out)", value: "124.3" },
    { label: "SoCal (29s in, 11s out)", value: "127.2" },
    { label: "UNICOM", value: "122.95" },
    { label: "Emergency", value: "121.5" },
  ],
} as const;
