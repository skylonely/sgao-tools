# Pinned local OCR assets

Selected, unmodified files from Tesseract.js 7.0.0 and tesseract.js-core 7.0.0 (Apache-2.0).
The browser worker uses one of the three self-contained LSTM WASM JavaScript builds:
non-SIMD, SIMD or Relaxed SIMD. Legacy engines and orientation/script-detection models are not shipped.

English and simplified Chinese are the unchanged 4.0.0_best_int traineddata.gz files from
@tesseract.js-data/eng 1.0.0 and @tesseract.js-data/chi_sim 1.0.0. Their npm package metadata
lists MIT; the underlying Tesseract trained models are provided under Apache-2.0.
See licenses/traineddata-LICENSE.txt, registry metadata in manifest.json and the upstream
https://github.com/naptha/tessdata and https://github.com/tesseract-ocr/tessdata_best projects.

All npm archives were verified against their official registry integrity values. Runtime
and model SHA-256 hashes are recorded in manifest.json. The additional C/C++ runtime,
codec, JavaScript and Emscripten notices are in licenses/; sources.json records the pinned
core submodule commits and exact notice sources. Worker minifier notices are retained.

Application code in ocr-task.js implements the five-stage protocol used by the pinned
Tesseract.js createWorker implementation. The worker is owned before initialization, so
cancel and timeout can stop both model loading and recognition. Sources are byte arrays,
never URLs. All resource URLs are explicit same-origin paths; language cacheMethod is none.
The public engine and model files may be cached by HTTP, while private inputs/results are
not persisted. Only this exact worker path receives a same-origin fetch/WASM CSP.

This version directory is immutable; future runtime or model changes require a new path.
