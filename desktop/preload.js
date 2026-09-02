// Deliberately empty.
//
// The renderer is a plain web page served over loopback by the packaged Next
// server — it needs nothing from Electron, so nothing is exposed to it. The
// file exists only so `contextIsolation: true` has a preload to point at, and
// so adding a bridge later is an edit rather than a redesign.
