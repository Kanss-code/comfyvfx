"""
ComfyVFX - Pose Proportion Nodes
Adjust body proportions on DWPose keypoints with live preview overlay.
Includes scheduling system for keyframe animation.
"""

import json
import os
import math
import numpy as np
import torch
from PIL import Image, ImageDraw
import folder_paths


# COCO 18 Keypoint indices
KEYPOINT_NAMES = {
    0: "nose", 1: "neck", 2: "right_shoulder", 3: "right_elbow", 4: "right_wrist",
    5: "left_shoulder", 6: "left_elbow", 7: "left_wrist", 8: "right_hip",
    9: "right_knee", 10: "right_ankle", 11: "left_hip", 12: "left_knee",
    13: "left_ankle", 14: "right_eye", 15: "left_eye", 16: "right_ear", 17: "left_ear",
}

# EXACT OpenPose COCO 18 colors
KEYPOINT_COLORS = {
    0: (255, 0, 0), 1: (255, 85, 0), 2: (255, 170, 0), 3: (255, 255, 0),
    4: (170, 255, 0), 5: (85, 255, 0), 6: (0, 255, 0), 7: (0, 255, 85),
    8: (0, 255, 170), 9: (0, 255, 255), 10: (0, 170, 255), 11: (0, 85, 255),
    12: (0, 0, 255), 13: (85, 0, 255), 14: (170, 0, 255), 15: (255, 0, 255),
    16: (255, 0, 170), 17: (255, 0, 85),
}

# Bone connections with 60% colors
BONE_CONNECTIONS = {
    (1, 2): (153, 0, 0), (1, 5): (153, 51, 0), (2, 3): (153, 102, 0), (3, 4): (153, 153, 0),
    (5, 6): (102, 153, 0), (6, 7): (51, 153, 0), (1, 8): (0, 153, 0), (8, 9): (0, 153, 51),
    (9, 10): (0, 153, 102), (1, 11): (0, 153, 153), (11, 12): (0, 102, 153), (12, 13): (0, 51, 153),
    (1, 0): (0, 0, 153), (0, 14): (51, 0, 153), (14, 16): (102, 0, 153),
    (0, 15): (153, 0, 153), (15, 17): (153, 0, 102),
}

# All parameter names
PARAM_NAMES = [
    "temporal_smoothing", "head_width", "head_height", "head_tilt",
    "neck_length", "shoulder_height", "collarbone_length",
    "arm_angle", "upper_arm_length", "forearm_length",
    "torso_length", "torso_tilt", "hip_width",
    "legs_angle", "upper_leg_length", "lower_leg_length",
    "overall_scale", "overall_rotate", "position_x", "position_y",
]

# Default values for each parameter
PARAM_DEFAULTS = {
    "temporal_smoothing": 0.0, "head_width": 1.0, "head_height": 1.0, "head_tilt": 0.0,
    "neck_length": 1.0, "shoulder_height": 0.0, "collarbone_length": 1.0,
    "arm_angle": 0.0, "upper_arm_length": 1.0, "forearm_length": 1.0,
    "torso_length": 1.0, "torso_tilt": 0.0, "hip_width": 1.0,
    "legs_angle": 0.0, "upper_leg_length": 1.0, "lower_leg_length": 1.0,
    "overall_scale": 1.0, "overall_rotate": 0.0, "position_x": 0.0, "position_y": 0.0,
}


def parse_keypoints(keypoints_2d):
    """Parse flat keypoint array into list of [x, y, confidence]."""
    points = []
    for i in range(0, len(keypoints_2d), 3):
        points.append([keypoints_2d[i], keypoints_2d[i + 1], keypoints_2d[i + 2]])
    return points


def flatten_keypoints(points):
    """Flatten list of [x, y, confidence] back to flat array."""
    flat = []
    for p in points:
        flat.extend([p[0], p[1], p[2]])
    return flat


def rotate_point_around_pivot(point, pivot, angle_degrees):
    """Rotate a point around a pivot by angle in degrees."""
    if point[2] == 0 or pivot[2] == 0:
        return point
    
    angle_rad = math.radians(angle_degrees)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)
    
    dx = point[0] - pivot[0]
    dy = point[1] - pivot[1]
    
    new_x = dx * cos_a - dy * sin_a
    new_y = dx * sin_a + dy * cos_a
    
    return [pivot[0] + new_x, pivot[1] + new_y, point[2]]


def interpolate_value(start, end, t, mode="linear"):
    """Interpolate between start and end based on t (0-1) and mode."""
    if mode == "linear":
        return start + (end - start) * t
    elif mode == "ease_in":
        return start + (end - start) * (t * t)
    elif mode == "ease_out":
        return start + (end - start) * (1 - (1 - t) * (1 - t))
    elif mode == "ease_in_out":
        if t < 0.5:
            return start + (end - start) * (2 * t * t)
        else:
            return start + (end - start) * (1 - pow(-2 * t + 2, 2) / 2)
    elif mode == "bounce":
        # Simple bounce effect
        return start + (end - start) * abs(math.sin(t * math.pi))
    elif mode == "sine":
        # Sine wave oscillation
        return start + (end - start) * (0.5 + 0.5 * math.sin(t * 2 * math.pi - math.pi/2))
    return start + (end - start) * t


def _apply_easing(t, mode="linear"):
    if mode == "ease_in":
        return t * t
    elif mode == "ease_out":
        return 1.0 - (1.0 - t) ** 2
    elif mode == "ease_in_out":
        return 2.0 * t * t if t < 0.5 else 1.0 - (-2.0 * t + 2.0) ** 2 / 2.0
    return t


