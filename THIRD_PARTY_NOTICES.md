# Third-party notices

The project's source code is covered by [LICENSE](LICENSE). The bundled character PNGs
and repository screenshots are covered separately by [ASSET_LICENSE.md](ASSET_LICENSE.md).
Neither license replaces the third-party licenses below.

## Runtime software

The versions below are fixed by `pnpm-lock.yaml`. Production builds bundle and minify
the imported JavaScript; MediaPipe's WebAssembly runtime is copied from its npm package.
No patched upstream package source is maintained in this repository.

| Component | Version | License text and attribution |
| --- | --- | --- |
| [React and React DOM](https://github.com/facebook/react/tree/v18.3.1) | 18.3.1 | MIT; [React-MIT.txt](LICENSES/React-MIT.txt) |
| [Scheduler](https://github.com/facebook/react/tree/v18.3.1/packages/scheduler) | 0.23.2 | MIT; the same upstream copyright and text in [React-MIT.txt](LICENSES/React-MIT.txt) |
| [Lucide React](https://github.com/lucide-icons/lucide/tree/0.468.0) | 0.468.0 | ISC, with Feather-derived portions identified as MIT; [Lucide-ISC.txt](LICENSES/Lucide-ISC.txt) and [Feather-MIT.txt](LICENSES/Feather-MIT.txt) |
| [js-tokens](https://github.com/lydell/js-tokens/tree/v4.0.0) | 4.0.0 | MIT; [js-tokens-MIT.txt](LICENSES/js-tokens-MIT.txt) |
| [loose-envify](https://github.com/zertosh/loose-envify/tree/v1.4.0) | 1.4.0 | MIT; [loose-envify-MIT.txt](LICENSES/loose-envify-MIT.txt) |
| [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js) | 1.0.1 | Apache-2.0; [Apache-2.0.txt](LICENSES/Apache-2.0.txt) and [MediaPipe-NOTICE.txt](LICENSES/MediaPipe-NOTICE.txt) |

React, Lucide, js-tokens, and loose-envify license files are reproduced from their installed
npm packages. The Lucide package's license identifies Feather's MIT-licensed contribution;
the additional MIT text is reproduced from [Feather v4.29.2](https://github.com/feathericons/feather/blob/v4.29.2/LICENSE).
It is an attribution for inherited work, not an additional runtime dependency.
The Apache license is reproduced in full from the [Apache Software Foundation](https://www.apache.org/licenses/LICENSE-2.0.txt).
MediaPipe attribution notices preserve the copyright statements present in the package's
type declarations and source maps, including Google and Closure Library notices.
The npm package does not contain a separate upstream `NOTICE` file.

Vite serves these notice files during development and includes `LICENSE`, `ASSET_LICENSE.md`,
this file, and every file under `LICENSES/` in production builds. Keep them with redistributed
builds. Development tools are listed in `package.json` and the lockfile; their packages retain
their own licenses when installed.

## Face-tracking model and privacy

The Face Landmarker model is not included in this source repository or in its production
build. When the user explicitly starts tracking, their browser downloads the pinned model
directly from Google's distribution endpoint and verifies its size and SHA-256 before use.
The model URL and verification details are documented in `src/assets/models/README.md`.

The Apache-2.0 license for the MediaPipe software does not, by itself, establish the license
of every separately distributed model. Consult the [official model documentation](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker#models)
and applicable distribution terms before copying or hosting the model yourself.

MediaPipe publishes a [privacy notice](https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice).
This application processes camera frames in the browser and restricts external requests;
the model download still contacts Google's host and exposes normal request metadata, such as
the client's IP address, to that host. Changes to the tracking or network implementation
require the corresponding privacy description to be reviewed.

## Artwork reference and provenance

[Garnet Live2d - A Free Model](https://salmon-snake.itch.io/garnet-live2d-a-free-model),
by Salmon Snake Games, is listed by its creator under CC0 1.0 Universal. Its separation of
head, body, hair, eyes, mouth, and expression controls was studied as a structural reference.
No Garnet artwork, model, source code, or SDK files are included in this repository or its build.

Available C2PA metadata in the bundled character images identifies OpenAI as a provenance
participant. The recorded metadata and hashes are described in the asset manifest; that
metadata does not establish copyright, exclusivity, or endorsement. The actual permissions
for the bundled artwork are in [ASSET_LICENSE.md](ASSET_LICENSE.md).

## Trademarks

Live2D® and Cubism are trademarks or registered trademarks of Live2D Inc. This project is
not affiliated with or endorsed by Live2D Inc. and does not include or use the Cubism SDK.
The name appears only to identify the original title of the structural reference above.

Other company, product, and project names are used only for accurate attribution and
provenance. Their respective owners do not sponsor or endorse this project by virtue of
those references.
