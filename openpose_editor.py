"""
ComfyVFX - OpenPose Proportional Editor
Combined body, face, and hand editing with full pro features.
Includes scheduling, visibility toggles, joint manipulation, and multiple outputs.
"""

import json
import os
import math
import numpy as np
import torch
from PIL import Image, ImageDraw
import folder_paths


# =============================================================================
# CONSTANTS AND DEFINITIONS
# =============================================================================

# COCO 18 Keypoint indices
KEYPOINT_NAMES = {
    0: "nose", 1: "neck", 2: "right_shoulder", 3: "right_elbow", 4: "right_wrist",
    5: "left_shoulder", 6: "left_elbow", 7: "left_wrist", 8: "right_hip",
    9: "right_knee", 10: "right_ankle", 11: "left_hip", 12: "left_knee",
    13: "left_ankle", 14: "right_eye", 15: "left_eye", 16: "right_ear", 17: "left_ear",
}

# OpenPose body colors
BODY_KEYPOINT_COLORS = {
    0: (255, 0, 0), 1: (255, 85, 0), 2: (255, 170, 0), 3: (255, 255, 0),
    4: (170, 255, 0), 5: (85, 255, 0), 6: (0, 255, 0), 7: (0, 255, 85),
    8: (0, 255, 170), 9: (0, 255, 255), 10: (0, 170, 255), 11: (0, 85, 255),
    12: (0, 0, 255), 13: (85, 0, 255), 14: (170, 0, 255), 15: (255, 0, 255),
    16: (255, 0, 170), 17: (255, 0, 85),
}

BODY_BONE_CONNECTIONS = {
    (1, 0): (255, 0, 0), (1, 2): (255, 85, 0), (2, 3): (255, 170, 0),
    (3, 4): (255, 255, 0), (1, 5): (170, 255, 0), (5, 6): (85, 255, 0),
    (6, 7): (0, 255, 0), (1, 8): (0, 255, 85), (8, 9): (0, 255, 170),
    (9, 10): (0, 255, 255), (1, 11): (0, 170, 255), (11, 12): (0, 85, 255),
    (12, 13): (0, 0, 255), (0, 14): (255, 0, 170), (14, 16): (170, 0, 255),
    (0, 15): (255, 0, 255), (15, 17): (85, 0, 255),
}

# Face landmark indices
FACE_PARTS = {
    "jawline": list(range(0, 17)),
    "right_eyebrow": list(range(17, 22)),
    "left_eyebrow": list(range(22, 27)),
    "nose_bridge": list(range(27, 31)),
    "nose_tip": list(range(31, 36)),
    "right_eye": list(range(36, 42)),
    "left_eye": list(range(42, 48)),
    "outer_mouth": list(range(48, 60)),
    "inner_mouth": list(range(60, 68)),
}

RIGHT_PUPIL, LEFT_PUPIL = 68, 69
RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM = [37, 38], [40, 41]
LEFT_EYE_TOP, LEFT_EYE_BOTTOM = [43, 44], [46, 47]

# Hand definitions
HAND_CONNECTIONS = [
    (0, 1), (0, 5), (0, 9), (0, 13), (0, 17),
    (1, 2), (2, 3), (3, 4), (5, 6), (6, 7), (7, 8),
    (9, 10), (10, 11), (11, 12), (13, 14), (14, 15), (15, 16),
    (17, 18), (18, 19), (19, 20),
]

# OpenPose standard finger-color gradients (matches mocap_pose_loader.py)
HAND_FINGER_GROUPS = {
    'thumb':  [1, 2, 3, 4],
    'index':  [5, 6, 7, 8],
    'middle': [9, 10, 11, 12],
    'ring':   [13, 14, 15, 16],
    'pinky':  [17, 18, 19, 20],
}
HAND_FINGER_COLORS = {
    'wrist':  [(255, 255, 255)],
    'thumb':  [(255, 0, 0), (255, 60, 0), (255, 120, 0), (255, 180, 0)],
    'index':  [(255, 200, 0), (255, 220, 0), (255, 240, 0), (255, 255, 0)],
    'middle': [(0, 255, 0), (0, 255, 80), (0, 255, 160), (0, 255, 240)],
    'ring':   [(0, 200, 255), (0, 150, 255), (0, 100, 255), (0, 50, 255)],
    'pinky':  [(200, 0, 255), (150, 0, 255), (100, 0, 255), (50, 0, 255)],
}

def _hand_kp_color(kp_idx):
    """Get color for a hand keypoint index (0-20)."""
    if kp_idx == 0:
        return HAND_FINGER_COLORS['wrist'][0]
    for fname, idxs in HAND_FINGER_GROUPS.items():
        if kp_idx in idxs:
            pos = idxs.index(kp_idx)
            return HAND_FINGER_COLORS[fname][pos]
    return (180, 180, 180)

def _hand_bone_color(from_idx, to_idx):
    """Get color for a hand bone (uses destination keypoint's finger)."""
    return _hand_kp_color(to_idx)

# All parameter names for scheduling
BODY_PARAMS = [
    "head_width", "head_height", "head_tilt", "neck_length", "shoulder_height",
    "collarbone_length", "arm_angle", "upper_arm_length", "forearm_length",
    "torso_length", "torso_tilt", "hip_width", "legs_angle",
    "upper_leg_length", "lower_leg_length",
]

FACE_PARAMS = [
    "eye_spacing", "eye_height", "eye_open", "eyebrow_height", "eyebrow_tilt",
    "mouth_width", "mouth_height", "mouth_position_y", "smile",
    "jaw_width", "nose_scale", "face_scale",
]

HAND_PARAMS = ["hand_scale", "hand_rotate"]

TRANSFORM_PARAMS = ["overall_scale", "overall_rotate", "position_x", "position_y"]

ALL_PARAMS = BODY_PARAMS + FACE_PARAMS + HAND_PARAMS + TRANSFORM_PARAMS