def interpolate_param_keyframes(keyframes, total_frames, param_names, defaults):
    """Interpolate parameter values across frames from keyframes."""
    if not keyframes or total_frames <= 0:
        return [dict(defaults) for _ in range(max(1, total_frames))]

    kfs = sorted(keyframes, key=lambda k: k.get("frame", 0))

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

    result = []
    for f in range(total_frames):
        kf_before, kf_after = kfs[0], kfs[-1]
        for i in range(len(kfs) - 1):
            if kfs[i]["frame"] <= f <= kfs[i + 1]["frame"]:
                kf_before, kf_after = kfs[i], kfs[i + 1]
                break

        fs, fe = kf_before.get("frame", 0), kf_after.get("frame", 0)
        t = 0.0 if fe == fs else (f - fs) / (fe - fs)
        t = _apply_easing(t, kf_before.get("easing", "linear"))

        frame_vals = {}
        for p in param_names:
            a = kf_before.get(p, defaults.get(p, 0.0))
            b = kf_after.get(p, defaults.get(p, 0.0))
            frame_vals[p] = a + (b - a) * t
        result.append(frame_vals)

    return result


def apply_perspective_rotate(points, angle, canvas_width, canvas_height):
    """
    Apply fake 3D perspective rotation around vertical axis.
    Simulates the figure turning left/right by scaling and shifting.
    angle: -90 to 90 degrees (negative = turn left, positive = turn right)
    """
    if angle == 0 or not points:
        return points
    
    points = [p.copy() for p in points]
    
    # Find center of skeleton
    valid_points = [p for p in points if p[2] > 0]
    if not valid_points:
        return points
    
    # Check if normalized
    sample_coords = [p[0] for p in valid_points] + [p[1] for p in valid_points]
    max_coord = max(sample_coords) if sample_coords else 1.0
    is_normalized = max_coord <= 1.0
    
    if is_normalized:
        center_x = sum(p[0] for p in valid_points) / len(valid_points)
        width = 1.0
    else:
        center_x = sum(p[0] for p in valid_points) / len(valid_points)
        width = canvas_width
    
    # Convert angle to radians and calculate perspective factor
    angle_rad = math.radians(angle)
    cos_angle = math.cos(angle_rad)
    
    # Left side indices (from viewer's perspective): 5,6,7 (left arm), 11,12,13 (left leg), 15,17 (left face)
    # Right side indices: 2,3,4 (right arm), 8,9,10 (right leg), 14,16 (right face)
    # Center: 0 (nose), 1 (neck)
    
    left_indices = [5, 6, 7, 11, 12, 13, 15, 17]
    right_indices = [2, 3, 4, 8, 9, 10, 14, 16]
    center_indices = [0, 1]
    
    for idx, p in enumerate(points):
        if p[2] == 0:
            continue
        
        # Distance from center (normalized to -1 to 1)
        dx = (p[0] - center_x) / (width * 0.5) if width > 0 else 0
        
        # Apply perspective compression based on angle
        # When turning right (positive angle), left side compresses and moves toward center
        # When turning left (negative angle), right side compresses and moves toward center
        
        if idx in left_indices:
            # Left side of body
            if angle > 0:  # Turning right - left side goes "back"
                scale = max(0.3, cos_angle)
                shift = (1 - cos_angle) * 0.3 * width
                p[0] = center_x + (p[0] - center_x) * scale + shift
            else:  # Turning left - left side comes "forward"
                scale = 1.0 + (1 - cos_angle) * 0.2
                shift = -(1 - cos_angle) * 0.15 * width
                p[0] = center_x + (p[0] - center_x) * scale + shift
                
        elif idx in right_indices:
            # Right side of body
            if angle > 0:  # Turning right - right side comes "forward"
                scale = 1.0 + (1 - cos_angle) * 0.2
                shift = (1 - cos_angle) * 0.15 * width
                p[0] = center_x + (p[0] - center_x) * scale + shift
            else:  # Turning left - right side goes "back"
                scale = max(0.3, cos_angle)
                shift = -(1 - cos_angle) * 0.3 * width
                p[0] = center_x + (p[0] - center_x) * scale + shift
        
        elif idx in center_indices:
            # Center points (nose, neck) - slight shift based on rotation
            shift = math.sin(angle_rad) * 0.1 * width
            p[0] = p[0] + shift
    
    return points


