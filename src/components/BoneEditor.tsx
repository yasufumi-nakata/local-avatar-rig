import { useId, useRef, useState, type PointerEvent } from "react";
import {
  hasValidBones,
  resolveAvatarBones,
  type AvatarBones,
  type RigPoint,
  type RigProfile,
} from "../lib/avatarRigProfile";
import "./BoneEditor.css";

interface BoneEditorProps {
  image: string;
  profile: RigProfile;
  onChange: (profile: RigProfile) => void;
}

type BoneName = keyof AvatarBones;
const BONE_LABELS: Record<BoneName, string> = {
  head: "頭の付け根",
  neck: "首の根元",
  chest: "胸",
  leftShoulder: "左肩",
  rightShoulder: "右肩",
};
const BONE_NAMES = Object.keys(BONE_LABELS) as BoneName[];
const BONE_LINKS: ReadonlyArray<readonly [BoneName, BoneName]> = [
  ["head", "neck"], ["neck", "chest"], ["neck", "leftShoulder"], ["neck", "rightShoulder"],
];

function coordinateBounds(bones: AvatarBones, name: BoneName): readonly [RigPoint, RigPoint] {
  switch (name) {
    case "head": return [[0, 1], [0, bones.neck[1] - 0.016]];
    case "neck": return [
      [bones.leftShoulder[0] + 0.006, bones.rightShoulder[0] - 0.006],
      [bones.head[1] + 0.016, Math.min(bones.chest[1] - 0.051, bones.leftShoulder[1], bones.rightShoulder[1])],
    ];
    case "chest": return [[0, 1], [Math.max(bones.neck[1] + 0.051, bones.leftShoulder[1] + 0.006, bones.rightShoulder[1] + 0.006), 1]];
    case "leftShoulder": return [[0, bones.neck[0] - 0.006], [bones.neck[1], bones.chest[1] - 0.006]];
    case "rightShoulder": return [[bones.neck[0] + 0.006, 1], [bones.neck[1], bones.chest[1] - 0.006]];
  }
}

export function BoneEditor({ image, profile, onChange }: BoneEditorProps) {
  const [selected, setSelected] = useState<BoneName>("head");
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ name: BoneName; pointerId: number } | null>(null);
  const id = useId();
  const bones = resolveAvatarBones(profile);
  const bounds = coordinateBounds(bones, selected);

  const moveBone = (name: BoneName, point: RigPoint) => {
    const limits = coordinateBounds(bones, name);
    const nextPoint = point.map((value, axis) => Math.max(limits[axis][0], Math.min(limits[axis][1], value))) as [number, number];
    const nextBones = { ...bones, [name]: nextPoint };
    if (hasValidBones(nextBones)) onChange({ ...profile, bones: nextBones });
  };

  const dragBone = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !rect || !rect.width || !rect.height) return;
    moveBone(drag.name, [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]);
  };

  return (
    <div className="bone-editor">
      <p id={`${id}-help`}>頭の付け根をあごのすぐ下、首の根元を襟元に合わせます。胸と肩は胴体側に置きます。点のドラッグ、または関節を選んで位置を調整できます。左右は画像を見た向きです。</p>
      <div className="bone-preview checkerboard" ref={previewRef}>
        <img src={image} alt="ボーン位置を確認するキャラクター画像" draggable={false} />
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          {BONE_LINKS.map(([from, to]) => <line key={`${from}-${to}`} x1={bones[from][0] * 1000} y1={bones[from][1] * 1000} x2={bones[to][0] * 1000} y2={bones[to][1] * 1000} />)}
        </svg>
        {BONE_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className={`bone-joint bone-joint-${name}${selected === name ? " selected" : ""}`}
            style={{ left: `${bones[name][0] * 100}%`, top: `${bones[name][1] * 100}%` }}
            aria-label={`${BONE_LABELS[name]}を選択`}
            aria-pressed={selected === name}
            title={BONE_LABELS[name]}
            onClick={() => setSelected(name)}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              setSelected(name);
              dragRef.current = { name, pointerId: event.pointerId };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={dragBone}
            onPointerUp={() => { dragRef.current = null; }}
            onPointerCancel={() => { dragRef.current = null; }}
            onLostPointerCapture={() => { dragRef.current = null; }}
          ><span>{BONE_LABELS[name]}</span></button>
        ))}
      </div>
      <label className="bone-picker" htmlFor={`${id}-joint`}>
        <span>調整する関節</span>
        <select id={`${id}-joint`} value={selected} aria-describedby={`${id}-help`} onChange={(event) => setSelected(event.target.value as BoneName)}>
          {BONE_NAMES.map((name) => <option key={name} value={name}>{BONE_LABELS[name]}</option>)}
        </select>
      </label>
      <div className="bone-coordinate-sliders">
        {([0, 1] as const).map((axis) => (
          <label key={axis} className="control-slider">
            <span>{axis === 0 ? "左右" : "上下"}<output>{(bones[selected][axis] * 100).toFixed(1)}%</output></span>
            <input
              type="range"
              aria-label={`${BONE_LABELS[selected]} ${axis === 0 ? "X" : "Y"}`}
              min={bounds[axis][0]}
              max={bounds[axis][1]}
              step="0.001"
              value={bones[selected][axis]}
              onChange={(event) => moveBone(selected, axis === 0 ? [Number(event.target.value), bones[selected][1]] : [bones[selected][0], Number(event.target.value)])}
            />
          </label>
        ))}
      </div>
      <small className="bone-editor-note">首の上下や肩と胸の順序が逆転しない範囲で調整します。</small>
    </div>
  );
}
