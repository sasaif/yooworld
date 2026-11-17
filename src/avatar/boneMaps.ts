// Canonical humanoid bone names -> rig-specific node names (as Three.js sees them:
// GLTFLoader strips "." ":" "/" "[" "]" from node names, e.g. "UpperArm.L" -> "UpperArmL").
export type Canon =
  | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head'
  | 'shoulderL' | 'upperArmL' | 'lowerArmL' | 'handL'
  | 'shoulderR' | 'upperArmR' | 'lowerArmR' | 'handR'
  | 'upperLegL' | 'lowerLegL' | 'footL'
  | 'upperLegR' | 'lowerLegR' | 'footR';

export type RigMap = Partial<Record<Canon, string>>;

/** Quaternius "Ultimate Animated Character Pack" CharacterArmature – the existing 23-bone Yooville rig. */
export const QUATERNIUS_23: RigMap = {
  hips: 'Body', spine: 'Hips', chest: 'Abdomen', upperChest: 'Torso', neck: 'Neck', head: 'Head',
  shoulderL: 'ShoulderL', upperArmL: 'UpperArmL', lowerArmL: 'LowerArmL', handL: 'FistL',
  shoulderR: 'ShoulderR', upperArmR: 'UpperArmR', lowerArmR: 'LowerArmR', handR: 'FistR',
  upperLegL: 'UpperLegL', lowerLegL: 'LowerLegL', footL: 'FootL',
  upperLegR: 'UpperLegR', lowerLegR: 'LowerLegR', footR: 'FootR',
};

/** Quaternius Universal Base Characters / Universal Animation Library (UE-mannequin style, 65 bones). */
export const QUATERNIUS_UNIVERSAL: RigMap = {
  hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upperChest: 'spine_03', neck: 'neck_01', head: 'Head',
  shoulderL: 'clavicle_l', upperArmL: 'upperarm_l', lowerArmL: 'lowerarm_l', handL: 'hand_l',
  shoulderR: 'clavicle_r', upperArmR: 'upperarm_r', lowerArmR: 'lowerarm_r', handR: 'hand_r',
  upperLegL: 'thigh_l', lowerLegL: 'calf_l', footL: 'foot_l',
  upperLegR: 'thigh_r', lowerLegR: 'calf_r', footR: 'foot_r',
};

const mixamoNames = (p: string): RigMap => ({
  hips: p + 'Hips', spine: p + 'Spine', chest: p + 'Spine1', upperChest: p + 'Spine2', neck: p + 'Neck', head: p + 'Head',
  shoulderL: p + 'LeftShoulder', upperArmL: p + 'LeftArm', lowerArmL: p + 'LeftForeArm', handL: p + 'LeftHand',
  shoulderR: p + 'RightShoulder', upperArmR: p + 'RightArm', lowerArmR: p + 'RightForeArm', handR: p + 'RightHand',
  upperLegL: p + 'LeftUpLeg', lowerLegL: p + 'LeftLeg', footL: p + 'LeftFoot',
  upperLegR: p + 'RightUpLeg', lowerLegR: p + 'RightLeg', footR: p + 'RightFoot',
});
/** Ara 3D Gen export (Mixamo names, no prefix). */
export const MIXAMO: RigMap = mixamoNames('');
/** Rocketbox via avatar-studio ("mixamorig:" prefix, colon stripped by Three.js). */
export const MIXAMO_PREFIXED: RigMap = mixamoNames('mixamorig');

/** KayKit Rig_Medium (used by NoLimitNexus/game-models), 23 bones, no neck/clavicles. */
export const KAYKIT_MEDIUM: RigMap = {
  hips: 'hips', spine: 'spine', chest: 'chest', head: 'head',
  upperArmL: 'upperarml', lowerArmL: 'lowerarml', handL: 'wristl',
  upperArmR: 'upperarmr', lowerArmR: 'lowerarmr', handR: 'wristr',
  upperLegL: 'upperlegl', lowerLegL: 'lowerlegl', footL: 'footl',
  upperLegR: 'upperlegr', lowerLegR: 'lowerlegr', footR: 'footr',
};

/** VRM humanoid canonical node names (e.g. VIPE Heroes exports). */
export const VRM_CANON: RigMap = {
  hips: 'hips', spine: 'spine', chest: 'chest', upperChest: 'upperChest', neck: 'neck', head: 'head',
  shoulderL: 'leftShoulder', upperArmL: 'leftUpperArm', lowerArmL: 'leftLowerArm', handL: 'leftHand',
  shoulderR: 'rightShoulder', upperArmR: 'rightUpperArm', lowerArmR: 'rightLowerArm', handR: 'rightHand',
  upperLegL: 'leftUpperLeg', lowerLegL: 'leftLowerLeg', footL: 'leftFoot',
  upperLegR: 'rightUpperLeg', lowerLegR: 'rightLowerLeg', footR: 'rightFoot',
};