def apply_proportions(points, params, canvas_width=1.0, canvas_height=1.0):
    """Apply all proportion and rotation adjustments to keypoints."""
    
    points = [p.copy() for p in points]
    
    head_width = params.get('head_width', 1.0)
    head_height = params.get('head_height', 1.0)
    neck_length = params.get('neck_length', 1.0)
    shoulder_height = params.get('shoulder_height', 0.0)
    collarbone_length = params.get('collarbone_length', 1.0)
    upper_arm_length = params.get('upper_arm_length', 1.0)
    forearm_length = params.get('forearm_length', 1.0)
    torso_length = params.get('torso_length', 1.0)
    hip_width = params.get('hip_width', 1.0)
    upper_leg_length = params.get('upper_leg_length', 1.0)
    lower_leg_length = params.get('lower_leg_length', 1.0)
    legs_angle = params.get('legs_angle', 0.0)
    arm_angle = params.get('arm_angle', 0.0)
    head_tilt = params.get('head_tilt', 0.0)
    torso_tilt = params.get('torso_tilt', 0.0)
    
    def scale_from(anchor_idx, target_idx, scale, children=None):
        if points[anchor_idx][2] == 0 or points[target_idx][2] == 0:
            return
        
        anchor = np.array(points[anchor_idx][:2])
        target = np.array(points[target_idx][:2])
        vec = target - anchor
        new_pos = anchor + vec * scale
        offset = new_pos - target
        
        points[target_idx][0] = new_pos[0]
        points[target_idx][1] = new_pos[1]
        
        if children:
            for child_idx in children:
                if points[child_idx][2] > 0:
                    points[child_idx][0] += offset[0]
                    points[child_idx][1] += offset[1]
    
    # Store original ankle positions for Y-axis anchoring
    right_ankle_orig_y = points[10][1] if points[10][2] > 0 else None
    left_ankle_orig_y = points[13][1] if points[13][2] > 0 else None
    anchor_y = right_ankle_orig_y if right_ankle_orig_y is not None else left_ankle_orig_y
    
    # === HEAD ===
    if head_width != 1.0 or head_height != 1.0:
        if points[0][2] > 0:
            nose = np.array(points[0][:2])
            for idx in [14, 15, 16, 17]:
                if points[idx][2] > 0:
                    pt = np.array(points[idx][:2])
                    points[idx][0] = nose[0] + (pt[0] - nose[0]) * head_width
                    points[idx][1] = nose[1] + (pt[1] - nose[1]) * head_height
    
    if head_tilt != 0.0 and points[1][2] > 0:
        neck = points[1]
        for idx in [0, 14, 15, 16, 17]:
            if points[idx][2] > 0:
                points[idx] = rotate_point_around_pivot(points[idx], neck, head_tilt)
    
    # === NECK ===
    if neck_length != 1.0:
        scale_from(1, 0, neck_length, children=[14, 15, 16, 17])
    
    # === SHOULDERS ===
    if shoulder_height != 0.0:
        sample_coords = [p[1] for p in points if p[2] > 0]
        is_normalized = max(sample_coords) <= 1.0 if sample_coords else True
        
        if is_normalized:
            v_offset = shoulder_height * 0.1
        else:
            v_offset = shoulder_height * (canvas_height * 0.1)
        
        for idx in [2, 3, 4, 5, 6, 7]:
            if points[idx][2] > 0:
                points[idx][1] += v_offset
    
    if collarbone_length != 1.0:
        scale_from(1, 2, collarbone_length, children=[3, 4])
        scale_from(1, 5, collarbone_length, children=[6, 7])
    
    # === ARMS ===
    if arm_angle != 0.0:
        if points[2][2] > 0:
            for idx in [3, 4]:
                if points[idx][2] > 0:
                    points[idx] = rotate_point_around_pivot(points[idx], points[2], arm_angle)
        if points[5][2] > 0:
            for idx in [6, 7]:
                if points[idx][2] > 0:
                    points[idx] = rotate_point_around_pivot(points[idx], points[5], -arm_angle)
    
    if upper_arm_length != 1.0:
        scale_from(2, 3, upper_arm_length, children=[4])
        scale_from(5, 6, upper_arm_length, children=[7])
    
    if forearm_length != 1.0:
        scale_from(3, 4, forearm_length)
        scale_from(6, 7, forearm_length)
    
    # === TORSO ===
    if torso_tilt != 0.0:
        if points[8][2] > 0 and points[11][2] > 0:
            hip_center = [(points[8][0] + points[11][0]) / 2, (points[8][1] + points[11][1]) / 2, 1.0]
        elif points[8][2] > 0:
            hip_center = points[8]
        elif points[11][2] > 0:
            hip_center = points[11]
        else:
            hip_center = None
        
        if hip_center:
            upper_body_indices = [0, 1, 2, 3, 4, 5, 6, 7, 14, 15, 16, 17]
            for idx in upper_body_indices:
                if points[idx][2] > 0:
                    points[idx] = rotate_point_around_pivot(points[idx], hip_center, torso_tilt)
    
    if torso_length != 1.0:
        scale_from(1, 8, torso_length, children=[9, 10])
        scale_from(1, 11, torso_length, children=[12, 13])
    
    # === HIPS ===
    if hip_width != 1.0 and points[8][2] > 0 and points[11][2] > 0:
        hip_center_x = (points[8][0] + points[11][0]) / 2
        
        dx = points[8][0] - hip_center_x
        points[8][0] = hip_center_x + dx * hip_width
        if points[9][2] > 0:
            points[9][0] += dx * (hip_width - 1)
        if points[10][2] > 0:
            points[10][0] += dx * (hip_width - 1)
        
        dx = points[11][0] - hip_center_x
        points[11][0] = hip_center_x + dx * hip_width
        if points[12][2] > 0:
            points[12][0] += dx * (hip_width - 1)
        if points[13][2] > 0:
            points[13][0] += dx * (hip_width - 1)
    
    # === LEGS ===
    if legs_angle != 0.0:
        if points[8][2] > 0:
            for idx in [9, 10]:
                if points[idx][2] > 0:
                    points[idx] = rotate_point_around_pivot(points[idx], points[8], legs_angle)
        if points[11][2] > 0:
            for idx in [12, 13]:
                if points[idx][2] > 0:
                    points[idx] = rotate_point_around_pivot(points[idx], points[11], -legs_angle)
    
    if upper_leg_length != 1.0:
        scale_from(8, 9, upper_leg_length, children=[10])
        scale_from(11, 12, upper_leg_length, children=[13])
    
    if lower_leg_length != 1.0:
        scale_from(9, 10, lower_leg_length)
        scale_from(12, 13, lower_leg_length)
    
    # === ANCHOR FROM FEET (Y-axis) ===
    if anchor_y is not None:
        current_ankle_y = None
        if points[10][2] > 0:
            current_ankle_y = points[10][1]
        elif points[13][2] > 0:
            current_ankle_y = points[13][1]
        
        if current_ankle_y is not None:
            drift_y = current_ankle_y - anchor_y
            if abs(drift_y) > 0.0001:
                for p in points:
                    if p[2] > 0:
                        p[1] -= drift_y
    
    return points


