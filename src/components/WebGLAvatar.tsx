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
  const latestPoseRef = useRef(poseRef);

  useEffect(() => {
    latestPoseRef.current = poseRef;
  }, [poseRef]);

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

    const stopRenderer = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      renderer?.destroy();
      renderer = null;
    };

    const startRenderer = () => {
      if (!active) return;
      stopRenderer();
      delete canvas.dataset.rigReady;
      delete canvas.dataset.rigError;

      let nextRenderer: WebGLAvatarRenderer;
      try {
        nextRenderer = new WebGLAvatarRenderer(canvas);
        renderer = nextRenderer;
      } catch (error) {
        canvas.dataset.rigError = error instanceof Error ? error.message : "2Dメッシュ変形を開始できませんでした。";
        return;
      }

      void nextRenderer.initialize(assets)
        .then(() => {
          if (!active || renderer !== nextRenderer || canvas.dataset.rigReady !== "true") return;
          const render = (now: number) => {
            if (!active || renderer !== nextRenderer) return;
            nextRenderer.render(now, latestPoseRef.current.current, frameOptionsRef.current, profileRef.current);
            animationFrame = window.requestAnimationFrame(render);
          };
          animationFrame = window.requestAnimationFrame(render);
        })
        .catch((error: unknown) => {
          if (!active || renderer !== nextRenderer) return;
          stopRenderer();
          canvas.dataset.rigError = error instanceof Error ? error.message : "2Dメッシュ素材を準備できませんでした。";
        });
    };

    const handleContextLost = (event: Event) => {
      // 復旧イベントを受け取れるよう既定動作を止め、画像へ戻します。
      event.preventDefault();
      stopRenderer();
      canvas.dataset.rigError = "描画機能が一時停止しています。復旧を待っています。";
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", startRenderer);
    startRenderer();

    return () => {
      active = false;
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", startRenderer);
      stopRenderer();
    };
  }, [assets.blink, assets.mouthOpen, assets.neutral, canvasRef]);

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
