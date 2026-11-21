# Third-party material

The code in this repository is MIT licensed (see [LICENSE](LICENSE)). The MIT licence covers
only the code and the original assets listed at the end. Everything below keeps its own licence:
the library documents, the fonts, the embedding model and the JavaScript libraries that the
repository contains or that the public site serves. When a licence requires its text to travel
with the files, the text is included: next to the vendored files in this repository, and in
`licenses/` on the built site (written by `web-static/scripts/prepare-assets.mjs`).

Two items carry conditions the project does not fully meet yet. See
[Open licence questions](#open-licence-questions).

## Library documents

The source PDFs are not in this repository (`.gitignore` keeps them out). What is redistributed
are **excerpts** of them, cleaned (running headers, Hindi text, exercises and similar material
removed) and split into passages:

* `web-static/public/data/<collection>/passages.json`, the passage text served by the site, and
  `vectors.bin`, the bge-small embeddings of those passages;
* the evaluation questions and gold answers in `data/eval/` and `collections/cs_ai/eval/`, which
  quote short spans of the consumer-law and CS / AI documents;
* the screenshots in `docs/screenshots/`, which show passages.

Each excerpt stays under its document's licence, not under MIT. Under the share-alike licences
(CC BY-SA, CC BY-NC-SA), the excerpts are shared under the same licence as their source. Under
the non-commercial licences (NC), they may be used for non-commercial purposes only, so the
public demo is non-commercial. Each `SOURCES.csv` records the edition, the licence, where the
licence was read, the source URL and the file's SHA-256. The site shows the same attribution
under About & sources.

| collection | document | authors / publisher | licence | source |
|---|---|---|---|---|
| CS / AI | Dive into Deep Learning (PyTorch edition) | Aston Zhang, Zachary C. Lipton, Mu Li, Alexander J. Smola | CC BY-SA 4.0 (book text; its sample code is under a modified MIT licence) | https://d2l.ai/d2l-en.pdf |
| CS / AI | Pro Git, second edition | Scott Chacon, Ben Straub | CC BY-NC-SA 3.0 Unported | https://git-scm.com/book/en/v2 |
| CS / AI | Open Data Structures (pseudocode edition) | Pat Morin | CC BY 2.5 Canada | https://opendatastructures.org/ |
| CS / AI | The Python Tutorial (Python 3.13.0a0) | Guido van Rossum and the Python development team | PSF License Agreement (code examples also Zero-Clause BSD); "Copyright © 2001-2023 Python Software Foundation. All rights reserved." | https://docs.python.org/3/download.html |
| CS / AI | Think Python, 2nd edition | Allen B. Downey | CC BY-NC 3.0 Unported | https://greenteapress.com/wp/think-python-2e/ |
| Human biology | Anatomy and Physiology 2e | J. Gordon Betts et al., OpenStax (Rice University) | CC BY-NC-SA 4.0 | https://openstax.org/details/books/anatomy-and-physiology-2e |
| Physics & chemistry | College Physics 2e | Paul Peter Urone, Roger Hinrichs, OpenStax | CC BY-NC-SA 4.0 | https://openstax.org/details/books/college-physics-2e |
| Physics & chemistry | University Physics Volume 3 | William Moebs, Samuel J. Ling, Jeff Sanny, OpenStax | CC BY-NC-SA 4.0 | https://openstax.org/details/books/university-physics-volume-3 |
| Physics & chemistry | Chemistry 2e | Paul Flowers, Klaus Theopold, Richard Langley, William R. Robinson, OpenStax | CC BY-NC-SA 4.0 | https://openstax.org/details/books/chemistry-2e |
| Physics & chemistry | Organic Chemistry | John McMurry, OpenStax | CC BY-NC-SA 4.0 | https://openstax.org/details/books/organic-chemistry |
| Consumer law | The Consumer Protection Act, 2019 | Parliament of India (India Code copy) | Act of Parliament; see [Open licence questions](#open-licence-questions) | https://www.indiacode.nic.in/bitstream/123456789/18964/1/cpa.pdf |
| Consumer law | Consumer Protection (E-Commerce) Rules, 2020 | Government of India (Gazette of India) | Gazette notification: reproduction permitted (Copyright Act, 1957, s. 52(1)(q)(i)) | https://consumeraffairs.nic.in/acts-and-rules/consumer-protection |
| Consumer law | Consumer Protection (Consumer Disputes Redressal Commissions) Rules, 2020 | Government of India (Gazette of India) | as above | https://consumeraffairs.nic.in/acts-and-rules/consumer-protection |
| Consumer law | Consumer Protection (Jurisdiction of the District Commission, the State Commission and the National Commission) Rules, 2021 | Government of India (Gazette of India) | as above | https://consumeraffairs.nic.in/acts-and-rules/consumer-protection |
| Consumer law | Consumer Protection (Mediation) Rules, 2020 | Government of India (Gazette of India) | as above | https://consumeraffairs.nic.in/acts-and-rules/consumer-protection |
| Indian law | The Constitution of India (as on 10 September 2026) | Government of India, Legislative Department | see [Open licence questions](#open-licence-questions) | https://legislative.gov.in/ |
| Indian law | The Income-tax Act, 2025 (as amended by the Finance Act, 2026) | Parliament of India | Act of Parliament; incometaxindia.gov.in, the source, says its material may be reproduced free of charge | https://www.incometaxindia.gov.in/ |
| Indian law | The Central Goods and Services Tax Act, 2017 | Parliament of India (India Code copy) | Act of Parliament; see [Open licence questions](#open-licence-questions) | https://www.indiacode.nic.in/ |
| Indian law | The Bharatiya Nyaya Sanhita, 2023 | Parliament of India (India Code copy) | Act of Parliament; see [Open licence questions](#open-licence-questions) | https://www.indiacode.nic.in/ |

OpenStax material is © Rice University. The OpenStax name and logo are trademarks of Rice
University and are not covered by the licence; this project does not use them.

## Embedding model (served by the site)

| model | licence | source |
|---|---|---|
| bge-small-en-v1.5 (BAAI), half-precision ONNX export | MIT, as declared on the model card | https://huggingface.co/BAAI/bge-small-en-v1.5 |
| the ONNX conversion used: `Xenova/bge-small-en-v1.5` at revision `ea104dacec62c0de699686887e3f920caeb4f3e3` | declares no licence of its own; it is a format conversion of the MIT-licensed model above | https://huggingface.co/Xenova/bge-small-en-v1.5 |

The model is not committed. The site build downloads the pinned files and checks their SHA-256
(`web-static/assets.lock.json`).

The research pipeline downloads these models at run time; they are not bundled or
redistributed:

* `BAAI/bge-base-en-v1.5` and `BAAI/bge-large-en-v1.5` (MIT);
* `cross-encoder/ms-marco-MiniLM-L-6-v2`, `cross-encoder/nli-deberta-v3-base` and
  `cross-encoder/nli-distilroberta-base` (Apache 2.0);
* `qwen2.5:3b` through Ollama (Qwen Research License, non-commercial:
  https://huggingface.co/Qwen/Qwen2.5-3B-Instruct/blob/main/LICENSE);
* `openai/gpt-oss-120b` (Apache 2.0 weights), which is called through the Groq API and never
  downloaded.

## Fonts (served by the site)

All four come from the Fontsource packages, as Latin subsets in WOFF2. All are under the SIL Open
Font License 1.1, which allows bundling with software. The subsets keep the copyright line but
not the licence text, so the build copies each package's `LICENSE` to
`licenses/<font>-OFL.txt`.

| font | copyright | package | upstream |
|---|---|---|---|
| Press Start 2P | Copyright 2012 The Press Start 2P Project Authors, with Reserved Font Name "Press Start 2P" | `@fontsource/press-start-2p` 5.3.0 | https://fonts.google.com/specimen/Press+Start+2P |
| Silkscreen | Copyright 2001 The Silkscreen Project Authors | `@fontsource/silkscreen` 5.3.0 | https://github.com/googlefonts/silkscreen |
| Pixelify Sans (variable) | Copyright 2021 The Pixelify Sans Project Authors | `@fontsource-variable/pixelify-sans` 5.3.0 | https://github.com/eifetx/Pixelify-Sans |
| IBM Plex Sans (variable) | Copyright 2019 IBM Corp. | `@fontsource-variable/ibm-plex-sans` 5.3.0 | https://github.com/IBM/plex |

## JavaScript and CSS libraries

Vendored in this repository (`src/ragsys/app/static/vendor/`, with their licence files; the site
build copies them to `vendor/`):

| library | version | licence | source |
|---|---|---|---|
| KaTeX (JavaScript, CSS and fonts) | 0.16.22 | MIT, © Khan Academy and other contributors | https://katex.org/ |
| highlight.js | 11.11.1 | BSD 3-Clause, © Ivan Sagalaev | https://highlightjs.org/ |

Bundled into the site by its build (from `node_modules`, not committed):

| library | version | licence | source |
|---|---|---|---|
| Transformers.js (`@huggingface/transformers`) | 4.3.2 | Apache 2.0 | https://github.com/huggingface/transformers.js |
| `@huggingface/tokenizers` | 0.2.0 | Apache 2.0 | https://www.npmjs.com/package/@huggingface/tokenizers |
| `@huggingface/jinja` | 0.5.12 | MIT | https://www.npmjs.com/package/@huggingface/jinja |
| ONNX Runtime Web (JavaScript and the WASM build) | 1.31.0-dev.20260914 | MIT, © Microsoft Corporation | https://github.com/microsoft/onnxruntime |
| pdf.js (`pdfjs-dist`, including the worker) | 6.4.299 | Apache 2.0, © Mozilla Foundation | https://github.com/mozilla/pdf.js |
| Motion (`motion`, `framer-motion`, `motion-dom`, `motion-utils`) | 14.13.0 | MIT | https://motion.dev/ |
| tslib | 2.9.1 | 0BSD | https://github.com/microsoft/tslib |

The ONNX Runtime Web package has no `LICENSE` file (its sources carry the MIT notice), so the
build writes `licenses/onnxruntime-web-LICENSE.txt` with Microsoft's copyright line and the MIT
terms.

The build and test tools are not redistributed: Vite, TypeScript, Vitest, Playwright, happy-dom,
Lighthouse, Wrangler, the Cloudflare Workers test pool and the Python packages in
`requirements*.txt`. Their licences are in their own packages.

## Original assets (MIT, part of this project)

These were made for this project:

* the VeriDex logo (`web-static/public/brand/`), traced into pixel grids from the reference image
  the author supplied (`web-static/brand/veridex-logo-ref.png`);
* Dex the pixel robot, the pixel icons, the favicon, the app icons and the Open Graph image,
  drawn from grids in `web-static/scripts/logo-art.mjs`, `web-static/src/dex/frames.ts` and
  `web-static/src/ui/icons.ts`;
* the sound effects, which are synthesised in the browser;
* the screenshots, apart from the library passages they show.

## Open licence questions

1. **OpenStax attribution in the app.** The licence page of each OpenStax book asks that anyone
   who "noncommercially redistribute[s] part of this textbook" retain "in every digital format
   page view" the attribution "Access for free at openstax.org." The site names the book, its
   authors, licence and source link (About & sources, source cards), but does not show that
   sentence next to OpenStax passages.
2. **Indian Acts.** Section 52(1)(q) of the Copyright Act, 1957 allows reproducing matter
   published in the Official Gazette (clause (i), which covers the four Rules). For an Act of a
   Legislature, clause (ii) allows it only "together with any commentary thereon or any other
   original matter". The app shows the excerpts with original matter (its answers), but the
   committed `passages.json` files are bare excerpts of the Consumer Protection Act, the CGST
   Act and the Bharatiya Nyaya Sanhita. The Constitution is not strictly an Act of a
   Legislature. The website policies of India Code and the Legislative Department could not be
   checked here. Treat the Indian statutes as reproduced in good faith for non-commercial
   education, not as cleared by a lawyer.