def apply_transform(points, overall_scale, overall_rotate, position_x, position_y, canvas_width, canvas_height):
    """Apply overall scale, rotation, and position offset to all keypoints."""
    
    points = [p.copy() for p in points]
    
    valid_points = [(p[0], p[1]) for p in points if p[2] > 0]
    if not valid_points:
        return points
    
    center_x = sum(p[0] for p in valid_points) / len(valid_points)
    center_y = sum(p[1] for p in valid_points) / len(valid_points)
    
    max_coord = max(max(p[0], p[1]) for p in valid_points)
    is_normalized = max_coord <= 1.0
    
    if is_normalized:
        offset_x = position_x
        offset_y = position_y
    else:
        offset_x = position_x * canvas_width
        offset_y = position_y * canvas_height
    
    # Apply rotation around center first
    if overall_rotate != 0.0:
        angle_rad = math.radians(overall_rotate)
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)
        
        for p in points:
            if p[2] > 0:
                dx = p[0] - center_x
                dy = p[1] - center_y
                p[0] = center_x + dx * cos_a - dy * sin_a
                p[1] = center_y + dx * sin_a + dy * cos_a
    
    # Recalculate center after rotation
    valid_points = [(p[0], p[1]) for p in points if p[2] > 0]
    if valid_points:
        center_x = sum(p[0] for p in valid_points) / len(valid_points)
        center_y = sum(p[1] for p in valid_points) / len(valid_points)
    
    # Apply scale and position
    for p in points:
        if p[2] > 0:
            p[0] = center_x + (p[0] - center_x) * overall_scale + offset_x
            p[1] = center_y + (p[1] - center_y) * overall_scale + offset_y
    
    return points


def apply_temporal_smoothing(pose_list, smoothing_strength):
    """Apply temporal smoothing across frames to reduce jitter."""
    if smoothing_strength <= 0.0 or not isinstance(pose_list, list) or len(pose_list) < 2:
        return pose_list
    
    window_size = max(1, int(smoothing_strength * 5))
    smoothed_list = []
    
    for frame_idx, pose_data in enumerate(pose_list):
        smoothed_pose = json.loads(json.dumps(pose_data))
        
        for person_idx, person in enumerate(smoothed_pose.get("people", [])):
            if "pose_keypoints_2d" not in person:
                continue
            
            points = parse_keypoints(person["pose_keypoints_2d"])
            
            for kp_idx in range(len(points)):
                if points[kp_idx][2] == 0:
                    continue
                
                sum_x, sum_y, sum_weight = 0.0, 0.0, 0.0
                
                for offset in range(-window_size, window_size + 1):
                    neighbor_idx = frame_idx + offset
                    if neighbor_idx < 0 or neighbor_idx >= len(pose_list):
                        continue
                    
                    neighbor_pose = pose_list[neighbor_idx]
                    if person_idx >= len(neighbor_pose.get("people", [])):
                        continue
                    
                    neighbor_person = neighbor_pose["people"][person_idx]
                    if "pose_keypoints_2d" not in neighbor_person:
                        continue
                    
                    neighbor_points = parse_keypoints(neighbor_person["pose_keypoints_2d"])
                    if kp_idx >= len(neighbor_points) or neighbor_points[kp_idx][2] == 0:
                        continue
                    
                    distance = abs(offset)
                    weight = math.exp(-distance * distance / (2.0 * (window_size / 2.0 + 0.5) ** 2))
                    weight *= neighbor_points[kp_idx][2]
                    
                    sum_x += neighbor_points[kp_idx][0] * weight
                    sum_y += neighbor_points[kp_idx][1] * weight
                    sum_weight += weight
                
                if sum_weight > 0:
                    smoothed_x = sum_x / sum_weight
                    smoothed_y = sum_y / sum_weight
                    points[kp_idx][0] = points[kp_idx][0] * (1 - smoothing_strength) + smoothed_x * smoothing_strength
                    points[kp_idx][1] = points[kp_idx][1] * (1 - smoothing_strength) + smoothed_y * smoothing_strength
            
            person["pose_keypoints_2d"] = flatten_keypoints(points)
        
        smoothed_list.append(smoothed_pose)
    
    return smoothed_list


