# Third-party components

Afterlight's original code, documentation and artwork use the [PolyForm Noncommercial License 1.0.0](LICENSE). The following components retain their upstream terms; they are not relicensed under Afterlight's license.

| Component | Use | License and notices |
| --- | --- | --- |
| [Mozilla PDF.js](https://github.com/mozilla/pdf.js), `pdfjs-dist` 6.4.299 | Selectable text extraction from PDFs, on the local server and in the hosted browser build | Apache License 2.0; [upstream license](licenses/pdfjs-dist-LICENSE.txt). The browser build preserves licenses supplied with copied PDF.js resources, including font and WebAssembly notices. |
| [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) 1.0.11 and its platform packages | Optional PDF.js dependency installed through npm for local use | MIT; [upstream license](licenses/napi-rs-canvas-LICENSE.txt). These binaries are not bundled in the browser deployment or application ZIP. |

Versions and integrity values are recorded in `package-lock.json`. Local application releases install dependencies with `npm ci`. The GitHub Pages build includes the locked PDF.js browser modules, worker and resource files together with their notices.

Get It, Ray Optics, LOOPY and PhET are design and scientific comparisons, not bundled dependencies. No application code or artwork from those projects is included. See [CREDITS.md](CREDITS.md) for the original generated artwork and references.
