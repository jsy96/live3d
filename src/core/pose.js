// Shared rest-pose helpers. Kept separate so both the viewer (camera framing
// happens before the Animator exists) and the Animator use the SAME pose.

// Normalized-bone Z rotation that lowers the arms from the VRM T-pose into a
// relaxed A-pose (left arm positive, right arm negative). ~63 degrees.
export const A_POSE_ANGLE = 1.1;

/** Set the relaxed A-pose on a loaded VRM (idempotent). */
export function applyAPose(vrm) {
  const hb = vrm.humanoid;
  const left = hb.getNormalizedBoneNode('leftUpperArm');
  const right = hb.getNormalizedBoneNode('rightUpperArm');
  if (left) left.rotation.z = A_POSE_ANGLE;
  if (right) right.rotation.z = -A_POSE_ANGLE;
}
