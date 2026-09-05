# Face Landmarker model

The Face Landmarker float16 model is not committed to this repository and is not included in
production builds. After the user explicitly starts face tracking, the Worker requests the
pinned provider URL below and verifies the byte length and SHA-256 before initializing inference.

- Source: [Face Landmarker float16 v1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)
- Required size: 3,758,596 bytes
- Required SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- Runtime: `@mediapipe/tasks-vision` 1.0.1

The request omits credentials and the Referer header and rejects redirects. A failed download
or mismatching model is not used. Ordinary connection information, including the user's IP
address, may still reach the hosting provider. The browser may cache the model response.
Camera frames and audio are not attached to this request and are processed on the user's device.

The Worker permits the pinned model download and blocks other cross-origin fetch requests.
The application also restricts connection destinations through Content Security Policy.
MediaPipe's upstream privacy notice describes performance and utilization metrics; this
application therefore verifies its network restrictions rather than assuming the dependency
never attempts telemetry. See the [application privacy document](../../../docs/privacy.md) and
the [MediaPipe Tasks Privacy Notice](https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice).

The runtime source code is distributed under Apache-2.0. This repository does not claim that
the separately hosted model is covered by the same license. A distributor who changes the
build to embed or rehost the model must confirm the applicable model terms independently.
The runtime notices and license texts are listed in
[THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md).
