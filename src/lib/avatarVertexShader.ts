export const RIG_VERTEX_SHADER = `
  precision highp float;
  attribute vec2 a_uv;
  varying vec2 v_uv;

  uniform vec4 u_head;
  uniform vec4 u_body;
  uniform vec3 u_hair;
  uniform vec2 u_translate;
  uniform float u_aspect;
  uniform vec2 u_mouth;
  uniform vec2 u_mouth_center;
  uniform vec2 u_left_eye_center;
  uniform vec2 u_right_eye_center;
  uniform vec2 u_head_pivot;
  uniform vec2 u_neck_pivot;
  uniform vec2 u_chest_pivot;
  uniform vec4 u_shoulders;

  const float PI = 3.141592653589793;

  float ellipseWeight(vec2 point, vec2 center, vec2 radius, float innerEdge, float outerEdge) {
    return 1.0 - smoothstep(innerEdge, outerEdge, length((point - center) / radius));
  }

  vec2 rotateAround(vec2 point, vec2 pivot, float angle) {
    // Some GPU implementations approximate sin/cos independently. Normalize the
    // pair so repeated small rotations cannot gradually shrink the face.
    vec2 rotation = normalize(vec2(cos(angle), sin(angle)));
    float cosine = rotation.x;
    float sine = rotation.y;
    vec2 local = (point - pivot) * vec2(u_aspect, 1.0);
    return pivot + vec2(local.x * cosine - local.y * sine, local.x * sine + local.y * cosine) / vec2(u_aspect, 1.0);
  }

  float headInfluence(vec2 point, vec2 joint, float eyeSpan, float shoulderY) {
    float side = smoothstep(eyeSpan * 0.55, eyeSpan * 1.05, abs(point.x - joint.x));
    float headEnd = mix(u_neck_pivot.y, shoulderY, side);
    float weight = 1.0 - smoothstep(joint.y, headEnd, point.y);
    return weight * (1.0 - smoothstep(eyeSpan * 2.0, eyeSpan * 4.225, abs(point.x - joint.x)));
  }

  void main() {
    vec2 source = a_uv;
    vec2 point = source;
    vec2 eyeCenter = (u_left_eye_center + u_right_eye_center) * 0.5;
    float eyeSpan = max(0.035, abs(u_right_eye_center.x - u_left_eye_center.x));
    float rigScale = eyeSpan / 0.116;
    float faceHeight = max(0.04, u_head_pivot.y - eyeCenter.y);
    vec2 faceCenter = mix(eyeCenter, u_mouth_center, 0.36);
    vec2 faceRadius = vec2(eyeSpan * 1.02, faceHeight * 1.06);
    float faceMask = ellipseWeight(source, faceCenter, faceRadius, 0.72, 1.08);
    float shoulderY = (u_shoulders.y + u_shoulders.w) * 0.5;

    // 顎と髪は頭のローカル座標で動かします。骨格と表情位置は同じ画像から導出します。
    float mouthOpen = clamp(u_mouth.x, 0.0, 1.0);
    float lowerFaceMask = ellipseWeight(source, u_mouth_center + vec2(0.0, 0.036) * rigScale, vec2(0.090, 0.100) * rigScale, 0.18, 1.05)
      * smoothstep(u_mouth_center.y - 0.009 * rigScale, u_mouth_center.y + 0.101 * rigScale, source.y);
    point.y += mouthOpen * 0.008 * rigScale * lowerFaceMask;
    point.x = mix(point.x, u_mouth_center.x + (point.x - u_mouth_center.x) * (1.0 - mouthOpen * 0.012), lowerFaceMask);

    vec2 hairCenter = vec2(eyeCenter.x, eyeCenter.y - faceHeight * 0.32);
    vec2 hairRadius = vec2(eyeSpan * 1.77, faceHeight * 1.85);
    float hairMask = ellipseWeight(source, hairCenter, hairRadius, 0.74, 1.08);
    float hairOnly = 1.0 - faceMask;
    float sideDistance = smoothstep(eyeSpan * 0.78, eyeSpan * 1.64, abs(source.x - eyeCenter.x));
    float upperHair = hairMask * (1.0 - smoothstep(eyeCenter.y - faceHeight * 0.35, eyeCenter.y + faceHeight * 0.3, source.y));
    float sideHair = hairMask * sideDistance * hairOnly;
    float frontHair = upperHair * hairOnly;
    float backHair = hairMask * hairOnly * (1.0 - sideDistance * 0.45);
    float hairTip = smoothstep(hairCenter.y - hairRadius.y * 0.4, shoulderY, source.y);
    float hairSway = frontHair * u_hair.x / 2.5 + sideHair * u_hair.y / 5.0 + backHair * u_hair.z / 2.5;
    vec2 hairPoint = rotateAround(point, hairCenter - vec2(0.0, hairRadius.y * 0.45), hairSway * 0.010 * hairTip);
    hairPoint.x += hairSway * 0.003 * rigScale * hairTip;
    point = mix(point, hairPoint, max(frontHair, max(sideHair, backHair)));

    // 胴体→首→頭の順に継承します。頭の角度はカメラ姿勢に対する絶対角であり、
    // 肩の遅れを足し重ねません。首の長さはFKで保ち、襟や胸を頭へ混ぜません。
    float bodyRoll = u_body.z * 0.45 * PI / 180.0;
    float headRoll = clamp(u_head.z, -30.0, 30.0) * 0.62 * PI / 180.0 - bodyRoll;
    float neckRoll = headRoll * 0.22;

    // 顔を曲面として投影します。Yawは左右の輪郭を圧縮し鼻側の奥行きを動かし、
    // Pitchは同じ奥行きから上下へ投影します。目鼻口の平行移動だけにはしません。
    vec2 local = (point - u_head_pivot) * vec2(u_aspect, 1.0);
    vec2 faceLocal = (source - faceCenter) / faceRadius;
    float depth = max(0.0, 1.0 - dot(faceLocal, faceLocal)) * faceRadius.y * 0.62;
    float yaw = clamp(u_head.x, -30.0, 30.0) * 0.82 * PI / 180.0;
    float pitch = clamp(u_head.y, -30.0, 30.0) * 0.65 * PI / 180.0;
    // WorkerのRz * Ry * Rxと同じ順序です。Yawを先に適用すると、
    // うなずきと横向きだけで眼線が傾き、首をねじったように見えます。
    float turnedY = local.y * cos(pitch) - depth * sin(pitch);
    float turnedZ = local.y * sin(pitch) + depth * cos(pitch);
    float turnedX = local.x * cos(yaw) + turnedZ * sin(yaw);
    vec2 headPoint = u_head_pivot + vec2(turnedX / u_aspect, turnedY);


    point = mix(point, headPoint, headInfluence(source, u_head_pivot, eyeSpan, shoulderY));

    // 姿勢空間で重みを再評価しながら小さな回転を積み重ねます。
    // 大きな変位を首の短い区間で直線補間すると、髪の三角形が反転します。
    vec2 joint = u_head_pivot;
    for (int step = 0; step < 8; step++) {
      float progress = float(step + 1) / 8.0;
      vec2 nextJoint = rotateAround(u_head_pivot, u_neck_pivot, neckRoll * progress);
      float weight = headInfluence(point, joint, eyeSpan, shoulderY);
      point = rotateAround(point, joint, headRoll * weight / 8.0) + (nextJoint - joint) * weight;
      joint = nextJoint;
    }

    // 肩と胸は一つの胴体骨として動きます。位置・倍率は根元に適用します。
    float breathWeight = smoothstep(u_neck_pivot.y, shoulderY, source.y);
    point.x = u_chest_pivot.x + (point.x - u_chest_pivot.x) * (1.0 + u_body.w * 0.005 * breathWeight);
    point.y += u_body.w * 0.002;
    point = rotateAround(point, u_chest_pivot, bodyRoll);
    point.x += clamp(u_body.x / 10.0, -1.0, 1.0) * 0.004;
    point += u_translate;
    point = u_chest_pivot + (point - u_chest_pivot) * u_head.w;

    v_uv = source;
    gl_Position = vec4(point.x * 2.0 - 1.0, 1.0 - point.y * 2.0, 0.0, 1.0);
  }
`;
