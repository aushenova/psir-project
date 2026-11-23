// SYNTHETIC DEMONSTRATION ATTRIBUTES — NOT REAL OBSERVATIONS.
//
// OpenStreetMap contains almost no accessibility details for crossings in the
// pilot area (audible signals, tactile paving, pictogram signals). To show how
// the routing logic WOULD use such data, a few crossings receive invented demo
// values below. They are labelled "Synthetic demo" everywhere in the interface
// and must never be read as statements about real infrastructure in Astana.
//
// Fields: audible ("yes" | "no" | "faulty"), tactile ("yes" | "no"),
//         visualSignal ("yes" = pictogram/countdown, "no" = colour-only), kerb ("flush" | "lowered" | "raised")
window.QA_DEMO_ATTRIBUTES = [
  { segment: "S1653", set: { audible: "faulty" },                                  note: "Demo: audible signal marked as faulty" },
  { segment: "S2450", set: { tactile: "no", visualSignal: "no" },                  note: "Demo: no tactile paving, colour-only signal" },
  { segment: "S2372", set: { audible: "yes", tactile: "yes", visualSignal: "yes", kerb: "lowered" }, note: "Demo: fully equipped crossing" },
  { segment: "S2451", set: { audible: "yes", tactile: "yes", visualSignal: "yes", kerb: "lowered" }, note: "Demo: fully equipped crossing" },
  { segment: "S2374", set: { kerb: "lowered" },                                     note: "Demo: lowered kerb" }
];