PARAM_DEFAULTS = {
    # Body
    "head_width": 1.0, "head_height": 1.0, "head_tilt": 0.0, "neck_length": 1.0,
    "shoulder_height": 0.0, "collarbone_length": 1.0, "arm_angle": 0.0,
    "upper_arm_length": 1.0, "forearm_length": 1.0, "torso_length": 1.0,
    "torso_tilt": 0.0, "hip_width": 1.0, "legs_angle": 0.0,
    "upper_leg_length": 1.0, "lower_leg_length": 1.0,
    # Face
    "eye_spacing": 0.0, "eye_height": 0.0, "eye_open": 0.0,
    "eyebrow_height": 0.0, "eyebrow_tilt": 0.0, "mouth_width": 1.0,
    "mouth_height": 1.0, "mouth_position_y": 0.0, "smile": 0.0,
    "jaw_width": 1.0, "nose_scale": 1.0, "face_scale": 1.0,
    # Hands
    "hand_scale": 1.0, "hand_rotate": 0.0,
    # Transform
    "overall_scale": 1.0, "overall_rotate": 0.0, "position_x": 0.0, "position_y": 0.0,
    # Smoothing
    "temporal_smoothing": 0.0, "spatial_smoothing": 0.0,
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def parse_keypoints(kp):
    """Parse flat keypoint array into list of [x, y, confidence]."""
    return [[kp[i], kp[i+1], kp[i+2]] for i in range(0, len(kp), 3)]


def flatten_keypoints(points):
    """Flatten list of [x, y, confidence] back to flat array."""
    result = []
    for p in points:
        result.extend([p[0], p[1], p[2]])
    return result


def get_centroid(pts, indices):
    """Get centroid of specified keypoint indices."""
    valid = [(pts[i][0], pts[i][1]) for i in indices if i < len(pts) and pts[i][2] > 0]
    if not valid:
        return None
    return (sum(p[0] for p in valid) / len(valid), sum(p[1] for p in valid) / len(valid))


# ── Smoothing functions ──

# Body skeleton adjacency: which joints are connected to which
BODY_ADJACENCY = {
    0: [1, 14, 15],       # nose -> neck, eyes
    1: [0, 2, 5, 8],      # neck -> nose, shoulders, hip
    2: [1, 3],             # R shoulder -> neck, R elbow
    3: [2, 4],             # R elbow -> R shoulder, R wrist
    4: [3],                # R wrist -> R elbow
    5: [1, 6],             # L shoulder -> neck, L elbow
    6: [5, 7],             # L elbow -> L shoulder, L wrist
    7: [6],                # L wrist -> L elbow
    8: [1, 9, 11],         # mid-hip -> neck, R hip, L hip
    9: [8, 10],            # R knee -> hip, R ankle
    10: [9],               # R ankle -> R knee
    11: [8, 12],           # L knee -> hip, L ankle
    12: [11, 13],          # L ankle -> L knee (fixed from 11->13)
    13: [12],              # L foot -> L ankle
    14: [0, 16],           # R eye -> nose, R ear
    15: [0, 17],           # L eye -> nose, L ear
    16: [14],              # R ear -> R eye
    17: [15],              # L ear -> L eye
}


def apply_temporal_smoothing(pose_data, strength):
    """Apply exponential moving average to keypoint positions across frames.
    strength: 0.0 = no smoothing, 1.0 = maximum smoothing.
    The alpha (blend weight) maps from strength: 0->1.0 (no smooth), 1->0.02 (very smooth).
    """
    if strength <= 0 or not pose_data or len(pose_data) < 2:
        return pose_data
    
    # Map 0-1 strength to alpha: higher strength = lower alpha = more smoothing
    # alpha=1 means no smoothing, alpha near 0 means heavy smoothing
    alpha = max(0.02, 1.0 - strength * 0.98)
    
    # Track smoothed positions per person
    prev_smoothed = {}  # {person_idx: [[x, y, c], ...]}
    
    for frame_data in pose_data:
        if not isinstance(frame_data, dict):
            continue
        people = frame_data.get("people", [])
        
        for p_idx, person in enumerate(people):
            for kp_key in ("pose_keypoints_2d", "face_keypoints_2d",
                           "hand_left_keypoints_2d", "hand_right_keypoints_2d"):
                kp = person.get(kp_key)
                if not kp or len(kp) < 3:
                    continue
                
                prev_key = (p_idx, kp_key)
                prev = prev_smoothed.get(prev_key)
                
                new_kp = list(kp)
                for i in range(0, len(kp) - 2, 3):
                    x, y, c = kp[i], kp[i+1], kp[i+2]
                    if c <= 0:
                        continue
                    if prev and i < len(prev) and prev[i+2] > 0:
                        # EMA blend: new = alpha * current + (1-alpha) * previous
                        new_kp[i] = alpha * x + (1 - alpha) * prev[i]
                        new_kp[i+1] = alpha * y + (1 - alpha) * prev[i+1]
                    # else: keep current position (first frame or no previous)
                
                person[kp_key] = new_kp
                prev_smoothed[prev_key] = new_kp
    
    return pose_data


def apply_spatial_smoothing(pose_data, strength):
    """Apply spatial smoothing to body keypoints within each frame.
    Pulls each joint slightly toward the average of its connected neighbors.
    strength: 0.0 = no smoothing, 1.0 = maximum smoothing.
    """
    if strength <= 0 or not pose_data:
        return pose_data
    
    # Map strength to blend factor: how much to pull toward neighbor average
    # 0 = no pull, up to 0.5 = strong pull toward neighbors
    blend = strength * 0.5
    
    # Multiple passes for stronger smoothing
    passes = 1 + int(strength * 3)  # 1-4 passes based on strength
    
    for frame_data in pose_data:
        if not isinstance(frame_data, dict):
            continue
        for person in frame_data.get("people", []):
            kp = person.get("pose_keypoints_2d")
            if not kp or len(kp) < 18 * 3:
                continue
            
            for _ in range(passes):
                new_kp = list(kp)
                for joint_idx, neighbors in BODY_ADJACENCY.items():
                    base = joint_idx * 3
                    if base + 2 >= len(kp) or kp[base + 2] <= 0:
                        continue
                    
                    # Compute average of valid neighbors
                    nx_sum, ny_sum, n_count = 0.0, 0.0, 0
                    for ni in neighbors:
                        nb = ni * 3
                        if nb + 2 < len(kp) and kp[nb + 2] > 0:
                            nx_sum += kp[nb]
                            ny_sum += kp[nb + 1]
                            n_count += 1
                    
                    if n_count > 0:
                        avg_x = nx_sum / n_count
                        avg_y = ny_sum / n_count
                        # Pull joint toward neighbor average
                        new_kp[base] = kp[base] * (1 - blend) + avg_x * blend
                        new_kp[base + 1] = kp[base + 1] * (1 - blend) + avg_y * blend
                
                kp = new_kp
                person["pose_keypoints_2d"] = kp
            
            # Also smooth face keypoints spatially (simple neighbor average on the ring)
            for fk in ("face_keypoints_2d",):
                fkp = person.get(fk)
                if not fkp or len(fkp) < 9:
                    continue
                num_pts = len(fkp) // 3
                for _ in range(passes):
                    new_fkp = list(fkp)
                    for j in range(num_pts):
                        b = j * 3
                        if fkp[b + 2] <= 0:
                            continue
                        # Average with prev and next point
                        neighbors_f = []
                        for delta in [-1, 1]:
                            ni = j + delta
                            if 0 <= ni < num_pts:
                                nb = ni * 3
                                if fkp[nb + 2] > 0:
                                    neighbors_f.append((fkp[nb], fkp[nb + 1]))
                        if neighbors_f:
                            avg_x = sum(p[0] for p in neighbors_f) / len(neighbors_f)
                            avg_y = sum(p[1] for p in neighbors_f) / len(neighbors_f)
                            new_fkp[b] = fkp[b] * (1 - blend) + avg_x * blend
                            new_fkp[b + 1] = fkp[b + 1] * (1 - blend) + avg_y * blend
                    fkp = new_fkp
                    person[fk] = fkp
    
    return pose_data


def rotate_point(pt, pivot, angle_rad):
    """Rotate a point around a pivot by angle in radians."""
    cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
    dx, dy = pt[0] - pivot[0], pt[1] - pivot[1]
    return (pivot[0] + dx * cos_a - dy * sin_a, pivot[1] + dx * sin_a + dy * cos_a)


def scale_point(pt, center, scale_x, scale_y=None):
    """Scale a point relative to a center."""
    if scale_y is None:
        scale_y = scale_x
    return (center[0] + (pt[0] - center[0]) * scale_x, center[1] + (pt[1] - center[1]) * scale_y)


def pil_to_tensor(pil_image):
    """Convert PIL Image to torch tensor."""
    return torch.from_numpy(np.array(pil_image).astype(np.float32) / 255.0).unsqueeze(0)


def interpolate_value(start, end, t, mode="linear"):
    """Interpolate between start and end based on t (0-1) and mode."""
    if mode == "linear":
        return start + (end - start) * t
    elif mode == "ease_in":
        return start + (end - start) * (t * t)
    elif mode == "ease_out":
        return start + (end - start) * (1 - (1 - t) ** 2)
    elif mode == "ease_in_out":
        if t < 0.5:
            return start + (end - start) * (2 * t * t)
        else:
            return start + (end - start) * (1 - (-2 * t + 2) ** 2 / 2)
    elif mode == "bounce":
        t2 = t
        if t2 < (1 / 2.75):
            return start + (end - start) * (7.5625 * t2 * t2)
        elif t2 < (2 / 2.75):
            t2 -= (1.5 / 2.75)
            return start + (end - start) * (7.5625 * t2 * t2 + 0.75)
        elif t2 < (2.5 / 2.75):
            t2 -= (2.25 / 2.75)
            return start + (end - start) * (7.5625 * t2 * t2 + 0.9375)
        else:
            t2 -= (2.625 / 2.75)
            return start + (end - start) * (7.5625 * t2 * t2 + 0.984375)
    elif mode == "sine":
        return start + (end - start) * (0.5 - 0.5 * math.cos(t * math.pi))
    return start + (end - start) * t


def interpolate_param_keyframes(keyframes, total_frames, param_names, defaults):
    """Interpolate ALL parameter values across frames from keyframes.

    Supports two formats:
      NEW: {paramName: [{frame, value, easing}, ...], ...}  (per-param keyframes)
      OLD: [{frame, easing, param1, param2, ...}, ...]       (global keyframes)

    Returns:
        List of dicts (one per frame), each containing all param values.
    """
    if not keyframes or total_frames <= 0:
        return [dict(defaults) for _ in range(max(1, total_frames))]

    # Detect format
    if isinstance(keyframes, dict):
        # NEW per-param format: {paramName: [{frame, value, easing}, ...]}
        result = [dict(defaults) for _ in range(total_frames)]
        
        for param_name, kfs in keyframes.items():
            if not kfs or param_name not in defaults:
                continue
            
            sorted_kfs = sorted(kfs, key=lambda k: k.get("frame", 0))
            
            # Extend to cover full range
            if sorted_kfs[0].get("frame", 0) > 0:
                sorted_kfs.insert(0, {"frame": 0, "value": sorted_kfs[0]["value"], "easing": "linear"})
            last_frame = total_frames - 1
            if sorted_kfs[-1].get("frame", 0) < last_frame:
                sorted_kfs.append({"frame": last_frame, "value": sorted_kfs[-1]["value"], "easing": "linear"})
            
            for f in range(total_frames):
                kf_before = sorted_kfs[0]
                kf_after = sorted_kfs[-1]
                for i in range(len(sorted_kfs) - 1):
                    if sorted_kfs[i]["frame"] <= f <= sorted_kfs[i + 1]["frame"]:
                        kf_before = sorted_kfs[i]
                        kf_after = sorted_kfs[i + 1]
                        break
                
                f_start = kf_before.get("frame", 0)
                f_end = kf_after.get("frame", 0)
                easing = kf_before.get("easing", "linear")
                t = 0.0 if f_end == f_start else (f - f_start) / (f_end - f_start)
                
                a = kf_before.get("value", defaults.get(param_name, 0.0))
                b = kf_after.get("value", defaults.get(param_name, 0.0))
                result[f][param_name] = interpolate_value(a, b, t, easing)
        
        return result
    
    # OLD global format: [{frame, easing, param1, param2, ...}]
    kfs = sorted(keyframes, key=lambda k: k.get("frame", 0))

    # Ensure coverage from frame 0 to last frame
    if kfs[0].get("frame", 0) > 0:
        first = dict(defaults)
        first["frame"] = 0
        first["easing"] = "linear"
        for p in param_names:
            first[p] = kfs[0].get(p, defaults.get(p, 0.0))
        kfs.insert(0, first)

    last_frame = total_frames - 1
    if kfs[-1].get("frame", 0) < last_frame:
        last_kf = {"frame": last_frame, "easing": "linear"}
        for p in param_names:
            last_kf[p] = kfs[-1].get(p, defaults.get(p, 0.0))
        kfs.append(last_kf)

    # Build per-frame values
    result = []
    for f in range(total_frames):
        kf_before = kfs[0]
        kf_after = kfs[-1]
        for i in range(len(kfs) - 1):
            if kfs[i]["frame"] <= f <= kfs[i + 1]["frame"]:
                kf_before = kfs[i]
                kf_after = kfs[i + 1]
                break

        f_start = kf_before.get("frame", 0)
        f_end = kf_after.get("frame", 0)
        easing = kf_before.get("easing", "linear")
        t = 0.0 if f_end == f_start else (f - f_start) / (f_end - f_start)

        frame_vals = {}
        for p in param_names:
            a = kf_before.get(p, defaults.get(p, 0.0))
            b = kf_after.get(p, defaults.get(p, 0.0))
            frame_vals[p] = interpolate_value(a, b, t, easing)

        result.append(frame_vals)

    return result


# =============================================================================
# BODY PROPORTION FUNCTIONS
# =============================================================================

def apply_body_proportions(pts, params, cw, ch):
    """Apply body proportion adjustments to keypoints."""
    pts = [[p[0], p[1], p[2]] for p in pts]
    
    def scale_from(anchor_idx, target_idx, scale, children=None):
        if pts[anchor_idx][2] == 0 or pts[target_idx][2] == 0:
            return
        anchor = np.array(pts[anchor_idx][:2])
        target = np.array(pts[target_idx][:2])
        vec = target - anchor
        new_pos = anchor + vec * scale
        offset = new_pos - target
        pts[target_idx][0], pts[target_idx][1] = new_pos[0], new_pos[1]
        if children:
            for c in children:
                if pts[c][2] > 0:
                    pts[c][0] += offset[0]
                    pts[c][1] += offset[1]
    
    def rotate_around(pivot_idx, target_idx, angle_deg, children=None):
        if pts[pivot_idx][2] == 0 or pts[target_idx][2] == 0:
            return
        pivot = (pts[pivot_idx][0], pts[pivot_idx][1])
        angle_rad = math.radians(angle_deg)
        new_pos = rotate_point((pts[target_idx][0], pts[target_idx][1]), pivot, angle_rad)
        offset_x = new_pos[0] - pts[target_idx][0]
        offset_y = new_pos[1] - pts[target_idx][1]
        pts[target_idx][0], pts[target_idx][1] = new_pos[0], new_pos[1]
        if children:
            for c in children:
                if pts[c][2] > 0:
                    pts[c][0] += offset_x
                    pts[c][1] += offset_y
    
    # Store anchor position
    anchor_y = pts[10][1] if pts[10][2] > 0 else (pts[13][1] if pts[13][2] > 0 else None)
    
    # Head adjustments
    head_indices = [0, 14, 15, 16, 17]
    if pts[0][2] > 0:  # Use nose as reference
        nose = (pts[0][0], pts[0][1])
        for i in [14, 15, 16, 17]:
            if pts[i][2] > 0:
                pts[i][0] = nose[0] + (pts[i][0] - nose[0]) * params.get('head_width', 1.0)
                pts[i][1] = nose[1] + (pts[i][1] - nose[1]) * params.get('head_height', 1.0)
    
    # Head tilt
    if params.get('head_tilt', 0) != 0 and pts[1][2] > 0:
        neck = (pts[1][0], pts[1][1])
        angle_rad = math.radians(params['head_tilt'])
        for i in head_indices:
            if pts[i][2] > 0:
                new_pos = rotate_point((pts[i][0], pts[i][1]), neck, angle_rad)
                pts[i][0], pts[i][1] = new_pos[0], new_pos[1]
    
    # Neck length
    scale_from(1, 0, params.get('neck_length', 1.0), [14, 15, 16, 17])
    
    # Shoulder height
    if params.get('shoulder_height', 0) != 0:
        offset = params['shoulder_height'] * min(cw, ch) * 0.01
        for i in [2, 5]:
            if pts[i][2] > 0:
                pts[i][1] -= offset
    
    # Collarbone (shoulder width)
    scale_from(1, 2, params.get('collarbone_length', 1.0), [3, 4])
    scale_from(1, 5, params.get('collarbone_length', 1.0), [6, 7])
    
    # Arm angles
    if params.get('arm_angle', 0) != 0:
        rotate_around(2, 3, params['arm_angle'], [4])
        rotate_around(5, 6, -params['arm_angle'], [7])
    
    # Arm lengths
    scale_from(2, 3, params.get('upper_arm_length', 1.0), [4])
    scale_from(5, 6, params.get('upper_arm_length', 1.0), [7])
    scale_from(3, 4, params.get('forearm_length', 1.0))
    scale_from(6, 7, params.get('forearm_length', 1.0))
    
    # Torso tilt
    if params.get('torso_tilt', 0) != 0 and pts[1][2] > 0:
        hip_center = None
        if pts[8][2] > 0 and pts[11][2] > 0:
            hip_center = ((pts[8][0] + pts[11][0]) / 2, (pts[8][1] + pts[11][1]) / 2)
        elif pts[8][2] > 0:
            hip_center = (pts[8][0], pts[8][1])
        elif pts[11][2] > 0:
            hip_center = (pts[11][0], pts[11][1])
        
        if hip_center:
            angle_rad = math.radians(params['torso_tilt'])
            upper_body = [0, 1, 2, 3, 4, 5, 6, 7, 14, 15, 16, 17]
            for i in upper_body:
                if pts[i][2] > 0:
                    new_pos = rotate_point((pts[i][0], pts[i][1]), hip_center, angle_rad)
                    pts[i][0], pts[i][1] = new_pos[0], new_pos[1]
    
    # Torso length
    scale_from(1, 8, params.get('torso_length', 1.0), [9, 10])
    scale_from(1, 11, params.get('torso_length', 1.0), [12, 13])
    
    # Hip width
    if pts[8][2] > 0 and pts[11][2] > 0:
        hip_center_x = (pts[8][0] + pts[11][0]) / 2
        r_offset = (pts[8][0] - hip_center_x) * (params.get('hip_width', 1.0) - 1)
        l_offset = (pts[11][0] - hip_center_x) * (params.get('hip_width', 1.0) - 1)
        pts[8][0] += r_offset
        pts[11][0] += l_offset
        if pts[9][2] > 0: pts[9][0] += r_offset
        if pts[10][2] > 0: pts[10][0] += r_offset
        if pts[12][2] > 0: pts[12][0] += l_offset
        if pts[13][2] > 0: pts[13][0] += l_offset
    
    # Leg angles
    if params.get('legs_angle', 0) != 0:
        rotate_around(8, 9, params['legs_angle'], [10])
        rotate_around(11, 12, -params['legs_angle'], [13])
    
    # Leg lengths
    scale_from(8, 9, params.get('upper_leg_length', 1.0), [10])
    scale_from(11, 12, params.get('upper_leg_length', 1.0), [13])
    scale_from(9, 10, params.get('lower_leg_length', 1.0))
    scale_from(12, 13, params.get('lower_leg_length', 1.0))
    
    # Anchor to original foot position
    if anchor_y is not None:
        current_y = pts[10][1] if pts[10][2] > 0 else (pts[13][1] if pts[13][2] > 0 else None)
        if current_y is not None:
            offset = anchor_y - current_y
            for p in pts:
                if p[2] > 0:
                    p[1] += offset
    
    return pts


def apply_overall_transform(pts, scale, rotate, pos_x, pos_y, cw, ch):
    """Apply overall scale, rotation, and position to keypoints."""
    if not pts:
        return pts
    
    pts = [[p[0], p[1], p[2]] for p in pts]
    valid = [p for p in pts if p[2] > 0]
    if not valid:
        return pts
    
    # Detect if normalized
    sample_coords = [c for p in valid for c in [p[0], p[1]]]
    is_normalized = max(sample_coords) <= 1.0 if sample_coords else False
    width = 1.0 if is_normalized else cw
    height = 1.0 if is_normalized else ch
    
    # Calculate center
    center_x = sum(p[0] for p in valid) / len(valid)
    center_y = sum(p[1] for p in valid) / len(valid)
    
    angle_rad = math.radians(rotate)
    cos_r, sin_r = math.cos(angle_rad), math.sin(angle_rad)
    
    for p in pts:
        if p[2] > 0:
            # Scale around center
            dx = (p[0] - center_x) * scale
            dy = (p[1] - center_y) * scale
            # Rotate
            new_dx = dx * cos_r - dy * sin_r
            new_dy = dx * sin_r + dy * cos_r
            # Translate
            p[0] = center_x + new_dx + pos_x * width
            p[1] = center_y + new_dy + pos_y * height
    
    return pts


# =============================================================================
# FACE EDITING FUNCTIONS
# =============================================================================

def edit_face(fp, params, cw, ch):
    """Apply face editing parameters to face keypoints."""
    if not fp or len(fp) < 2:
        return fp
    
    e = [[p[0], p[1], p[2]] for p in fp]
    s = min(cw, ch)
    n_pts = len(e)
    
    # ── 48-point mocap format ──────────────────────────────────────
    if n_pts < 68:
        # Index groups for 48-point template
        JAWLINE  = list(range(0, 9))
        L_BROW   = list(range(9, 14))
        R_BROW   = list(range(14, 19))
        NOSE_ALL = list(range(19, 28))
        L_EYE    = list(range(28, 32))
        R_EYE    = list(range(32, 36))
        OUTER_MOUTH = list(range(36, 42))
        INNER_MOUTH = list(range(42, 46))
        ALL_MOUTH = OUTER_MOUTH + INNER_MOUTH
        # eye open/close sub-indices
        L_EYE_TOP, L_EYE_BOT = [29], [31]
        R_EYE_TOP, R_EYE_BOT = [33], [35]
        # brow pivot points (inner)
        L_BROW_PIVOT, R_BROW_PIVOT = 9, 14

        original_fc = get_centroid(e, range(n_pts))

        # face_scale
        if params.get("face_scale", 1.0) != 1.0 and original_fc:
            for i in range(n_pts):
                if e[i][2] > 0:
                    new_pos = scale_point((e[i][0], e[i][1]), original_fc, params["face_scale"])
                    e[i][0], e[i][1] = new_pos[0], new_pos[1]

        # eye_spacing
        if params.get("eye_spacing", 0) != 0:
            offset = params["eye_spacing"] * s * 0.05
            for i in R_EYE + R_BROW:
                if i < n_pts: e[i][0] -= offset
            for i in L_EYE + L_BROW:
                if i < n_pts: e[i][0] += offset

        # eye_height
        if params.get("eye_height", 0) != 0:
            offset = params["eye_height"] * s * 0.05
            for i in L_EYE + R_EYE + L_BROW + R_BROW:
                if i < n_pts: e[i][1] -= offset

        # eye_open
        if params.get("eye_open", 0) != 0:
            offset = params["eye_open"] * s * 0.02
            for i in L_EYE_TOP + R_EYE_TOP:
                if i < n_pts: e[i][1] -= offset
            for i in L_EYE_BOT + R_EYE_BOT:
                if i < n_pts: e[i][1] += offset

        # eyebrow_height
        if params.get("eyebrow_height", 0) != 0:
            offset = params["eyebrow_height"] * s * 0.05
            for i in L_BROW + R_BROW:
                if i < n_pts: e[i][1] -= offset

        # eyebrow_tilt
        if params.get("eyebrow_tilt", 0) != 0:
            angle_rad = math.radians(params["eyebrow_tilt"])
            piv_r = (e[R_BROW_PIVOT][0], e[R_BROW_PIVOT][1])
            piv_l = (e[L_BROW_PIVOT][0], e[L_BROW_PIVOT][1])
            for i in R_BROW:
                new_pos = rotate_point((e[i][0], e[i][1]), piv_r, -angle_rad)
                e[i][0], e[i][1] = new_pos[0], new_pos[1]
            for i in L_BROW:
                new_pos = rotate_point((e[i][0], e[i][1]), piv_l, angle_rad)
                e[i][0], e[i][1] = new_pos[0], new_pos[1]

        # jaw_width
        if params.get("jaw_width", 1.0) != 1.0:
            jc = get_centroid(e, JAWLINE)
            if jc:
                for i in JAWLINE:
                    new_pos = scale_point((e[i][0], e[i][1]), jc, params["jaw_width"], 1.0)
                    e[i][0], e[i][1] = new_pos[0], new_pos[1]

        # nose_scale
        if params.get("nose_scale", 1.0) != 1.0:
            nc = get_centroid(e, NOSE_ALL)
            if nc:
                for i in NOSE_ALL:
                    new_pos = scale_point((e[i][0], e[i][1]), nc, params["nose_scale"])
                    e[i][0], e[i][1] = new_pos[0], new_pos[1]

        # mouth_width
        if params.get("mouth_width", 1.0) != 1.0:
            mc = get_centroid(e, OUTER_MOUTH)
            if mc:
                for i in ALL_MOUTH:
                    new_pos = scale_point((e[i][0], e[i][1]), mc, params["mouth_width"], 1.0)
                    e[i][0], e[i][1] = new_pos[0], new_pos[1]

        # mouth_height
        if params.get("mouth_height", 1.0) != 1.0:
            mc = get_centroid(e, OUTER_MOUTH)
            if mc:
                for i in ALL_MOUTH:
                    new_pos = scale_point((e[i][0], e[i][1]), mc, 1.0, params["mouth_height"])
                    e[i][0], e[i][1] = new_pos[0], new_pos[1]

        # mouth_position_y
        if params.get("mouth_position_y", 0) != 0:
            offset = params["mouth_position_y"] * s * 0.05
            for i in ALL_MOUTH:
                e[i][1] += offset

        # smile
        if params.get("smile", 0) != 0:
            offset = params["smile"] * s * 0.03
            e[36][1] -= offset       # mouth_left
            e[40][1] -= offset       # mouth_right
            e[37][1] -= offset * 0.5 # mouth_top_left
            e[39][1] -= offset * 0.5 # mouth_top_right

        return e
    
    # ── Standard 68-point OpenPose face editing ────────────────────
    # Calculate original center for face_scale
    original_fc = get_centroid(e, range(68))
    
    # Apply face_scale FIRST
    if params.get("face_scale", 1.0) != 1.0 and original_fc:
        for i in range(len(e)):
            if e[i][2] > 0:
                new_pos = scale_point((e[i][0], e[i][1]), original_fc, params["face_scale"])
                e[i][0], e[i][1] = new_pos[0], new_pos[1]
    
    # Eye spacing
    if params.get("eye_spacing", 0) != 0:
        offset = params["eye_spacing"] * s * 0.05
        for i in FACE_PARTS["right_eye"]:
            e[i][0] -= offset
        for i in FACE_PARTS["right_eyebrow"]:
            e[i][0] -= offset
        if len(e) > RIGHT_PUPIL and e[RIGHT_PUPIL][2] > 0:
            e[RIGHT_PUPIL][0] -= offset
        for i in FACE_PARTS["left_eye"]:
            e[i][0] += offset
        for i in FACE_PARTS["left_eyebrow"]:
            e[i][0] += offset
        if len(e) > LEFT_PUPIL and e[LEFT_PUPIL][2] > 0:
            e[LEFT_PUPIL][0] += offset
    
    # Eye height
    if params.get("eye_height", 0) != 0:
        offset = params["eye_height"] * s * 0.05
        for i in FACE_PARTS["right_eye"] + FACE_PARTS["left_eye"]:
            e[i][1] -= offset
        for i in FACE_PARTS["right_eyebrow"] + FACE_PARTS["left_eyebrow"]:
            e[i][1] -= offset
        if len(e) > RIGHT_PUPIL and e[RIGHT_PUPIL][2] > 0:
            e[RIGHT_PUPIL][1] -= offset
        if len(e) > LEFT_PUPIL and e[LEFT_PUPIL][2] > 0:
            e[LEFT_PUPIL][1] -= offset
    
    # Eye open/close
    if params.get("eye_open", 0) != 0:
        offset = params["eye_open"] * s * 0.02
        for i in RIGHT_EYE_TOP:
            e[i][1] -= offset
        for i in RIGHT_EYE_BOTTOM:
            e[i][1] += offset
        for i in LEFT_EYE_TOP:
            e[i][1] -= offset
        for i in LEFT_EYE_BOTTOM:
            e[i][1] += offset
    
    # Eyebrow height
    if params.get("eyebrow_height", 0) != 0:
        offset = params["eyebrow_height"] * s * 0.05
        for i in FACE_PARTS["right_eyebrow"] + FACE_PARTS["left_eyebrow"]:
            e[i][1] -= offset
    
    # Eyebrow tilt
    if params.get("eyebrow_tilt", 0) != 0:
        angle_rad = math.radians(params["eyebrow_tilt"])
        for i in FACE_PARTS["right_eyebrow"]:
            new_pos = rotate_point((e[i][0], e[i][1]), (e[21][0], e[21][1]), -angle_rad)
            e[i][0], e[i][1] = new_pos[0], new_pos[1]
        for i in FACE_PARTS["left_eyebrow"]:
            new_pos = rotate_point((e[i][0], e[i][1]), (e[22][0], e[22][1]), angle_rad)
            e[i][0], e[i][1] = new_pos[0], new_pos[1]
    
    # Jaw width
    if params.get("jaw_width", 1.0) != 1.0:
        jc = get_centroid(e, FACE_PARTS["jawline"])
        if jc:
            for i in FACE_PARTS["jawline"]:
                new_pos = scale_point((e[i][0], e[i][1]), jc, params["jaw_width"], 1.0)
                e[i][0], e[i][1] = new_pos[0], new_pos[1]
    
    # Nose scale
    if params.get("nose_scale", 1.0) != 1.0:
        nose_indices = FACE_PARTS["nose_bridge"] + FACE_PARTS["nose_tip"]
        nc = get_centroid(e, nose_indices)
        if nc:
            for i in nose_indices:
                new_pos = scale_point((e[i][0], e[i][1]), nc, params["nose_scale"])
                e[i][0], e[i][1] = new_pos[0], new_pos[1]
    
    # Mouth width
    if params.get("mouth_width", 1.0) != 1.0:
        mc = get_centroid(e, FACE_PARTS["outer_mouth"])
        if mc:
            for i in FACE_PARTS["outer_mouth"] + FACE_PARTS["inner_mouth"]:
                new_pos = scale_point((e[i][0], e[i][1]), mc, params["mouth_width"], 1.0)
                e[i][0], e[i][1] = new_pos[0], new_pos[1]
    
    # Mouth height
    if params.get("mouth_height", 1.0) != 1.0:
        mc = get_centroid(e, FACE_PARTS["outer_mouth"])
        if mc:
            for i in FACE_PARTS["outer_mouth"] + FACE_PARTS["inner_mouth"]:
                new_pos = scale_point((e[i][0], e[i][1]), mc, 1.0, params["mouth_height"])
                e[i][0], e[i][1] = new_pos[0], new_pos[1]
    
    # Mouth position Y - applied LAST
    if params.get("mouth_position_y", 0) != 0:
        offset = params["mouth_position_y"] * s * 0.05
        for i in FACE_PARTS["outer_mouth"] + FACE_PARTS["inner_mouth"]:
            e[i][1] += offset
    
    # Smile
    if params.get("smile", 0) != 0:
        offset = params["smile"] * s * 0.03
        e[48][1] -= offset
        e[54][1] -= offset
        e[49][1] -= offset * 0.5
        e[53][1] -= offset * 0.5
        e[59][1] -= offset * 0.5
        e[55][1] -= offset * 0.5
    
    return e


def apply_face_edits_to_body(body_pts, face_params, cw, ch):
    """Apply face slider effects to body head keypoints."""
    if not body_pts or len(body_pts) < 18:
        return body_pts
    
    e = [[p[0], p[1], p[2]] for p in body_pts]
    s = min(cw, ch)
    
    if e[0][2] <= 0:
        return e
    
    nose = (e[0][0], e[0][1])
    
    # Face scale affects body head points
    face_scale = face_params.get("face_scale", 1.0)
    if face_scale != 1.0:
        for i in [14, 15, 16, 17]:
            if e[i][2] > 0:
                new_pos = scale_point((e[i][0], e[i][1]), nose, face_scale)
                e[i][0], e[i][1] = new_pos[0], new_pos[1]
    
    # Eye spacing affects eye points
    eye_spacing = face_params.get("eye_spacing", 0.0)
    if eye_spacing != 0:
        offset = eye_spacing * s * 0.05
        if e[14][2] > 0:
            e[14][0] -= offset
        if e[15][2] > 0:
            e[15][0] += offset
    
    # Jaw width affects ear points
    jaw_width = face_params.get("jaw_width", 1.0)
    if jaw_width != 1.0:
        if e[16][2] > 0:
            e[16][0] = nose[0] + (e[16][0] - nose[0]) * jaw_width
        if e[17][2] > 0:
            e[17][0] = nose[0] + (e[17][0] - nose[0]) * jaw_width
    
    return e


def normalise_face_for_head_attach(fpts, body_pts, cw, ch):
    """Normalise face landmarks from a separate camera into the body's coordinate space.
    
    When face data comes from a dedicated face camera (close-up), the landmarks
    are in that camera's pixel space and need to be rescaled to fit the body's
    head size before attach_face_to_head positions them.
    
    Strategy:
    1. Centre face on its own nose tip (position-independent)
    2. Measure face bounding box height in face-cam pixels
    3. Measure body's head-to-neck distance in body pixels
    4. Scale face so its height matches ~1.8x the head-neck distance
       (face is taller than just nose-to-neck)
    5. Place centred face at the body's original nose position
       (attach_face_to_head will then handle final positioning)
    """
    if not fpts or len(fpts) < 2 or not body_pts or len(body_pts) < 2:
        return fpts
    
    # Body's nose and neck
    body_nose = body_pts[0]
    body_neck = body_pts[1]
    if body_nose[2] <= 0 or body_neck[2] <= 0:
        return fpts
    
    body_head_dist = math.sqrt(
        (body_nose[0] - body_neck[0]) ** 2 + (body_nose[1] - body_neck[1]) ** 2)
    if body_head_dist < 1:
        return fpts
    
    e = [[p[0], p[1], p[2]] for p in fpts]
    n_pts = len(e)
    
    # Find face anchor (nose tip)
    nose_idx = 30 if n_pts >= 68 else 23
    if nose_idx < n_pts and e[nose_idx][2] > 0:
        anchor = (e[nose_idx][0], e[nose_idx][1])
    else:
        fc = get_centroid(e, range(n_pts))
        if not fc:
            return fpts
        anchor = fc
    
    # Measure face bounding box in face-cam pixel space
    valid = [(p[0], p[1]) for p in e if p[2] > 0]
    if len(valid) < 4:
        return fpts
    
    face_min_y = min(p[1] for p in valid)
    face_max_y = max(p[1] for p in valid)
    face_height = face_max_y - face_min_y
    
    if face_height < 1:
        return fpts
    
    # Target face height = ~1.8x head-neck distance (face extends above and below nose)
    target_height = body_head_dist * 1.8
    scale_factor = target_height / face_height
    
    # Centre on anchor, scale, then place at body's original nose position
    for i in range(len(e)):
        if e[i][2] > 0:
            e[i][0] = (e[i][0] - anchor[0]) * scale_factor + body_nose[0]
            e[i][1] = (e[i][1] - anchor[1]) * scale_factor + body_nose[1]
    
    return e


def attach_face_to_head(fp, orig_body, mod_body, cw, ch, head_width=1.0, head_height=1.0, overall_scale=1.0):
    """Position face to follow head with per-region body keypoint anchoring."""
    if not fp or len(fp) < 2:
        return fp
    if not orig_body or not mod_body:
        return fp
    if len(orig_body) <= 1 or orig_body[0][2] <= 0:
        return fp
    if len(mod_body) <= 1 or mod_body[0][2] <= 0:
        return fp
    
    n_pts = len(fp)
    mod_head = (mod_body[0][0], mod_body[0][1])
    
    # Calculate rotation from head-neck vector
    rotation = 0.0
    if orig_body[1][2] > 0 and mod_body[1][2] > 0:
        orig_head = (orig_body[0][0], orig_body[0][1])
        orig_neck = (orig_body[1][0], orig_body[1][1])
        mod_neck = (mod_body[1][0], mod_body[1][1])
        orig_dx, orig_dy = orig_head[0] - orig_neck[0], orig_head[1] - orig_neck[1]
        mod_dx, mod_dy = mod_head[0] - mod_neck[0], mod_head[1] - mod_neck[1]
        if abs(orig_dx) > 1 or abs(orig_dy) > 1:
            orig_angle = math.atan2(orig_dy, orig_dx)
            mod_angle = math.atan2(mod_dy, mod_dx)
            rotation = mod_angle - orig_angle
    
    e = [[p[0], p[1], p[2]] for p in fp]
    
    # Use nose tip as default anchor: index 30 for 68-point, index 23 for 48-point
    nose_idx = 30 if n_pts >= 68 else 23
    if nose_idx < n_pts and e[nose_idx][2] > 0:
        anchor = (e[nose_idx][0], e[nose_idx][1])
    else:
        fc = get_centroid(e, range(n_pts))
        anchor = fc if fc else (orig_body[0][0], orig_body[0][1])
    
    cos_r, sin_r = math.cos(rotation), math.sin(rotation)
    scale_x = head_width * overall_scale
    scale_y = head_height * overall_scale
    
    # Face landmark → body keypoint anchor mapping (68-point face)
    # Right eye (36-41,68) + right eyebrow (17-21) → body right eye (14)
    # Left eye (42-47,69) + left eyebrow (22-26) → body left eye (15)
    # Right jaw (0-7) → body right ear (16)
    # Left jaw (9-16) → body left ear (17)
    # Chin (8), nose (27-35), mouth (48-67) → body nose (0)
    face_anchor_map = {}
    if n_pts >= 68:
        for fi in range(0, 8): face_anchor_map[fi] = 16
        face_anchor_map[8] = 0
        for fi in range(9, 17): face_anchor_map[fi] = 17
        for fi in range(17, 22): face_anchor_map[fi] = 14
        for fi in range(22, 27): face_anchor_map[fi] = 15
        for fi in range(27, 36): face_anchor_map[fi] = 0
        for fi in range(36, 42): face_anchor_map[fi] = 14
        for fi in range(42, 48): face_anchor_map[fi] = 15
        for fi in range(48, 68): face_anchor_map[fi] = 0
        if n_pts > 68: face_anchor_map[68] = 14
        if n_pts > 69: face_anchor_map[69] = 15
    
    # Compute per-anchor target positions
    anchor_targets = {0: mod_head}
    for body_idx in [14, 15, 16, 17]:
        if (len(mod_body) > body_idx and mod_body[body_idx][2] > 0 and
                len(orig_body) > body_idx and orig_body[body_idx][2] > 0):
            anchor_targets[body_idx] = (mod_body[body_idx][0], mod_body[body_idx][1])
        else:
            anchor_targets[body_idx] = mod_head
    
    for i in range(len(e)):
        if e[i][2] <= 0:
            continue
        
        body_idx = face_anchor_map.get(i)
        if body_idx is not None and body_idx != 0 and anchor_targets[body_idx] != mod_head:
            # Anchor to specific body keypoint (eye/ear)
            target = anchor_targets[body_idx]
            orig_anchor_body = (orig_body[body_idx][0], orig_body[body_idx][1])
            off_x = (e[i][0] - orig_anchor_body[0]) * scale_x
            off_y = (e[i][1] - orig_anchor_body[1]) * scale_y
            e[i][0] = target[0] + off_x * cos_r - off_y * sin_r
            e[i][1] = target[1] + off_x * sin_r + off_y * cos_r
        else:
            # Default: anchor to nose
            x = (e[i][0] - anchor[0]) * scale_x
            y = (e[i][1] - anchor[1]) * scale_y
            e[i][0] = mod_head[0] + x * cos_r - y * sin_r
            e[i][1] = mod_head[1] + x * sin_r + y * cos_r
    
    return e


# =============================================================================
# HAND EDITING FUNCTIONS
# =============================================================================

def edit_hand(hp, params, cw, ch, is_left):
    """Apply hand editing parameters."""
    if not hp or len(hp) < 21:
        return hp
    
    e = [[p[0], p[1], p[2]] for p in hp]
    wrist = (e[0][0], e[0][1]) if e[0][2] > 0 else None
    
    if not wrist:
        return e
    
    # Hand scale
    if params.get("hand_scale", 1.0) != 1.0:
        for i in range(1, 21):
            if e[i][2] > 0:
                new_pos = scale_point((e[i][0], e[i][1]), wrist, params["hand_scale"])
                e[i][0], e[i][1] = new_pos[0], new_pos[1]
    
    # Hand rotation
    if params.get("hand_rotate", 0) != 0:
        angle = params["hand_rotate"] if is_left else -params["hand_rotate"]
        angle_rad = math.radians(angle)
        for i in range(1, 21):
            if e[i][2] > 0:
                new_pos = rotate_point((e[i][0], e[i][1]), wrist, angle_rad)
                e[i][0], e[i][1] = new_pos[0], new_pos[1]
    
    return e


def attach_hand_to_wrist(hp, wrist_pos):
    """Move hand to match body wrist position."""
    if not hp or len(hp) < 1 or hp[0][2] <= 0:
        return hp
    
    e = [[p[0], p[1], p[2]] for p in hp]
    offset_x = wrist_pos[0] - e[0][0]
    offset_y = wrist_pos[1] - e[0][1]
    
    for p in e:
        if p[2] > 0:
            p[0] += offset_x
            p[1] += offset_y
    
    return e


# =============================================================================
# MANUAL JOINT TRANSFORM FUNCTIONS
# =============================================================================

BODY_KEYPOINT_CHILDREN = {
    0: [14, 15, 16, 17],
    1: [0, 2, 5, 8, 11, 14, 15, 16, 17],
    2: [3, 4],
    3: [4],
    5: [6, 7],
    6: [7],
    8: [9, 10],
    9: [10],
    11: [12, 13],
    12: [13],
}

HAND_KEYPOINT_CHILDREN = {
    0: list(range(1, 21)),
    1: [2, 3, 4], 2: [3, 4], 3: [4],
    5: [6, 7, 8], 6: [7, 8], 7: [8],
    9: [10, 11, 12], 10: [11, 12], 11: [12],
    13: [14, 15, 16], 14: [15, 16], 15: [16],
    17: [18, 19, 20], 18: [19, 20], 19: [20],
}


def apply_manual_transforms(points, transforms, children_map):
    """Apply manual joint transforms (move, rotate, scale)."""
    if not transforms or not points:
        return points
    
    pts = [[p[0], p[1], p[2]] for p in points]
    
    for joint_str, transform in transforms.items():
        try:
            joint_idx = int(joint_str)
        except (ValueError, TypeError):
            continue
        
        if joint_idx >= len(pts) or pts[joint_idx][2] <= 0:
            continue
        
        point = pts[joint_idx]
        
        # Get pivot for rotation/scale
        parent_idx = None
        for parent, children in children_map.items():
            if joint_idx in children:
                parent_idx = parent
                break
        
        if parent_idx is not None and parent_idx < len(pts) and pts[parent_idx][2] > 0:
            pivot = (pts[parent_idx][0], pts[parent_idx][1])
        else:
            pivot = (point[0], point[1])
        
        children = children_map.get(joint_idx, [])
        affected = [joint_idx] + children
        
        # Apply move
        move = transform.get('move', {})
        move_x, move_y = move.get('x', 0), move.get('y', 0)
        if move_x != 0 or move_y != 0:
            for idx in affected:
                if idx < len(pts) and pts[idx][2] > 0:
                    pts[idx][0] += move_x
                    pts[idx][1] += move_y
        
        # Apply rotation
        rotate_angle = transform.get('rotate', 0)
        if rotate_angle != 0:
            angle_rad = math.radians(rotate_angle)
            for idx in affected:
                if idx < len(pts) and pts[idx][2] > 0:
                    new_pos = rotate_point((pts[idx][0], pts[idx][1]), pivot, angle_rad)
                    pts[idx][0], pts[idx][1] = new_pos[0], new_pos[1]
        
        # Apply scale
        scale_factor = transform.get('scale', 1.0)
        if scale_factor != 1.0:
            for idx in affected:
                if idx == joint_idx:
                    continue
                if idx < len(pts) and pts[idx][2] > 0:
                    new_pos = scale_point((pts[idx][0], pts[idx][1]), (point[0], point[1]), scale_factor)
                    pts[idx][0], pts[idx][1] = new_pos[0], new_pos[1]
    
    return pts


# =============================================================================
# FRAME INTERPOLATION FUNCTIONS
# =============================================================================

def interpolate_keypoints(kp1, kp2, t):
    """Linearly interpolate between two keypoint arrays."""
    if not kp1 or not kp2:
        return kp1 if kp1 else kp2
    
    result = []
    for i in range(min(len(kp1), len(kp2))):
        p1, p2 = kp1[i], kp2[i]
        # If both points are valid, interpolate
        if p1[2] > 0 and p2[2] > 0:
            result.append([
                p1[0] + (p2[0] - p1[0]) * t,
                p1[1] + (p2[1] - p1[1]) * t,
                p1[2] + (p2[2] - p1[2]) * t
            ])
        # If only one is valid, use that one
        elif p1[2] > 0:
            result.append([p1[0], p1[1], p1[2]])
        elif p2[2] > 0:
            result.append([p2[0], p2[1], p2[2]])
        else:
            result.append([0, 0, 0])
    
    return result


def interpolate_frame(frame1, frame2, t):
    """Interpolate between two pose frames."""
    if not frame1 or not frame2:
        return frame1 if frame1 else frame2
    
    result = {
        "canvas_width": frame1.get("canvas_width", 512),
        "canvas_height": frame1.get("canvas_height", 512),
        "people": []
    }
    
    people1 = frame1.get("people", [])
    people2 = frame2.get("people", [])
    
    # Interpolate each person
    for i in range(max(len(people1), len(people2))):
        person1 = people1[i] if i < len(people1) else {}
        person2 = people2[i] if i < len(people2) else {}
        
        interp_person = {}
        
        # Interpolate body keypoints
        if "pose_keypoints_2d" in person1 or "pose_keypoints_2d" in person2:
            kp1 = parse_keypoints(person1.get("pose_keypoints_2d", []))
            kp2 = parse_keypoints(person2.get("pose_keypoints_2d", []))
            interp_kp = interpolate_keypoints(kp1, kp2, t)
            # Flatten back to array
            interp_person["pose_keypoints_2d"] = [v for p in interp_kp for v in p]
        
        # Interpolate face keypoints
        if "face_keypoints_2d" in person1 or "face_keypoints_2d" in person2:
            kp1 = parse_keypoints(person1.get("face_keypoints_2d", []))
            kp2 = parse_keypoints(person2.get("face_keypoints_2d", []))
            interp_kp = interpolate_keypoints(kp1, kp2, t)
            interp_person["face_keypoints_2d"] = [v for p in interp_kp for v in p]
        
        # Interpolate hand keypoints
        if "hand_left_keypoints_2d" in person1 or "hand_left_keypoints_2d" in person2:
            kp1 = parse_keypoints(person1.get("hand_left_keypoints_2d", []))
            kp2 = parse_keypoints(person2.get("hand_left_keypoints_2d", []))
            interp_kp = interpolate_keypoints(kp1, kp2, t)
            interp_person["hand_left_keypoints_2d"] = [v for p in interp_kp for v in p]
        
        if "hand_right_keypoints_2d" in person1 or "hand_right_keypoints_2d" in person2:
            kp1 = parse_keypoints(person1.get("hand_right_keypoints_2d", []))
            kp2 = parse_keypoints(person2.get("hand_right_keypoints_2d", []))
            interp_kp = interpolate_keypoints(kp1, kp2, t)
            interp_person["hand_right_keypoints_2d"] = [v for p in interp_kp for v in p]
        
        result["people"].append(interp_person)
    
    return result


def expand_frames_with_interpolation(frames, multiplier):
    """Expand frames by interpolating between them.
    
    multiplier=1: No change (60 frames -> 60 frames)
    multiplier=2: Double frames (60 frames -> 120 frames)
    multiplier=3: Triple frames (60 frames -> 180 frames)
    """
    if multiplier <= 1 or len(frames) < 2:
        return frames
    
    expanded = []
    
    for i in range(len(frames) - 1):
        frame1 = frames[i]
        frame2 = frames[i + 1]
        
        # Add original frame
        expanded.append(frame1)
        
        # Add interpolated frames between this and next
        for j in range(1, multiplier):
            t = j / multiplier
            interp_frame = interpolate_frame(frame1, frame2, t)
            expanded.append(interp_frame)
    
    # Add the last frame
    expanded.append(frames[-1])
    
    return expanded


# =============================================================================
# RENDERING FUNCTIONS
# =============================================================================

def render_body(draw, pts, cw, ch, line_width=4, point_radius=5, visibility=None):
    """Render body keypoints and bones."""
    if visibility is None:
        visibility = {}
    
    # Normalize if needed
    sample = [p[0] for p in pts if p[2] > 0] + [p[1] for p in pts if p[2] > 0]
    if sample and max(sample) <= 1.0:
        pts = [[p[0] * cw, p[1] * ch, p[2]] for p in pts]
    
    # Define body part visibility mapping
    part_bones = {
        "head": [(1, 0), (0, 14), (14, 16), (0, 15), (15, 17)],
        "torso": [(1, 2), (1, 5), (1, 8), (1, 11)],
        "left_arm": [(5, 6), (6, 7)],
        "right_arm": [(2, 3), (3, 4)],
        "left_leg": [(11, 12), (12, 13)],
        "right_leg": [(8, 9), (9, 10)],
    }
    
    part_points = {
        "head": [0, 14, 15, 16, 17],
        "torso": [1, 8, 11],
        "left_arm": [5, 6, 7],
        "right_arm": [2, 3, 4],
        "left_leg": [11, 12, 13],
        "right_leg": [8, 9, 10],
    }
    
    # Draw bones
    for (s, e), color in BODY_BONE_CONNECTIONS.items():
        # Check visibility
        visible = True
        for part, bones in part_bones.items():
            if (s, e) in bones or (e, s) in bones:
                if not visibility.get(part, True):
                    visible = False
                    break
        
        if not visible:
            continue
        
        if s < len(pts) and e < len(pts) and pts[s][2] > 0 and pts[e][2] > 0:
            draw.line([(pts[s][0], pts[s][1]), (pts[e][0], pts[e][1])], fill=color, width=line_width)
    
    # Draw points
    for idx, p in enumerate(pts):
        if p[2] <= 0 or idx >= len(BODY_KEYPOINT_COLORS):
            continue
        
        # Check visibility
        visible = True
        for part, points in part_points.items():
            if idx in points:
                if not visibility.get(part, True):
                    visible = False
                    break
        
        if not visible:
            continue
        
        color = BODY_KEYPOINT_COLORS.get(idx, (255, 255, 255))
        draw.ellipse([p[0] - point_radius, p[1] - point_radius, 
                     p[0] + point_radius, p[1] + point_radius], fill=color)


def render_face(draw, pts, cw, ch, line_width=2, point_radius=2, visible=True):
    """Render face keypoints (supports 48-point mocap and 68-point OpenPose formats)."""
    if not visible or not pts or len(pts) < 2:
        return
    
    # Normalize if needed
    sample = [p[0] for p in pts if p[2] > 0] + [p[1] for p in pts if p[2] > 0]
    if sample and max(sample) <= 1.0:
        pts = [[p[0] * cw, p[1] * ch, p[2]] for p in pts]
    
    color = (255, 255, 255)
    
    # Draw contour connections only for standard 68-point OpenPose face format
    if len(pts) >= 68:
        contours = [
            list(range(0, 17)),  # Jawline
            list(range(17, 22)),  # Right eyebrow
            list(range(22, 27)),  # Left eyebrow
            list(range(27, 31)),  # Nose bridge
            list(range(31, 36)),  # Nose tip
            list(range(36, 42)) + [36],  # Right eye (closed)
            list(range(42, 48)) + [42],  # Left eye (closed)
            list(range(48, 60)) + [48],  # Outer mouth (closed)
            list(range(60, 68)) + [60],  # Inner mouth (closed)
        ]
        
        for contour in contours:
            for i in range(len(contour) - 1):
                i1, i2 = contour[i], contour[i + 1]
                if i1 < len(pts) and i2 < len(pts) and pts[i1][2] > 0 and pts[i2][2] > 0:
                    draw.line([(pts[i1][0], pts[i1][1]), (pts[i2][0], pts[i2][1])], fill=color, width=line_width)
    
    # Draw points (works for any face format)
    pr = max(1, point_radius * 2 // 3) if len(pts) < 68 else point_radius
    for p in pts:
        if p[2] > 0:
            draw.ellipse([p[0] - pr, p[1] - pr,
                         p[0] + pr, p[1] + pr], fill=color)


def render_hand(draw, pts, cw, ch, line_width=2, point_radius=3, visible=True):
    """Render hand keypoints with OpenPose finger-color gradients."""
    if not visible or not pts or len(pts) < 21:
        return
    
    # Normalize if needed
    sample = [p[0] for p in pts if p[2] > 0] + [p[1] for p in pts if p[2] > 0]
    if sample and max(sample) <= 1.0:
        pts = [[p[0] * cw, p[1] * ch, p[2]] for p in pts]
    
    # Draw connections with finger-color gradients
    for s, e in HAND_CONNECTIONS:
        if s < len(pts) and e < len(pts) and pts[s][2] > 0 and pts[e][2] > 0:
            color = _hand_bone_color(s, e)
            draw.line([(pts[s][0], pts[s][1]), (pts[e][0], pts[e][1])], fill=color, width=line_width)
    
    # Draw points with per-keypoint finger colors
    for i, p in enumerate(pts):
        if p[2] > 0:
            color = _hand_kp_color(i)
            draw.ellipse([p[0] - point_radius, p[1] - point_radius,
                         p[0] + point_radius, p[1] + point_radius], fill=color)




# =============================================================================
# MAIN OPENPOSE PROPORTIONAL EDITOR NODE
# =============================================================================

class ComfyVFX_OpenPoseProportionalEditor:
    """
    Combined OpenPose editor for body, face, and hands.
    Features:
    - Body proportion adjustments
    - Face landmark editing
    - Hand pose editing
    - Visibility toggles for all parts
    - Interactive joint manipulation
    - Animation scheduling
    - Multiple render outputs
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # === BODY - HEAD ===
                "head_width": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "head_height": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "head_tilt": ("FLOAT", {"default": 0.0, "min": -45.0, "max": 45.0, "step": 1.0, "display": "slider"}),
                "neck_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                # === BODY - SHOULDERS ===
                "shoulder_height": ("FLOAT", {"default": 0.0, "min": -0.5, "max": 0.5, "step": 0.05, "display": "slider"}),
                "collarbone_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                # === BODY - ARMS ===
                "arm_angle": ("FLOAT", {"default": 0.0, "min": -45.0, "max": 45.0, "step": 1.0, "display": "slider"}),
                "upper_arm_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "forearm_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                # === BODY - TORSO ===
                "torso_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "torso_tilt": ("FLOAT", {"default": 0.0, "min": -45.0, "max": 45.0, "step": 1.0, "display": "slider"}),
                "hip_width": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                # === BODY - LEGS ===
                "legs_angle": ("FLOAT", {"default": 0.0, "min": -45.0, "max": 45.0, "step": 1.0, "display": "slider"}),
                "upper_leg_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "lower_leg_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                # === FACE - EYES ===
                "eye_spacing": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.05, "display": "slider"}),
                "eye_height": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.05, "display": "slider"}),
                "eye_open": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.05, "display": "slider"}),
                # === FACE - EYEBROWS ===
                "eyebrow_height": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.05, "display": "slider"}),
                "eyebrow_tilt": ("FLOAT", {"default": 0.0, "min": -30.0, "max": 30.0, "step": 1.0, "display": "slider"}),
                # === FACE - MOUTH ===
                "mouth_width": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "mouth_height": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "mouth_position_y": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.05, "display": "slider"}),
                "smile": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.05, "display": "slider"}),
                # === FACE - STRUCTURE ===
                "jaw_width": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "nose_scale": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "face_scale": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                # === HANDS ===
                "hand_scale": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05, "display": "slider"}),
                "hand_rotate": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0, "display": "slider"}),
                # === OVERALL TRANSFORM (at bottom) ===
                "temporal_smoothing": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider",
                    "tooltip": "Smooth keypoint positions over time (0=off, 1=max). Reduces frame-to-frame jitter."}),
                "spatial_smoothing": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider",
                    "tooltip": "Smooth keypoint positions relative to body neighbors (0=off, 1=max). Reduces spatial noise within each pose."}),
                "overall_scale": ("FLOAT", {"default": 1.0, "min": 0.25, "max": 3.0, "step": 0.05, "display": "slider"}),
                "overall_rotate": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0, "display": "slider"}),
                "position_x": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01, "display": "slider"}),
                "position_y": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01, "display": "slider"}),
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 1.0}),
                "frame_multiplier": ("INT", {"default": 1, "min": 1, "max": 3, "step": 1}),
                # === PREVIEW BACKGROUND (does NOT affect render outputs) ===
                "bg_opacity": ("FLOAT", {"default": 0.6, "min": 0.0, "max": 1.0, "step": 0.05, "display": "slider"}),
            },
            "optional": {
                "pose_keypoint": ("POSE_KEYPOINT",),
                "face_keypoint": ("POSE_KEYPOINT", {
                    "tooltip": "Optional separate face keypoint data (e.g. from a dedicated face camera). "
                               "If connected, replaces the face data from pose_keypoint while still "
                               "following the body's head position/rotation."}),
                "reference_image": ("IMAGE",),
                "param_keyframes": ("STRING", {
                    "default": "[]",
                    "tooltip": "JSON array of parameter keyframes from timeline (managed by JS frontend)"}),
                "joint_transforms": ("STRING", {"default": "{}"}),
                "visible_parts": ("STRING", {"default": "{}"}),
                "character_selection": ("STRING", {"default": "{}"}),
            }
        }
    
    RETURN_TYPES = ("POSE_KEYPOINT", "IMAGE", "IMAGE", "IMAGE")
    RETURN_NAMES = ("pose_keypoint", "combined_render", "body_render", "face_hands_render")
    FUNCTION = "process"
    CATEGORY = "ComfyVFX/pose"
    OUTPUT_NODE = True
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Only hash widget values that the user directly edits.
        # Do NOT iterate all kwargs — that includes pose_keypoint/reference_image
        # which are complex types and cause false cache misses.
        import hashlib, json as _json
        
        parts = []
        
        # JSON widget values — normalize to ensure consistent hashing
        for key in ("joint_transforms", "visible_parts", "character_selection", "param_keyframes"):
            raw = kwargs.get(key, "{}")
            try:
                parsed = _json.loads(raw) if raw else {}
                parts.append(f"{key}={_json.dumps(parsed, sort_keys=True, separators=(',',':'))}")
            except:
                parts.append(f"{key}={raw}")
        
        # Explicit list of slider params — only these can change via the UI
        slider_params = [
            "head_width", "head_height", "head_tilt", "neck_length", "shoulder_height",
            "collarbone_length", "arm_angle", "upper_arm_length", "forearm_length",
            "torso_length", "torso_tilt", "hip_width", "legs_angle",
            "upper_leg_length", "lower_leg_length",
            "eye_spacing", "eye_height", "eye_open", "eyebrow_height", "eyebrow_tilt",
            "mouth_width", "mouth_height", "mouth_position_y", "smile",
            "jaw_width", "nose_scale", "face_scale",
            "hand_scale", "hand_rotate",
            "overall_scale", "overall_rotate", "position_x", "position_y",
            "temporal_smoothing", "spatial_smoothing",
            "fps", "frame_multiplier", "bg_opacity",
        ]
        for k in slider_params:
            if k in kwargs:
                parts.append(f"{k}={kwargs[k]}")
        
        sig = "|".join(parts)
        return hashlib.md5(sig.encode()).hexdigest()
    
    # Class-level result cache to avoid reprocessing when nothing changed
    _cache_hash = None
    _cache_result = None
    
    def process(self, **kwargs):
        # Extract inputs
        pose_keypoint = kwargs.get("pose_keypoint")
        face_keypoint = kwargs.get("face_keypoint")  # separate face cam input
        reference_image = kwargs.get("reference_image")
        param_keyframes_str = kwargs.get("param_keyframes", "[]")
        joint_transforms_str = kwargs.get("joint_transforms", "{}")
        visible_parts_str = kwargs.get("visible_parts", "{}")
        character_selection_str = kwargs.get("character_selection", "{}")
        
        # ── Fast cache check: skip all processing if nothing changed ──
        import hashlib as _hl, json as _cj
        cache_parts = []
        # Hash pose input by sampling keypoints (fast, avoids hashing entire tensor)
        if pose_keypoint and isinstance(pose_keypoint, list) and len(pose_keypoint) > 0:
            cache_parts.append(f"frames={len(pose_keypoint)}")
            sample = pose_keypoint[0] if isinstance(pose_keypoint[0], dict) else {}
            people = sample.get("people", [])
            if people:
                kp = people[0].get("pose_keypoints_2d", [])[:9]
                cache_parts.append(f"kp0={kp}")
            cache_parts.append(f"cw={sample.get('canvas_width',0)}")
        else:
            cache_parts.append("frames=0")
        # Hash face input presence
        if face_keypoint is not None:
            cache_parts.append(f"face_frames={len(face_keypoint) if isinstance(face_keypoint, list) else 1}")
        # Hash all editing params
        for key in ("joint_transforms", "visible_parts", "character_selection", "param_keyframes"):
            raw = kwargs.get(key, "{}")
            try:
                parsed = _cj.loads(raw) if raw else {}
                cache_parts.append(f"{key}={_cj.dumps(parsed, sort_keys=True, separators=(',',':'))}")
            except:
                cache_parts.append(f"{key}={raw}")
        slider_params = list(PARAM_DEFAULTS.keys()) + ["fps", "frame_multiplier", "bg_opacity", "temporal_smoothing", "spatial_smoothing"]
        for k in slider_params:
            if k in kwargs:
                cache_parts.append(f"{k}={kwargs[k]}")
        
        cache_hash = _hl.md5("|".join(cache_parts).encode()).hexdigest()
        
        if cache_hash == ComfyVFX_OpenPoseProportionalEditor._cache_hash and ComfyVFX_OpenPoseProportionalEditor._cache_result is not None:
            print(f"[OpenPose Editor] CACHE HIT — skipping reprocessing ({len(pose_keypoint) if pose_keypoint else 0} frames)")
            return ComfyVFX_OpenPoseProportionalEditor._cache_result
        
        # --- DEBUG: Log execution and key params ---
        changed_params = {}
        for k in ALL_PARAMS:
            val = kwargs.get(k)
            default = PARAM_DEFAULTS.get(k)
            if val is not None and val != default:
                changed_params[k] = val
        
        n_frames = 0
        if pose_keypoint is not None:
            if isinstance(pose_keypoint, list):
                n_frames = len(pose_keypoint)
            else:
                n_frames = 1
        
        has_faces = False
        has_hands = False
        if pose_keypoint:
            sample = pose_keypoint[0] if isinstance(pose_keypoint, list) else pose_keypoint
            if isinstance(sample, dict):
                for p in sample.get("people", []):
                    if p.get("face_keypoints_2d"):
                        has_faces = True
                    if p.get("hand_left_keypoints_2d") or p.get("hand_right_keypoints_2d"):
                        has_hands = True
        
        print(f"[OpenPose Editor] EXECUTING: {n_frames} frames, "
              f"faces={has_faces}, hands={has_hands}, "
              f"transforms={joint_transforms_str[:80]}, "
              f"changed_params={changed_params}")
        # --- END DEBUG ---
        
        # Parse JSON strings — new format: {global: {...}, perChar: {idx: {...}}}
        # Backward compat: old format is just the transforms object directly
        per_char_transforms = {}
        try:
            jt_data = json.loads(joint_transforms_str) if joint_transforms_str else {}
            if "global" in jt_data:
                body_transforms = jt_data.get("global", {})
                per_char_transforms = jt_data.get("perChar", {})
            else:
                body_transforms = jt_data
        except:
            body_transforms = {}
        
        per_char_visibility = {}
        try:
            vp_data = json.loads(visible_parts_str) if visible_parts_str else {}
            if "global" in vp_data:
                visibility = vp_data.get("global", {})
                per_char_visibility = vp_data.get("perChar", {})
            else:
                visibility = vp_data
        except:
            visibility = {}
        
        # Parse character selection: {enabled: {idx: bool}, editingIdx: int|null, perChar: {idx: {param: val}}}
        try:
            char_selection = json.loads(character_selection_str) if character_selection_str else {}
        except:
            char_selection = {}
        
        char_enabled = char_selection.get("enabled", {})
        char_per_params = char_selection.get("perChar", {})
        
        # ── Canvas dimensions: POSE DATA is the authority ──
        # The pose keypoints are in DWPose's internal coordinate space.
        # We resize the reference image to match the pose dimensions,
        # NOT the other way around. This ensures 1:1 alignment.
        
        ref_w, ref_h = None, None
        if reference_image is not None:
            if reference_image.dim() == 4:
                ref_h, ref_w = reference_image.shape[1], reference_image.shape[2]
            else:
                ref_h, ref_w = reference_image.shape[0], reference_image.shape[1]
        
        pose_w, pose_h = None, None
        if pose_keypoint is not None:
            if isinstance(pose_keypoint, list) and len(pose_keypoint) > 0:
                pose_w = pose_keypoint[0].get("canvas_width", 512)
                pose_h = pose_keypoint[0].get("canvas_height", 512)
            elif isinstance(pose_keypoint, dict):
                pose_w = pose_keypoint.get("canvas_width", 512)
                pose_h = pose_keypoint.get("canvas_height", 512)
        
        # Pose data defines the coordinate space — always
        if pose_w and pose_h:
            cw, ch = pose_w, pose_h
        elif ref_w and ref_h:
            cw, ch = ref_w, ref_h
        else:
            cw, ch = 512, 512
        
        print(f"[OpenPose Editor] Canvas: {cw}x{ch} (pose={pose_w}x{pose_h}, ref={ref_w}x{ref_h})")
        
        # Diagnostic: if both ref and pose exist, check if the keypoints align with the reference
        if pose_keypoint and ref_w and ref_h and pose_w and pose_h:
            frame0 = pose_keypoint[0] if isinstance(pose_keypoint, list) else pose_keypoint
            if isinstance(frame0, dict) and frame0.get("people"):
                kps = frame0["people"][0].get("pose_keypoints_2d", [])
                if len(kps) >= 6:
                    nose_x, nose_y = kps[0], kps[1]
                    neck_x, neck_y = kps[3], kps[4]
                    # Where would these be on the reference image?
                    scale_x = ref_w / pose_w
                    scale_y = ref_h / pose_h
                    print(f"[OpenPose Editor] DIAG: nose=({nose_x:.1f},{nose_y:.1f}) neck=({neck_x:.1f},{neck_y:.1f}) in {pose_w}x{pose_h}")
                    print(f"[OpenPose Editor] DIAG: On ref {ref_w}x{ref_h} → nose=({nose_x*scale_x:.1f},{nose_y*scale_y:.1f}) neck=({neck_x*scale_x:.1f},{neck_y*scale_y:.1f})")
                    print(f"[OpenPose Editor] DIAG: Resized ref to {cw}x{ch}, keypoints stay at pose coords")
        
        # Build parameter dicts
        body_params = {k: kwargs.get(k, PARAM_DEFAULTS.get(k, 1.0)) for k in BODY_PARAMS}
        face_params = {k: kwargs.get(k, PARAM_DEFAULTS.get(k, 0.0)) for k in FACE_PARAMS}
        hand_params = {k: kwargs.get(k, PARAM_DEFAULTS.get(k, 1.0)) for k in HAND_PARAMS}
        
        o_scale = kwargs.get("overall_scale", 1.0)
        o_rot = kwargs.get("overall_rotate", 0.0)
        pos_x = kwargs.get("position_x", 0.0)
        pos_y = kwargs.get("position_y", 0.0)
        
        # Save reference image(s) for UI preview — RESIZED to pose coordinate space
        bg_filenames = []
        if reference_image is not None:
            try:
                temp_dir = folder_paths.get_temp_directory()
                if reference_image.dim() == 4:
                    num_bg_frames = reference_image.shape[0]
                    for bi in range(num_bg_frames):
                        arr = (reference_image[bi].cpu().numpy() * 255).astype(np.uint8)
                        pil_img = Image.fromarray(arr)
                        if pil_img.width != cw or pil_img.height != ch:
                            if bi == 0:
                                print(f"[OpenPose Editor] BG resize: {pil_img.width}x{pil_img.height} → {cw}x{ch}")
                            pil_img = pil_img.resize((cw, ch), Image.LANCZOS)
                        else:
                            if bi == 0:
                                print(f"[OpenPose Editor] BG already at: {pil_img.width}x{pil_img.height}")
                        fn = f"comfyvfx_prop_bg_{id(self)}_{bi:04d}.png"
                        pil_img.save(os.path.join(temp_dir, fn))
                        bg_filenames.append({"filename": fn, "subfolder": "", "type": "temp"})
                else:
                    arr = (reference_image.cpu().numpy() * 255).astype(np.uint8)
                    pil_img = Image.fromarray(arr)
                    if pil_img.width != cw or pil_img.height != ch:
                        print(f"[OpenPose Editor] BG resize: {pil_img.width}x{pil_img.height} → {cw}x{ch}")
                        pil_img = pil_img.resize((cw, ch), Image.LANCZOS)
                    else:
                        print(f"[OpenPose Editor] BG already at: {pil_img.width}x{pil_img.height}")
                    fn = f"comfyvfx_prop_bg_{id(self)}_0000.png"
                    pil_img.save(os.path.join(temp_dir, fn))
                    bg_filenames.append({"filename": fn, "subfolder": "", "type": "temp"})
            except Exception:
                pass
        
        bg_opacity = kwargs.get("bg_opacity", 0.6)
        
        # UI data
        fps = kwargs.get("fps", 24.0)
        ui_data = {
            "reference_image": bg_filenames[:1] if bg_filenames else [],  # backwards compat
            "bg_frames": bg_filenames,  # full sequence for JS
            "bg_opacity": [bg_opacity],
            "canvas_info": [{"width": cw, "height": ch}],
            "all_frames": [],
            "fps": [fps],
        }
        
        # Handle empty input
        if pose_keypoint is None:
            empty_img = pil_to_tensor(Image.new('RGB', (cw, ch), (0, 0, 0)))
            return {"ui": ui_data, "result": ([], empty_img, empty_img, empty_img)}
        
        # Normalize to list — keypoints stay in their original coordinate space
        pose_data = pose_keypoint if isinstance(pose_keypoint, list) else [pose_keypoint]
        
        # Normalize separate face input (if connected)
        face_data = None
        if face_keypoint is not None:
            face_data = face_keypoint if isinstance(face_keypoint, list) else [face_keypoint]
        
        # Apply frame interpolation if multiplier > 1
        frame_multiplier = kwargs.get("frame_multiplier", 1)
        if frame_multiplier > 1:
            pose_data = expand_frames_with_interpolation(pose_data, frame_multiplier)
        
        ui_data["all_frames"] = []  # Will be set after person-order stabilization
        
        # Parse parameter keyframes and pre-interpolate all values across frames
        try:
            param_kf_raw = json.loads(param_keyframes_str) if param_keyframes_str else {}
        except Exception:
            param_kf_raw = {}
        
        total_frames = len(pose_data)
        if param_kf_raw and total_frames > 0:
            kf_all_values = interpolate_param_keyframes(
                param_kf_raw, total_frames, ALL_PARAMS, PARAM_DEFAULTS)
        else:
            kf_all_values = None
        
        # ── Stabilize person ordering across frames ──
        # DWPose does not guarantee consistent person indices between frames.
        # We re-order people[] in each frame to match the previous frame's ordering
        # using nearest-neighbor matching on body centroid (neck + hip midpoint).
        def _get_person_centroid(person):
            """Get a stable centroid for a person using neck (idx 1) and hip (idx 8)."""
            kp = person.get("pose_keypoints_2d", [])
            points = []
            for idx in [1, 8, 0]:  # neck, mid-hip, nose — in priority order
                base = idx * 3
                if len(kp) > base + 2 and kp[base + 2] > 0:
                    points.append((kp[base], kp[base + 1]))
            if points:
                cx = sum(p[0] for p in points) / len(points)
                cy = sum(p[1] for p in points) / len(points)
                return (cx, cy)
            return None
        
        prev_centroids = None
        for frame_data in pose_data:
            if not isinstance(frame_data, dict):
                continue
            people = frame_data.get("people", [])
            if len(people) <= 1:
                prev_centroids = [_get_person_centroid(p) for p in people]
                continue
            
            curr_centroids = [_get_person_centroid(p) for p in people]
            
            if prev_centroids and len(prev_centroids) == len(people):
                # Check if current ordering matches previous by comparing distances
                # Try both orderings and pick the one with smaller total distance
                valid = all(c is not None for c in curr_centroids) and all(c is not None for c in prev_centroids)
                if valid and len(people) == 2:
                    # Direct match distance
                    d_direct = math.dist(curr_centroids[0], prev_centroids[0]) + math.dist(curr_centroids[1], prev_centroids[1])
                    # Swapped distance
                    d_swapped = math.dist(curr_centroids[0], prev_centroids[1]) + math.dist(curr_centroids[1], prev_centroids[0])
                    
                    if d_swapped < d_direct:
                        # Swap people to maintain consistent ordering
                        frame_data["people"] = [people[1], people[0]]
                        curr_centroids = [curr_centroids[1], curr_centroids[0]]
                elif valid and len(people) > 2:
                    # General case: greedy nearest-neighbor matching
                    used = set()
                    new_order = [None] * len(people)
                    for prev_idx, prev_c in enumerate(prev_centroids):
                        best_curr = None
                        best_dist = float('inf')
                        for curr_idx, curr_c in enumerate(curr_centroids):
                            if curr_idx in used:
                                continue
                            d = math.dist(prev_c, curr_c)
                            if d < best_dist:
                                best_dist = d
                                best_curr = curr_idx
                        if best_curr is not None:
                            new_order[prev_idx] = people[best_curr]
                            used.add(best_curr)
                    # Fill any remaining slots
                    remaining = [i for i in range(len(people)) if i not in used]
                    for i, slot in enumerate(new_order):
                        if slot is None and remaining:
                            new_order[i] = people[remaining.pop(0)]
                    frame_data["people"] = new_order
                    curr_centroids = [_get_person_centroid(p) for p in new_order]
            
            prev_centroids = curr_centroids
        
        # ── Apply smoothing to stabilized data ──
        temporal_smooth = kwargs.get("temporal_smoothing", 0.0)
        spatial_smooth = kwargs.get("spatial_smoothing", 0.0)
        
        if spatial_smooth > 0:
            pose_data = apply_spatial_smoothing(pose_data, spatial_smooth)
        
        if temporal_smooth > 0:
            pose_data = apply_temporal_smoothing(pose_data, temporal_smooth)
        
        # Send stabilized + smoothed frame data to JS for preview
        ui_data["all_frames"] = [json.loads(json.dumps(f)) for f in pose_data if isinstance(f, dict)]
        
        # Process frames
        output_poses = []
        combined_images = []
        body_images = []
        face_hand_images = []
        
        for frame_idx, frame_data in enumerate(pose_data):
            if not isinstance(frame_data, dict):
                continue
            
            fcw = frame_data.get("canvas_width", cw)
            fch = frame_data.get("canvas_height", ch)
            
            # Get parameters for this frame: keyframe-interpolated values override slider defaults
            if kf_all_values and frame_idx < len(kf_all_values):
                kf_vals = kf_all_values[frame_idx]
                frame_body_params = {k: kf_vals.get(k, body_params[k]) for k in BODY_PARAMS}
                frame_face_params = {k: kf_vals.get(k, face_params[k]) for k in FACE_PARAMS}
                frame_hand_params = {k: kf_vals.get(k, hand_params[k]) for k in HAND_PARAMS}
                frame_o_scale = kf_vals.get("overall_scale", o_scale)
                frame_o_rot = kf_vals.get("overall_rotate", o_rot)
                frame_pos_x = kf_vals.get("position_x", pos_x)
                frame_pos_y = kf_vals.get("position_y", pos_y)
            else:
                frame_body_params = body_params.copy()
                frame_face_params = face_params.copy()
                frame_hand_params = hand_params.copy()
                frame_o_scale = o_scale
                frame_o_rot = o_rot
                frame_pos_x = pos_x
                frame_pos_y = pos_y
            
            # Create images
            combined_img = Image.new('RGB', (fcw, fch), (0, 0, 0))
            body_img = Image.new('RGB', (fcw, fch), (0, 0, 0))
            face_hand_img = Image.new('RGB', (fcw, fch), (0, 0, 0))
            
            combined_draw = ImageDraw.Draw(combined_img)
            body_draw = ImageDraw.Draw(body_img)
            face_hand_draw = ImageDraw.Draw(face_hand_img)
            
            edited_frame = {
                "canvas_width": fcw,
                "canvas_height": fch,
                "people": []
            }
            
            for person_idx, person in enumerate(frame_data.get("people", [])):
                # Check if this character is enabled (default True)
                idx_str = str(person_idx)
                is_enabled = char_enabled.get(idx_str, char_enabled.get(person_idx, True))
                if is_enabled is False:
                    continue  # Skip disabled characters
                
                # Get per-character params if available
                use_body_params = frame_body_params.copy()
                use_face_params = frame_face_params.copy()
                use_hand_params = frame_hand_params.copy()
                use_o_scale = frame_o_scale
                use_o_rot = frame_o_rot
                use_pos_x = frame_pos_x
                use_pos_y = frame_pos_y
                use_visibility = visibility.copy()  # per-character visibility
                
                # Apply per-character visibility from perCharVisibleParts
                if idx_str in per_char_visibility:
                    use_visibility = {**visibility, **per_char_visibility[idx_str]}
                
                if idx_str in char_per_params:
                    per_char = char_per_params[idx_str]
                    
                    # Per-character keyframes: _keyframes = {paramName: [{frame, value, easing}]}
                    per_char_kfs = per_char.get("_keyframes", {})
                    if per_char_kfs and total_frames > 1:
                        # Interpolate per-char keyframes for this frame
                        pc_kf_values = interpolate_param_keyframes(per_char_kfs, total_frames, ALL_PARAMS, PARAM_DEFAULTS)
                        if frame_idx < len(pc_kf_values):
                            pc_vals = pc_kf_values[frame_idx]
                            for k, v in pc_vals.items():
                                # Only apply if this param actually has per-char keyframes
                                if k in per_char_kfs:
                                    if k in use_body_params: use_body_params[k] = v
                                    elif k in use_face_params: use_face_params[k] = v
                                    elif k in use_hand_params: use_hand_params[k] = v
                                    elif k == "overall_scale": use_o_scale = v
                                    elif k == "overall_rotate": use_o_rot = v
                                    elif k == "position_x": use_pos_x = v
                                    elif k == "position_y": use_pos_y = v
                    
                    # Static per-character overrides (only for params WITHOUT per-char keyframes)
                    for k, v in per_char.items():
                        if k.startswith("_"):
                            if k == "_visibility" and isinstance(v, dict):
                                use_visibility = {**use_visibility, **v}
                            continue  # Skip _keyframes, _visibility etc
                        # Only apply static override if no per-char keyframe exists for this param
                        if k in per_char_kfs:
                            continue
                        if k in use_body_params:
                            use_body_params[k] = v
                        elif k in use_face_params:
                            use_face_params[k] = v
                        elif k in use_hand_params:
                            use_hand_params[k] = v
                        elif k == "overall_scale":
                            use_o_scale = v
                        elif k == "overall_rotate":
                            use_o_rot = v
                        elif k == "position_x":
                            use_pos_x = v
                        elif k == "position_y":
                            use_pos_y = v
                
                # Per-character joint transforms
                use_transforms = body_transforms
                if idx_str in per_char_transforms:
                    use_transforms = per_char_transforms[idx_str]
                
                edited_person = {}
                orig_bpts, bpts = None, None
                left_wrist, right_wrist = None, None
                
                # Process body
                if "pose_keypoints_2d" in person and person["pose_keypoints_2d"]:
                    orig_bpts = parse_keypoints(person["pose_keypoints_2d"])
                    bpts = apply_body_proportions([[p[0], p[1], p[2]] for p in orig_bpts], use_body_params, fcw, fch)
                    
                    # Apply face edits to body head points
                    bpts = apply_face_edits_to_body(bpts, use_face_params, fcw, fch)
                    
                    # Apply manual transforms
                    if use_transforms:
                        bpts = apply_manual_transforms(bpts, use_transforms, BODY_KEYPOINT_CHILDREN)
                    
                    # Apply overall transform
                    bpts = apply_overall_transform(bpts, use_o_scale, use_o_rot, use_pos_x, use_pos_y, fcw, fch)
                    
                    # Get wrist positions (before visibility zeroing)
                    if bpts[4][2] > 0:
                        right_wrist = (bpts[4][0], bpts[4][1])
                    if bpts[7][2] > 0:
                        left_wrist = (bpts[7][0], bpts[7][1])
                    
                    # Render body (uses visibility for drawing)
                    render_body(combined_draw, bpts, fcw, fch, visibility=use_visibility)
                    render_body(body_draw, bpts, fcw, fch, visibility=use_visibility)
                    
                    # Apply visibility to keypoint DATA — zero out hidden parts
                    # so downstream nodes (compositor, ControlNet) respect visibility
                    body_part_kp_indices = {
                        "head": [0, 14, 15, 16, 17],
                        "torso": [1, 2, 5, 8, 11],
                        "left_arm": [5, 6, 7],
                        "right_arm": [2, 3, 4],
                        "left_leg": [11, 12, 13],
                        "right_leg": [8, 9, 10],
                    }
                    bpts_out = [[p[0], p[1], p[2]] for p in bpts]
                    for part_name, kp_indices in body_part_kp_indices.items():
                        if not use_visibility.get(part_name, True):
                            for ki in kp_indices:
                                if ki < len(bpts_out):
                                    bpts_out[ki] = [0.0, 0.0, 0.0]
                    
                    edited_person["pose_keypoints_2d"] = flatten_keypoints(bpts_out)
                
                # Process face
                # Determine face data source: separate face input overrides body's face data
                face_kp_source = None
                face_from_separate_cam = False
                if face_data is not None:
                    # Use separate face cam input — hold last frame if shorter
                    face_frame_idx = min(frame_idx, len(face_data) - 1)
                    face_frame = face_data[face_frame_idx]
                    if isinstance(face_frame, dict):
                        face_people = face_frame.get("people", [])
                        face_person = face_people[min(person_idx, len(face_people) - 1)] if face_people else None
                        if face_person and "face_keypoints_2d" in face_person and face_person["face_keypoints_2d"]:
                            face_kp_source = face_person["face_keypoints_2d"]
                            face_from_separate_cam = True
                
                # Fall back to body's face data if no separate input
                if face_kp_source is None and "face_keypoints_2d" in person and person["face_keypoints_2d"]:
                    face_kp_source = person["face_keypoints_2d"]
                
                if face_kp_source:
                    fpts = parse_keypoints(face_kp_source)
                    
                    # If face data comes from a separate camera, normalise it
                    # to be position/scale independent before attaching to head.
                    # The face cam landmarks are in a different pixel space
                    # (close-up face vs full body), so we centre them on their
                    # own nose and scale them to fit the body's head-neck distance.
                    if face_from_separate_cam and orig_bpts and bpts:
                        fpts = normalise_face_for_head_attach(fpts, bpts, fcw, fch)
                    
                    fpts = edit_face(fpts, use_face_params, fcw, fch)
                    
                    # Attach to head — face follows body head position/rotation
                    if orig_bpts and bpts:
                        head_w = use_body_params.get("head_width", 1.0)
                        head_h = use_body_params.get("head_height", 1.0)
                        fpts = attach_face_to_head(fpts, orig_bpts, bpts, fcw, fch, head_w, head_h, use_o_scale)
                    
                    face_visible = use_visibility.get("face", True)
                    
                    # Render face
                    render_face(combined_draw, fpts, fcw, fch, visible=face_visible)
                    render_face(face_hand_draw, fpts, fcw, fch, visible=face_visible)
                    
                    # Apply visibility to keypoint DATA
                    if face_visible:
                        edited_person["face_keypoints_2d"] = flatten_keypoints(fpts)
                    else:
                        edited_person["face_keypoints_2d"] = [0.0] * len(flatten_keypoints(fpts))
                
                # Process left hand
                if "hand_left_keypoints_2d" in person and person["hand_left_keypoints_2d"]:
                    hpts = parse_keypoints(person["hand_left_keypoints_2d"])
                    hpts = edit_hand(hpts, use_hand_params, fcw, fch, is_left=True)
                    hpts = apply_overall_transform(hpts, use_o_scale, use_o_rot, use_pos_x, use_pos_y, fcw, fch)
                    
                    if left_wrist:
                        hpts = attach_hand_to_wrist(hpts, left_wrist)
                    
                    hand_visible = use_visibility.get("left_hand", True)
                    
                    # Render hand
                    render_hand(combined_draw, hpts, fcw, fch, visible=hand_visible)
                    render_hand(face_hand_draw, hpts, fcw, fch, visible=hand_visible)
                    
                    # Apply visibility to keypoint DATA
                    if hand_visible:
                        edited_person["hand_left_keypoints_2d"] = flatten_keypoints(hpts)
                    else:
                        edited_person["hand_left_keypoints_2d"] = [0.0] * len(flatten_keypoints(hpts))
                
                # Process right hand
                if "hand_right_keypoints_2d" in person and person["hand_right_keypoints_2d"]:
                    hpts = parse_keypoints(person["hand_right_keypoints_2d"])
                    hpts = edit_hand(hpts, use_hand_params, fcw, fch, is_left=False)
                    hpts = apply_overall_transform(hpts, use_o_scale, use_o_rot, use_pos_x, use_pos_y, fcw, fch)
                    
                    if right_wrist:
                        hpts = attach_hand_to_wrist(hpts, right_wrist)
                    
                    hand_visible = use_visibility.get("right_hand", True)
                    
                    # Render hand
                    render_hand(combined_draw, hpts, fcw, fch, visible=hand_visible)
                    render_hand(face_hand_draw, hpts, fcw, fch, visible=hand_visible)
                    
                    # Apply visibility to keypoint DATA
                    if hand_visible:
                        edited_person["hand_right_keypoints_2d"] = flatten_keypoints(hpts)
                    else:
                        edited_person["hand_right_keypoints_2d"] = [0.0] * len(flatten_keypoints(hpts))
                
                edited_frame["people"].append(edited_person)
            
            output_poses.append(edited_frame)
            combined_images.append(pil_to_tensor(combined_img))
            body_images.append(pil_to_tensor(body_img))
            face_hand_images.append(pil_to_tensor(face_hand_img))
        
        # Stack tensors
        if combined_images:
            combined_batch = torch.cat(combined_images, dim=0)
            body_batch = torch.cat(body_images, dim=0)
            face_hand_batch = torch.cat(face_hand_images, dim=0)
        else:
            empty = pil_to_tensor(Image.new('RGB', (cw, ch), (0, 0, 0)))
            combined_batch = body_batch = face_hand_batch = empty
        
        # --- DEBUG: Log output details ---
        n_out = len(output_poses)
        n_people = sum(len(f.get("people", [])) for f in output_poses)
        has_edited_body = any(
            "pose_keypoints_2d" in p 
            for f in output_poses 
            for p in f.get("people", [])
        )
        print(f"[OpenPose Editor] OUTPUT: {n_out} frames, {n_people} total people, "
              f"has_body={has_edited_body}, "
              f"img_shape={combined_batch.shape}, "
              f"img_nonzero={torch.sum(combined_batch > 0).item()}")
        # Check first frame's first person keypoints sample
        if output_poses and output_poses[0].get("people"):
            p0 = output_poses[0]["people"][0]
            if "pose_keypoints_2d" in p0:
                kps = p0["pose_keypoints_2d"]
                print(f"[OpenPose Editor] Sample body kps (first 9): {kps[:9]}")
        # --- END DEBUG ---
        
        # Update all_frames with processed data so JS preview shows merged face/hand data
        ui_data["all_frames"] = [json.loads(json.dumps(f)) for f in output_poses if isinstance(f, dict)]
        
        final_result = {
            "ui": ui_data,
            "result": (output_poses, combined_batch, body_batch, face_hand_batch)
        }
        
        # Store in cache for fast re-run when nothing changed
        ComfyVFX_OpenPoseProportionalEditor._cache_hash = cache_hash
        ComfyVFX_OpenPoseProportionalEditor._cache_result = final_result
        
        return final_result


# =============================================================================
# NODE REGISTRATION
# =============================================================================

NODE_CLASS_MAPPINGS = {
    "ComfyVFX_OpenPoseProportionalEditor": ComfyVFX_OpenPoseProportionalEditor,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyVFX_OpenPoseProportionalEditor": "OpenPose Proportional Editor",
}
