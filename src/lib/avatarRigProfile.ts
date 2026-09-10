export type RigPoint = readonly [number, number];

/** Image UV coordinates. Head is the skull/upper-neck joint; neck is its base. */
export interface AvatarBones {
  head: RigPoint;
  neck: RigPoint;
  chest: RigPoint;
  leftShoulder: RigPoint;
  rightShoulder: RigPoint;
}

export interface RigProfile {
  leftEyeCenter: RigPoint;
  rightEyeCenter: RigPoint;
  mouthCenter: RigPoint;
  bones?: AvatarBones;
}

export const DEFAULT_AVATAR_BONES: AvatarBones = {
  head: [0.49702, 0.57226],
  neck: [0.49702, 0.63263],
  chest: [0.49702, 0.83785],
  leftShoulder: [0.3317, 0.72685],
  rightShoulder: [0.66711, 0.72685],
};

export function isRigPoint(value: unknown): value is RigPoint {
  return Array.isArray(value) && value.length === 2
    && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1);
}

export function hasValidBones(value: unknown): value is AvatarBones {
  if (!value || typeof value !== "object") return false;
  const bones = value as AvatarBones;
  if (![bones.head, bones.neck, bones.chest, bones.leftShoulder, bones.rightShoulder].every(isRigPoint)) return false;
  return bones.neck[1] - bones.head[1] >= 0.015
    && bones.chest[1] - bones.neck[1] >= 0.05
    && bones.leftShoulder[0] < bones.neck[0] && bones.rightShoulder[0] > bones.neck[0]
    && bones.leftShoulder[1] >= bones.neck[1] && bones.rightShoulder[1] >= bones.neck[1]
    && bones.leftShoulder[1] < bones.chest[1] && bones.rightShoulder[1] < bones.chest[1];
}

export function resolveAvatarBones(profile: RigProfile): AvatarBones {
  return hasValidBones(profile.bones) ? profile.bones : DEFAULT_AVATAR_BONES;
}
