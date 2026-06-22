// pdfjs-dist 5.x ships no `exports` map and bundles type declarations only for
// the package root. We import the Node-safe `legacy` build (no DOM globals) for
// the runtime, so re-export the root types onto that subpath to type it.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