def render_pose_image_from_pose(pose_data, width, height, line_width=4, point_radius=5, visibility=None):
    """Render a pose dict to PIL Image with exact OpenPose colors.
    
    Args:
        visibility: Dict of {part_name: bool} to control which body parts are rendered.
                   Parts: head, torso, left_arm, right_arm, left_leg, right_leg
    """
    image = Image.new('RGB', (width, height), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # Define which keypoints belong to which body part
    # OpenPose keypoints: 0=nose, 1=neck, 2=Rshoulder, 3=Relbow, 4=Rwrist,
    # 5=Lshoulder, 6=Lelbow, 7=Lwrist, 8=Rhip, 9=Rknee, 10=Rankle,
    # 11=Lhip, 12=Lknee, 13=Lankle, 14=Reye, 15=Leye, 16=Rear, 17=Lear
    PART_KEYPOINTS = {
        "head": {0, 14, 15, 16, 17},
        "torso": {1, 8, 11},  # neck and hips
        "left_arm": {5, 6, 7},
        "right_arm": {2, 3, 4},
        "left_leg": {12, 13},  # knee and ankle (hip is part of torso)
        "right_leg": {9, 10},  # knee and ankle (hip is part of torso)
    }
    
    # Define which bones belong to which body part
    PART_BONES = {
        "head": {(1, 0), (0, 14), (14, 16), (0, 15), (15, 17)},
        "torso": {(1, 8), (1, 11), (1, 2), (1, 5)},  # neck to hips AND neck to shoulders
        "left_arm": {(5, 6), (6, 7)},  # shoulder to elbow, elbow to wrist
        "right_arm": {(2, 3), (3, 4)},  # shoulder to elbow, elbow to wrist
        "left_leg": {(11, 12), (12, 13)},  # hip to knee, knee to ankle
        "right_leg": {(8, 9), (9, 10)},  # hip to knee, knee to ankle
    }
    
    # Build sets of visible keypoints and bones
    visible_keypoints = set()
    visible_bones = set()
    
    if visibility is None:
        # All visible by default
        for indices in PART_KEYPOINTS.values():
            visible_keypoints.update(indices)
        for bones in PART_BONES.values():
            visible_bones.update(bones)
    else:
        for part_name, indices in PART_KEYPOINTS.items():
            if visibility.get(part_name, True):
                visible_keypoints.update(indices)
        for part_name, bones in PART_BONES.items():
            if visibility.get(part_name, True):
                visible_bones.update(bones)
    
    for person in pose_data.get("people", []):
        if "pose_keypoints_2d" not in person:
            continue
        
        points = parse_keypoints(person["pose_keypoints_2d"])
        
        sample_coords = [p[0] for p in points if p[2] > 0] + [p[1] for p in points if p[2] > 0]
        is_normalized = bool(sample_coords and max(sample_coords) <= 1.0)
        if is_normalized:
            for p in points:
                p[0] = p[0] * width
                p[1] = p[1] * height
        
        for (start_idx, end_idx), color in BONE_CONNECTIONS.items():
            # Check if this bone is visible
            if (start_idx, end_idx) not in visible_bones and (end_idx, start_idx) not in visible_bones:
                continue
            if start_idx < len(points) and end_idx < len(points):
                p1, p2 = points[start_idx], points[end_idx]
                if p1[2] > 0 and p2[2] > 0:
                    draw.line([(p1[0], p1[1]), (p2[0], p2[1])], fill=color, width=line_width)
        
        for idx, point in enumerate(points):
            # Check if this keypoint is visible
            if idx not in visible_keypoints:
                continue
            if point[2] > 0 and idx < 18:
                x, y = point[0], point[1]
                color = KEYPOINT_COLORS.get(idx, (255, 255, 255))
                draw.ellipse([x - point_radius, y - point_radius,
                             x + point_radius, y + point_radius], fill=color)
        
        # Draw face landmarks: white dots only, no connections
        if "face_keypoints_2d" in person:
            face_pts = parse_keypoints(person["face_keypoints_2d"])
            face_pr = max(1, point_radius * 2 // 3)
            for fp in face_pts:
                if fp[2] <= 0:
                    continue
                fx = fp[0] * width if is_normalized else fp[0]
                fy = fp[1] * height if is_normalized else fp[1]
                draw.ellipse([fx - face_pr, fy - face_pr, fx + face_pr, fy + face_pr],
                             fill=(255, 255, 255))
    
    return image


def pil_to_tensor(image):
    """Convert PIL Image to ComfyUI tensor [B, H, W, C]."""
    np_image = np.array(image).astype(np.float32) / 255.0
    return torch.from_numpy(np_image)[None,]


# Keypoint hierarchy for manual joint transforms
KEYPOINT_CHILDREN = {
    0: [14, 15, 16, 17],  # Nose -> eyes, ears
    1: [0, 2, 5, 8, 11, 14, 15, 16, 17],  # Neck -> everything above hips
    2: [3, 4],  # Right shoulder -> elbow, wrist
    3: [4],     # Right elbow -> wrist
    5: [6, 7],  # Left shoulder -> elbow, wrist
    6: [7],     # Left elbow -> wrist
    8: [9, 10], # Right hip -> knee, ankle
    9: [10],    # Right knee -> ankle
    11: [12, 13], # Left hip -> knee, ankle
    12: [13],   # Left knee -> ankle
}


def find_parent_joint(joint_idx):
    """Find parent joint index for a given joint."""
    for parent, children in KEYPOINT_CHILDREN.items():
        if joint_idx in children:
            return parent
    return -1


def apply_manual_joint_transforms(points, transforms, canvas_width, canvas_height):
    """
    Apply manual joint transforms (move/rotate/scale) from interactive editing.
    
    Args:
        points: List of [x, y, confidence] keypoints
        transforms: Dict of {joint_idx: {move: {x, y}, rotate: angle, scale: factor}}
        canvas_width, canvas_height: Canvas dimensions
    
    Returns:
        Modified points list
    """
    if not points or len(points) < 18 or not transforms:
        return points
    
    # Deep copy points
    points = [p.copy() for p in points]
    
    # Process transforms in hierarchical order (parents first)
    process_order = [1, 0, 2, 5, 8, 11, 3, 6, 9, 12, 4, 7, 10, 13, 14, 15, 16, 17]
    
    for joint_idx in process_order:
        # Joint index might be stored as string in JSON
        transform = transforms.get(str(joint_idx)) or transforms.get(joint_idx)
        if not transform:
            continue
        
        point = points[joint_idx]
        if point[2] == 0:
            continue
        
        # Find parent joint for rotation pivot
        parent_idx = find_parent_joint(joint_idx)
        if parent_idx >= 0 and points[parent_idx][2] > 0:
            pivot = points[parent_idx]
        else:
            pivot = point
        
        # Get children that should move/rotate/scale with this joint
        children = KEYPOINT_CHILDREN.get(joint_idx, [])
        affected_joints = [joint_idx] + children
        
        # Apply move transform
        move = transform.get('move', {})
        move_x = move.get('x', 0)
        move_y = move.get('y', 0)
        if move_x != 0 or move_y != 0:
            for idx in affected_joints:
                if idx < len(points) and points[idx][2] > 0:
                    points[idx][0] += move_x
                    points[idx][1] += move_y
        
        # Apply rotation transform around pivot
        rotate_angle = transform.get('rotate', 0)
        if rotate_angle != 0:
            angle_rad = math.radians(rotate_angle)
            cos_a = math.cos(angle_rad)
            sin_a = math.sin(angle_rad)
            
            for idx in affected_joints:
                if idx < len(points) and points[idx][2] > 0:
                    dx = points[idx][0] - pivot[0]
                    dy = points[idx][1] - pivot[1]
                    points[idx][0] = pivot[0] + dx * cos_a - dy * sin_a
                    points[idx][1] = pivot[1] + dx * sin_a + dy * cos_a
        
        # Apply scale transform from this joint
        scale_factor = transform.get('scale', 1.0)
        if scale_factor != 1.0:
            for idx in affected_joints:
                if idx == joint_idx:
                    continue  # Don't scale the pivot joint itself
                if idx < len(points) and points[idx][2] > 0:
                    dx = points[idx][0] - point[0]
                    dy = points[idx][1] - point[1]
                    points[idx][0] = point[0] + dx * scale_factor
                    points[idx][1] = point[1] + dy * scale_factor
    
    return points


# =============================================================================
# MAIN PROPORTION EDITOR NODE
# =============================================================================

class ComfyVFX_PoseEditor:
    """
    Main pose proportion editor with sliders and optional schedule hub input.
    Connect Schedule Hub for animation, or just use sliders for static adjustments.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # === SMOOTHING ===
                "temporal_smoothing": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05, "display": "slider"}),
                # === HEAD ===
                "head_width": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                "head_height": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                "head_tilt": ("FLOAT", {"default": 0.0, "min": -45.0, "max": 45.0, "step": 1.0, "display": "slider"}),
                # === NECK ===
                "neck_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                # === SHOULDERS ===
                "shoulder_height": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.02, "display": "slider"}),
                "collarbone_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                # === ARMS ===
                "arm_angle": ("FLOAT", {"default": 0.0, "min": -90.0, "max": 90.0, "step": 1.0, "display": "slider"}),
                "upper_arm_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                "forearm_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                # === TORSO ===
                "torso_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                "torso_tilt": ("FLOAT", {"default": 0.0, "min": -45.0, "max": 45.0, "step": 1.0, "display": "slider"}),
                # === HIPS ===
                "hip_width": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                # === LEGS ===
                "legs_angle": ("FLOAT", {"default": 0.0, "min": -45.0, "max": 45.0, "step": 1.0, "display": "slider"}),
                "upper_leg_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                "lower_leg_length": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 3.0, "step": 0.05, "display": "slider"}),
                # === TRANSFORM ===
                "overall_scale": ("FLOAT", {"default": 1.0, "min": 0.25, "max": 3.0, "step": 0.05, "display": "slider"}),
                "overall_rotate": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0, "display": "slider"}),
                "position_x": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01, "display": "slider"}),
                "position_y": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01, "display": "slider"}),
            },
            "optional": {
                "pose_keypoint": ("POSE_KEYPOINT",),
                "reference_image": ("IMAGE",),
                "param_keyframes": ("STRING", {
                    "default": "[]",
                    "tooltip": "JSON array of parameter keyframes from timeline (managed by JS frontend)"}),
                "joint_transforms": ("STRING", {"default": "{}"}),
                "visible_parts": ("STRING", {"default": "{}"}),
                "character_selection": ("STRING", {"default": "{}"}),
            },
            "hidden": {
                "node_id": "UNIQUE_ID",
            }
        }
    
    RETURN_TYPES = ("POSE_KEYPOINT", "IMAGE")
    RETURN_NAMES = ("pose_keypoint", "rendered_pose")
    FUNCTION = "process"
    CATEGORY = "ComfyVFX/pose"
    OUTPUT_NODE = True
    
    def process(self, temporal_smoothing, head_width, head_height, head_tilt,
                neck_length, shoulder_height, collarbone_length,
                arm_angle, upper_arm_length, forearm_length,
                torso_length, torso_tilt, hip_width,
                legs_angle, upper_leg_length, lower_leg_length,
                overall_scale, overall_rotate, position_x, position_y,
                pose_keypoint=None, reference_image=None, param_keyframes="[]", 
                joint_transforms="{}", visible_parts="{}", character_selection="{}", node_id=None):
        
        # Parse joint transforms from JSON string
        try:
            manual_transforms = json.loads(joint_transforms) if joint_transforms else {}
            if manual_transforms:
                print(f"[PoseEditor] Received joint transforms: {list(manual_transforms.keys())}")
        except Exception as e:
            print(f"[PoseEditor] Error parsing joint_transforms: {e}")
            manual_transforms = {}
        
        # Parse visible parts from JSON string
        try:
            visibility = json.loads(visible_parts) if visible_parts else {}
        except:
            visibility = {}
        # Default all parts to visible if not specified
        default_visibility = {"head": True, "torso": True, "left_arm": True, "right_arm": True, "left_leg": True, "right_leg": True}
        for part in default_visibility:
            if part not in visibility:
                visibility[part] = default_visibility[part]
        
        # Parse character selection - which characters to include and their individual settings
        # Format: { "enabled": {0: true, 1: false, ...}, "editingIdx": 0, "perChar": {0: {params}, 1: {params}} }
        try:
            char_sel = json.loads(character_selection) if character_selection else {}
        except:
            char_sel = {}
        char_enabled = char_sel.get("enabled", {})
        char_params = char_sel.get("perChar", {})
        
        # Slider values as defaults
        slider_values = {
            "temporal_smoothing": temporal_smoothing,
            "head_width": head_width, "head_height": head_height, "head_tilt": head_tilt,
            "neck_length": neck_length, "shoulder_height": shoulder_height,
            "collarbone_length": collarbone_length, "arm_angle": arm_angle,
            "upper_arm_length": upper_arm_length, "forearm_length": forearm_length,
            "torso_length": torso_length, "torso_tilt": torso_tilt,
            "hip_width": hip_width, "legs_angle": legs_angle,
            "upper_leg_length": upper_leg_length, "lower_leg_length": lower_leg_length,
            "overall_scale": overall_scale, "overall_rotate": overall_rotate,
            "position_x": position_x, "position_y": position_y,
        }
        
        # Save reference image
        reference_filename = None
        ref_width, ref_height = 512, 512
        if reference_image is not None:
            try:
                temp_dir = folder_paths.get_temp_directory()
                if reference_image.dim() == 4:
                    img_array = (reference_image[0].cpu().numpy() * 255).astype(np.uint8)
                else:
                    img_array = (reference_image.cpu().numpy() * 255).astype(np.uint8)
                pil_image = Image.fromarray(img_array)
                ref_width, ref_height = pil_image.size
                
                reference_filename = f"openpose_ref_{node_id}.png"
                filepath = os.path.join(temp_dir, reference_filename)
                pil_image.save(filepath)
            except Exception as e:
                print(f"[OpenPoseProportionEditor] Error saving reference image: {e}")
        
        # Get first frame for preview
        first_frame = None
        canvas_width, canvas_height = ref_width, ref_height
        
        if pose_keypoint is not None:
            if isinstance(pose_keypoint, list) and len(pose_keypoint) > 0:
                first_frame = pose_keypoint[0]
            elif isinstance(pose_keypoint, dict):
                first_frame = pose_keypoint
            
            if first_frame:
                canvas_width = first_frame.get("canvas_width", ref_width)
                canvas_height = first_frame.get("canvas_height", ref_height)
        
        # Build UI data
        ui_data = {
            "reference_image": [{"filename": reference_filename, "subfolder": "", "type": "temp"}] if reference_filename else [],
            "canvas_info": [{"width": canvas_width, "height": canvas_height}],
            "first_frame_keypoints": [json.loads(json.dumps(first_frame))] if first_frame else [],
            "all_frames": [],
        }
        
        # Collect all frames for animation preview
        if pose_keypoint is not None:
            if isinstance(pose_keypoint, list):
                ui_data["all_frames"] = [json.loads(json.dumps(f)) for f in pose_keypoint if isinstance(f, dict)]
            elif isinstance(pose_keypoint, dict):
                ui_data["all_frames"] = [json.loads(json.dumps(pose_keypoint))]
        
        if pose_keypoint is None:
            empty_pose = {"people": [], "canvas_width": canvas_width, "canvas_height": canvas_height}
            empty_image = Image.new('RGB', (canvas_width, canvas_height), (0, 0, 0))
            return {"ui": ui_data, "result": (empty_pose, pil_to_tensor(empty_image))}
        
        # Process poses
        if isinstance(pose_keypoint, list):
            if len(pose_keypoint) == 0:
                empty_pose = {"people": [], "canvas_width": canvas_width, "canvas_height": canvas_height}
                empty_image = Image.new('RGB', (canvas_width, canvas_height), (0, 0, 0))
                return {"ui": ui_data, "result": (empty_pose, pil_to_tensor(empty_image))}
            
            # Parse parameter keyframes
            try:
                param_kf_raw = json.loads(param_keyframes) if param_keyframes else []
            except Exception:
                param_kf_raw = []
            
            total_frames = len(pose_keypoint)
            if param_kf_raw and total_frames > 0:
                kf_all_values = interpolate_param_keyframes(
                    param_kf_raw, total_frames, PARAM_NAMES, PARAM_DEFAULTS)
            else:
                kf_all_values = None
            
            # Apply temporal smoothing first
            smoothing_val = temporal_smoothing
            if kf_all_values:
                smoothing_val = kf_all_values[0].get("temporal_smoothing", temporal_smoothing)
            if smoothing_val > 0:
                pose_keypoint = apply_temporal_smoothing(pose_keypoint, smoothing_val)
            
            output_poses = []
            rendered_images = []
            
            for frame_idx, pose_data in enumerate(pose_keypoint):
                if isinstance(pose_data, dict):
                    # Get per-frame parameter values from keyframes or sliders
                    if kf_all_values and frame_idx < len(kf_all_values):
                        frame_params = {k: kf_all_values[frame_idx].get(k, slider_values[k])
                                        for k in PARAM_NAMES if k != "temporal_smoothing"}
                    else:
                        frame_params = {k: v for k, v in slider_values.items() if k != "temporal_smoothing"}
                    
                    processed = self._process_single_pose(pose_data, frame_params, canvas_width, canvas_height, manual_transforms, char_enabled, char_params)
                    output_poses.append(processed)
                    
                    rendered = render_pose_image_from_pose(processed, canvas_width, canvas_height, visibility=visibility)
                    rendered_images.append(pil_to_tensor(rendered))
                else:
                    output_poses.append(pose_data)
            
            if rendered_images:
                batch_tensor = torch.cat(rendered_images, dim=0)
            else:
                empty_image = Image.new('RGB', (canvas_width, canvas_height), (0, 0, 0))
                batch_tensor = pil_to_tensor(empty_image)
            
            return {"ui": ui_data, "result": (output_poses, batch_tensor)}
        
        elif isinstance(pose_keypoint, dict):
            frame_params = {k: v for k, v in slider_values.items() if k != "temporal_smoothing"}
            output_pose = self._process_single_pose(pose_keypoint, frame_params, canvas_width, canvas_height, manual_transforms, char_enabled, char_params)
            rendered = render_pose_image_from_pose(output_pose, canvas_width, canvas_height, visibility=visibility)
            return {"ui": ui_data, "result": (output_pose, pil_to_tensor(rendered))}
        
        else:
            empty_image = Image.new('RGB', (canvas_width, canvas_height), (0, 0, 0))
            return {"ui": ui_data, "result": (pose_keypoint, pil_to_tensor(empty_image))}
    
    def _process_single_pose(self, pose_data, params, canvas_width, canvas_height, manual_transforms=None, char_enabled=None, char_params=None):
        """Process a single pose dict with given parameters and manual joint transforms."""
        output_pose = json.loads(json.dumps(pose_data))
        
        if char_enabled is None:
            char_enabled = {}
        if char_params is None:
            char_params = {}
        
        new_people = []
        for person_idx, person in enumerate(output_pose.get("people", [])):
            # Check if this character is enabled (default True)
            idx_str = str(person_idx)
            is_enabled = char_enabled.get(idx_str, char_enabled.get(person_idx, True))
            if not is_enabled:
                continue  # Skip this character
            
            if "pose_keypoints_2d" not in person:
                new_people.append(person)
                continue
            
            # Use per-character params if available, otherwise use global params
            use_params = params.copy()
            if idx_str in char_params:
                use_params.update(char_params[idx_str])
            elif person_idx in char_params:
                use_params.update(char_params[person_idx])
            
            points = parse_keypoints(person["pose_keypoints_2d"])
            
            # Store original positions for face anchor tracking
            orig_nose = [points[0][0], points[0][1]] if points[0][2] > 0 else None
            orig_anchors = {}
            for aidx in [0, 14, 15, 16, 17]:
                if points[aidx][2] > 0:
                    orig_anchors[aidx] = [points[aidx][0], points[aidx][1]]
            
            adjusted = apply_proportions(points, use_params, canvas_width, canvas_height)
            
            # Apply manual joint transforms (move/rotate/scale from interactive editing)
            if manual_transforms:
                adjusted = apply_manual_joint_transforms(adjusted, manual_transforms, canvas_width, canvas_height)
            
            canvas_w = output_pose.get("canvas_width", canvas_width)
            canvas_h = output_pose.get("canvas_height", canvas_height)
            adjusted = apply_transform(
                adjusted,
                use_params.get('overall_scale', 1.0),
                use_params.get('overall_rotate', 0.0),
                use_params.get('position_x', 0.0),
                use_params.get('position_y', 0.0),
                canvas_w, canvas_h
            )
            
            person["pose_keypoints_2d"] = flatten_keypoints(adjusted)
            
            # ---- Face keypoints: anchor-based tracking to body keypoints ----
            if "face_keypoints_2d" in person and orig_nose is not None:
                face_pts = parse_keypoints(person["face_keypoints_2d"])
                
                # Face index → body keypoint anchor mapping
                # Right eye (36-41,68) + right eyebrow (17-21) → body right eye (14)
                # Left eye (42-47,69) + left eyebrow (22-26) → body left eye (15)
                # Right jaw (0-7) → body right ear (16)
                # Left jaw (9-16) → body left ear (17)
                # Chin (8), nose (27-35), mouth (48-67) → body nose (0)
                face_anchor_map = {}
                for fi in range(0, 8): face_anchor_map[fi] = 16
                face_anchor_map[8] = 0
                for fi in range(9, 17): face_anchor_map[fi] = 17
                for fi in range(17, 22): face_anchor_map[fi] = 14
                for fi in range(22, 27): face_anchor_map[fi] = 15
                for fi in range(27, 36): face_anchor_map[fi] = 0
                for fi in range(36, 42): face_anchor_map[fi] = 14
                for fi in range(42, 48): face_anchor_map[fi] = 15
                for fi in range(48, 68): face_anchor_map[fi] = 0
                face_anchor_map[68] = 14
                face_anchor_map[69] = 15
                
                # Compute per-anchor deltas (transformed - original)
                anchor_deltas = {}
                nose_delta = [0.0, 0.0]
                if 0 in orig_anchors and adjusted[0][2] > 0:
                    nose_delta = [adjusted[0][0] - orig_anchors[0][0],
                                  adjusted[0][1] - orig_anchors[0][1]]
                
                for aidx in [0, 14, 15, 16, 17]:
                    if aidx in orig_anchors and adjusted[aidx][2] > 0:
                        anchor_deltas[aidx] = [adjusted[aidx][0] - orig_anchors[aidx][0],
                                               adjusted[aidx][1] - orig_anchors[aidx][1]]
                    else:
                        anchor_deltas[aidx] = nose_delta
                
                for fi, fp in enumerate(face_pts):
                    if fp[2] > 0:
                        anchor = face_anchor_map.get(fi, 0)
                        delta = anchor_deltas.get(anchor, nose_delta)
                        fp[0] += delta[0]
                        fp[1] += delta[1]
                
                person["face_keypoints_2d"] = flatten_keypoints(face_pts)
            
            new_people.append(person)
        
        output_pose["people"] = new_people
        return output_pose


# =============================================================================
# RENDERER NODE
# =============================================================================

class ComfyVFX_PoseRenderer:
    """Render POSE_KEYPOINT to IMAGE with exact OpenPose colors."""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pose_keypoint": ("POSE_KEYPOINT",),
            },
            "optional": {
                "width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "line_width": ("INT", {"default": 4, "min": 1, "max": 20, "step": 1}),
                "point_radius": ("INT", {"default": 5, "min": 1, "max": 20, "step": 1}),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "render"
    CATEGORY = "ComfyVFX/pose"
    
    def render(self, pose_keypoint, width=512, height=512, line_width=4, point_radius=5):
        if isinstance(pose_keypoint, list) and len(pose_keypoint) > 0:
            first = pose_keypoint[0]
            if isinstance(first, dict) and "people" in first:
                images = []
                for pose_data in pose_keypoint:
                    w = pose_data.get("canvas_width", width)
                    h = pose_data.get("canvas_height", height)
                    img = render_pose_image_from_pose(pose_data, w, h, line_width, point_radius)
                    images.append(pil_to_tensor(img))
                return (torch.cat(images, dim=0),)
        
        if isinstance(pose_keypoint, dict) and "people" in pose_keypoint:
            w = pose_keypoint.get("canvas_width", width)
            h = pose_keypoint.get("canvas_height", height)
            img = render_pose_image_from_pose(pose_keypoint, w, h, line_width, point_radius)
            return (pil_to_tensor(img),)
        
        return (pil_to_tensor(Image.new('RGB', (width, height), (0, 0, 0))),)


# =============================================================================
# NODE MAPPINGS
# =============================================================================

NODE_CLASS_MAPPINGS = {
    "ComfyVFX_PoseEditor": ComfyVFX_PoseEditor,
    "ComfyVFX_PoseRenderer": ComfyVFX_PoseRenderer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyVFX_PoseEditor": "ComfyVFX Pose Editor",
    "ComfyVFX_PoseRenderer": "ComfyVFX Pose Renderer",
}
