declare module "pdfjs-dist/build/pdf.mjs" {
  // Minimal declarations for our usage in the browser.
  // pdfjs-dist ships types, but this build path doesn't expose them cleanly to TS.
  export const getDocument: (src: unknown) => { promise: Promise<any>; destroy: () => Promise<void> };
  export const GlobalWorkerOptions: { workerSrc: string };
}

