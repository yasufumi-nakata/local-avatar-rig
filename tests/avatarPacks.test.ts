import { describe, expect, it } from "vitest";
import {
  BUILT_IN_AVATAR_PACKS,
  BUILT_IN_AVATAR_PACK_LIST,
  DEFAULT_ASSETS,
  DEFAULT_BUILT_IN_AVATAR_PACK_ID,
  DEFAULT_PROFILE,
  isBuiltInAvatarPackId,
} from "../src/lib/modelPack";
import { hasValidBones } from "../src/lib/avatarRigProfile";

describe("built-in avatar packs", () => {
  it("publishes only the verified Default Navigator pack", () => {
    expect(DEFAULT_BUILT_IN_AVATAR_PACK_ID).toBe("default-navigator-v1");
    expect(BUILT_IN_AVATAR_PACK_LIST.map(({ id }) => id)).toEqual(["default-navigator-v1"]);
    expect(DEFAULT_ASSETS).toBe(BUILT_IN_AVATAR_PACKS["default-navigator-v1"].assets);
    expect(DEFAULT_PROFILE).toBe(BUILT_IN_AVATAR_PACKS["default-navigator-v1"].profile);
  });

  it("keeps assets, profile, accessible description and manifest atomic per pack", () => {
    for (const pack of BUILT_IN_AVATAR_PACK_LIST) {
      expect(pack.altText).toContain("オリジナル2D VTuberアバター");
      expect(pack.manifestUrl).toMatch(/^\/assets\/[a-z0-9-]+\.manifest\.json$/);
      expect(Object.keys(pack.assets).sort()).toEqual(["blink", "mouthOpen", "neutral"]);
      expect(pack.profile.leftEyeCenter).toHaveLength(2);
      expect(pack.profile.rightEyeCenter).toHaveLength(2);
      expect(pack.profile.mouthCenter).toHaveLength(2);
      expect(hasValidBones(pack.profile.bones)).toBe(true);
      expect(Object.values(pack.assets).every((url) => url.startsWith("/assets/"))).toBe(true);
    }
  });

  it("rejects unknown persisted model identifiers", () => {
    expect(isBuiltInAvatarPackId("default-navigator-v1")).toBe(true);
    expect(isBuiltInAvatarPackId("removed-pack")).toBe(false);
    expect(isBuiltInAvatarPackId("custom")).toBe(false);
    expect(isBuiltInAvatarPackId("__proto__")).toBe(false);
  });
});
