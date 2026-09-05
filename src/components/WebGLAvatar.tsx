import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from "react";
import type { FaceTrackingStatus } from "../hooks/useFaceTracking";
import type { FaceRigPose } from "../lib/faceRigPose";
import {
  WebGLAvatarRenderer,
  type AvatarTextureSources,
  type RigProfile,
} from "../lib/webglAvatarRenderer";

interface WebGLAvatarProps {
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  characterRef: RefObject<HTMLImageElement>;
  poseRef: MutableRefObject<FaceRigPose>;
  motion: boolean;
  speaking: boolean;
  audioLevel: number;
  faceTrackingStatus: FaceTrackingStatus;
  assets: AvatarTextureSources;
  profile: RigProfile;
  altText: string;
}

export function WebGLAvatar({
  canvasRef,
  characterRef,
  poseRef,
  motion,
  speaking,
  audioLevel,
  faceTrackingStatus,
  assets,
  profile,
  altText,
}: WebGLAvatarProps) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const frameOptionsRef = useRef({
    motion: motion && !reducedMotion,
    speaking,
    audioLevel,
    tracking: faceTrackingStatus === "tracking",
  });
  const profileRef = useRef(profile);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    frameOptionsRef.current = {
      motion: motion && !reducedMotion,
      speaking,
      audioLevel,
      tracking: faceTrackingStatus === "tracking",
    };
  }, [audioLevel, faceTrackingStatus, motion, reducedMotion, speaking]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    let animationFrame = 0;
    let renderer: WebGLAvatarRenderer | null = null;

    try {
      renderer = new WebGLAvatarRenderer(canvas);
    } catch (error) {
      canvas.dataset.rigError = error instanceof Error ? error.message : "2Dメッシュ変形を開始できませんでした。";
      return;
    }

    void renderer.initialize(assets)
      .then(() => {
        if (!active || !renderer) return;
        const render = (now: number) => {
          if (!active || !renderer) return;
          renderer.render(now, poseRef.current, frameOptionsRef.current, profileRef.current);
          animationFrame = window.requestAnimationFrame(render);
        };
        animationFrame = window.requestAnimationFrame(render);
      })
      .catch((error: unknown) => {
        canvas.dataset.rigError = error instanceof Error ? error.message : "2Dメッシュ素材を準備できませんでした。";
      });

    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
      renderer?.destroy();
    };
  }, [assets.blink, assets.mouthOpen, assets.neutral, canvasRef, poseRef]);

  return (
    <>
      <canvas ref={canvasRef} className="avatar-rig-canvas" aria-hidden="true" />
      <img
        ref={characterRef}
        className="avatar-character avatar-character-fallback"
        src={assets.neutral}
        alt={altText}
      />
    </>
  );
}
