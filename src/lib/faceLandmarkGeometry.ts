interface NormalizedImagePoint {
  x: number;
  y: number;
}

interface NormalizedDepthPoint extends NormalizedImagePoint {
  z: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * MediaPipe normalizes x by image width and y by image height. Convert both
 * deltas to image-width units before measuring lengths or image-space angles,
 * so camera aspect ratio does not change head roll or apparent face size.
 */
export function measureLandmarkPair(
  first: NormalizedImagePoint,
  second: NormalizedImagePoint,
  image: ImageDimensions,
) {
  const deltaX = second.x - first.x;
  const deltaY = (second.y - first.y) * image.height / image.width;

  return {
    distance: Math.hypot(deltaX, deltaY),
    angleDegrees: Math.atan2(deltaY, deltaX) * (180 / Math.PI),
  };
}

/**
 * MediaPipe's normalized z uses approximately the same scale as x, while y
 * uses image height. Including depth prevents a yawed face's projected width
 * from being mistaken for moving away. This is a relative span, not meters.
 * https://developers.google.com/edge/api/mediapipe/js/tasks-vision.normalizedlandmark
 */
export function measureLandmarkSpan(
  first: NormalizedDepthPoint,
  second: NormalizedDepthPoint,
  image: ImageDimensions,
) {
  const projected = measureLandmarkPair(first, second, image).distance;
  const deltaZ = second.z - first.z;
  return Math.hypot(projected, Number.isFinite(deltaZ) ? deltaZ : 0);
}
