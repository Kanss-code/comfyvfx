import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// DEBUG: This logs immediately when the file is loaded
console.log("=== [PoseEditor] FILE LOADED - openpose_proportion_editor.js ===");

const KEYPOINT_COLORS = {
    0: "#FF0000", 1: "#FF5500", 2: "#FFAA00", 3: "#FFFF00",
    4: "#AAFF00", 5: "#55FF00", 6: "#00FF00", 7: "#00FF55",
    8: "#00FFAA", 9: "#00FFFF", 10: "#00AAFF", 11: "#0055FF",
    12: "#0000FF", 13: "#5500FF", 14: "#AA00FF", 15: "#FF00FF",
    16: "#FF00AA", 17: "#FF0055",
};

const BONE_CONNECTIONS = [
    [1, 2, "#990000"], [1, 5, "#993300"], [2, 3, "#996600"], [3, 4, "#999900"],
    [5, 6, "#669900"], [6, 7, "#339900"], [1, 8, "#009900"], [8, 9, "#009933"],
    [9, 10, "#009966"], [1, 11, "#009999"], [11, 12, "#006699"], [12, 13, "#003399"],
    [1, 0, "#000099"], [0, 14, "#330099"], [14, 16, "#660099"],
    [0, 15, "#990099"], [15, 17, "#990066"],
];

const SLIDER_DEFAULTS = {
    "temporal_smoothing": 0.0,
    "head_width": 1.0, "head_height": 1.0, "head_tilt": 0.0,
    "neck_length": 1.0, "shoulder_height": 0.0, "collarbone_length": 1.0,
    "arm_angle": 0.0, "upper_arm_length": 1.0, "forearm_length": 1.0,
    "torso_length": 1.0, "torso_tilt": 0.0,
    "hip_width": 1.0, "legs_angle": 0.0,
    "upper_leg_length": 1.0, "lower_leg_length": 1.0,
    "overall_scale": 1.0, "overall_rotate": 0.0,
    "position_x": 0.0, "position_y": 0.0,
};

const SLIDER_PARAMS = Object.keys(SLIDER_DEFAULTS);

// Body part definitions for visibility toggles
const BODY_PARTS = {
    // OpenPose keypoints: 0=nose, 1=neck, 2=Rshoulder, 3=Relbow, 4=Rwrist,
    // 5=Lshoulder, 6=Lelbow, 7=Lwrist, 8=Rhip, 9=Rknee, 10=Rankle,
    // 11=Lhip, 12=Lknee, 13=Lankle, 14=Reye, 15=Leye, 16=Rear, 17=Lear
    head: { indices: [0, 14, 15, 16, 17], label: "Head", bones: [[1, 0], [0, 14], [14, 16], [0, 15], [15, 17]] },
    torso: { indices: [1, 8, 11], label: "Torso", bones: [[1, 8], [1, 11], [1, 2], [1, 5]] },  // neck, hips, and connections to shoulders
    left_arm: { indices: [5, 6, 7], label: "L Arm", bones: [[5, 6], [6, 7]] },  // shoulder to wrist
    right_arm: { indices: [2, 3, 4], label: "R Arm", bones: [[2, 3], [3, 4]] },  // shoulder to wrist
    left_leg: { indices: [12, 13], label: "L Leg", bones: [[11, 12], [12, 13]] },  // hip to ankle (hip point is in torso)
    right_leg: { indices: [9, 10], label: "R Leg", bones: [[8, 9], [9, 10]] },  // hip to ankle (hip point is in torso)
};

// Keypoint hierarchy for rotation (child indices when rotating parent)
const KEYPOINT_CHILDREN = {
    0: [14, 15, 16, 17],  // Nose -> eyes, ears
    1: [0, 2, 5, 8, 11, 14, 15, 16, 17],  // Neck -> everything above hips
    2: [3, 4],  // Right shoulder -> elbow, wrist
    3: [4],     // Right elbow -> wrist
    5: [6, 7],  // Left shoulder -> elbow, wrist
    6: [7],     // Left elbow -> wrist
    8: [9, 10], // Right hip -> knee, ankle
    9: [10],    // Right knee -> ankle
    11: [12, 13], // Left hip -> knee, ankle
    12: [13],   // Left knee -> ankle
};

function parseKeypoints(keypoints2d) {
    const points = [];
    for (let i = 0; i < keypoints2d.length; i += 3) {
        points.push([keypoints2d[i], keypoints2d[i + 1], keypoints2d[i + 2]]);
    }
    return points;
}

function rotatePointAroundPivot(point, pivot, angleDegrees) {
    if (point[2] === 0 || pivot[2] === 0) return point;
    const angleRad = angleDegrees * Math.PI / 180;
    const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
    const dx = point[0] - pivot[0], dy = point[1] - pivot[1];
    return [pivot[0] + dx * cosA - dy * sinA, pivot[1] + dx * sinA + dy * cosA, point[2]];
}

function applyPerspectiveRotate(points, angle, canvasWidth, canvasHeight) {
    if (angle === 0 || !points) return points;
    
    points = points.map(p => [...p]);
    
    const validPoints = points.filter(p => p && p[2] > 0);
    if (validPoints.length === 0) return points;
    
    const sampleCoords = validPoints.flatMap(p => [p[0], p[1]]);
    const maxCoord = Math.max(...sampleCoords);
    const isNormalized = maxCoord <= 1.0;
    
    const centerX = validPoints.reduce((sum, p) => sum + p[0], 0) / validPoints.length;
    const width = isNormalized ? 1.0 : canvasWidth;
    
    const angleRad = angle * Math.PI / 180;
    const cosAngle = Math.cos(angleRad);
    
    const leftIndices = [5, 6, 7, 11, 12, 13, 15, 17];
    const rightIndices = [2, 3, 4, 8, 9, 10, 14, 16];
    const centerIndices = [0, 1];
    
    for (let idx = 0; idx < points.length; idx++) {
        const p = points[idx];
        if (!p || p[2] === 0) continue;
        
        if (leftIndices.includes(idx)) {
            if (angle > 0) {
                const scale = Math.max(0.3, cosAngle);
                const shift = (1 - cosAngle) * 0.3 * width;
                p[0] = centerX + (p[0] - centerX) * scale + shift;
            } else {
                const scale = 1.0 + (1 - cosAngle) * 0.2;
                const shift = -(1 - cosAngle) * 0.15 * width;
                p[0] = centerX + (p[0] - centerX) * scale + shift;
            }
        } else if (rightIndices.includes(idx)) {
            if (angle > 0) {
                const scale = 1.0 + (1 - cosAngle) * 0.2;
                const shift = (1 - cosAngle) * 0.15 * width;
                p[0] = centerX + (p[0] - centerX) * scale + shift;
            } else {
                const scale = Math.max(0.3, cosAngle);
                const shift = -(1 - cosAngle) * 0.3 * width;
                p[0] = centerX + (p[0] - centerX) * scale + shift;
            }
        } else if (centerIndices.includes(idx)) {
            const shift = Math.sin(angleRad) * 0.1 * width;
            p[0] = p[0] + shift;
        }
    }
    
    return points;
}

function applyProportions(points, props, canvasWidth, canvasHeight) {
    if (!points || points.length < 18) return points;
    
    points = points.map(p => [...p]);
    
    const sampleCoords = points.filter(p => p && p[2] > 0).flatMap(p => [p[0], p[1]]);
    const maxCoord = Math.max(...sampleCoords);
    const isNormalized = maxCoord <= 1.0;
    const width = isNormalized ? 1.0 : canvasWidth;
    const height = isNormalized ? 1.0 : canvasHeight;
    
    const neck = points[1];
    if (!neck || neck[2] === 0) return points;
    
    // Head - match Python: scale eyes/ears around nose, then neck_length from neck
    const nose = points[0];
    if (nose && nose[2] > 0) {
        // Step 1: Scale eyes/ears relative to nose (head size)
        for (const idx of [14, 15, 16, 17]) {
            const p = points[idx];
            if (p && p[2] > 0) {
                p[0] = nose[0] + (p[0] - nose[0]) * props.head_width;
                p[1] = nose[1] + (p[1] - nose[1]) * props.head_height;
            }
        }
    }
    
    if (props.head_tilt !== 0) {
        for (const idx of [0, 14, 15, 16, 17]) {
            const p = points[idx];
            if (p && p[2] > 0) {
                const rotated = rotatePointAroundPivot(p, neck, props.head_tilt);
                p[0] = rotated[0]; p[1] = rotated[1];
            }
        }
    }
    
    // Step 2: Neck length - scale nose (+ children) from neck
    if (nose && nose[2] > 0 && props.neck_length !== 1.0) {
        const oldNoseX = nose[0], oldNoseY = nose[1];
        nose[0] = neck[0] + (nose[0] - neck[0]) * props.neck_length;
        nose[1] = neck[1] + (nose[1] - neck[1]) * props.neck_length;
        const offsetX = nose[0] - oldNoseX;
        const offsetY = nose[1] - oldNoseY;
        for (const idx of [14, 15, 16, 17]) {
            const p = points[idx];
            if (p && p[2] > 0) {
                p[0] += offsetX;
                p[1] += offsetY;
            }
        }
    }
    
    // Shoulders
    const rShoulder = points[2], lShoulder = points[5];
    if (rShoulder && rShoulder[2] > 0) {
        rShoulder[0] = neck[0] + (rShoulder[0] - neck[0]) * props.collarbone_length;
        rShoulder[1] = rShoulder[1] - props.shoulder_height * Math.min(canvasWidth, canvasHeight) * 0.01;
    }
    if (lShoulder && lShoulder[2] > 0) {
        lShoulder[0] = neck[0] + (lShoulder[0] - neck[0]) * props.collarbone_length;
        lShoulder[1] = lShoulder[1] - props.shoulder_height * Math.min(canvasWidth, canvasHeight) * 0.01;
    }
    
    // Arms - match Python: rotate first, then scale_from with child propagation
    const rElbow = points[3], rWrist = points[4];
    const lElbow = points[6], lWrist = points[7];
    
    // Arm angles (rotate elbow around shoulder, propagate to wrist)
    if (props.arm_angle !== 0) {
        if (rShoulder && rShoulder[2] > 0 && rElbow && rElbow[2] > 0) {
            const rotated = rotatePointAroundPivot(rElbow, rShoulder, -props.arm_angle);
            const ox = rotated[0] - rElbow[0], oy = rotated[1] - rElbow[1];
            rElbow[0] = rotated[0]; rElbow[1] = rotated[1];
            if (rWrist && rWrist[2] > 0) { rWrist[0] += ox; rWrist[1] += oy; }
        }
        if (lShoulder && lShoulder[2] > 0 && lElbow && lElbow[2] > 0) {
            const rotated = rotatePointAroundPivot(lElbow, lShoulder, props.arm_angle);
            const ox = rotated[0] - lElbow[0], oy = rotated[1] - lElbow[1];
            lElbow[0] = rotated[0]; lElbow[1] = rotated[1];
            if (lWrist && lWrist[2] > 0) { lWrist[0] += ox; lWrist[1] += oy; }
        }
    }
    
    // Upper arm length (scale_from shoulder to elbow, propagate to wrist)
    if (rShoulder && rShoulder[2] > 0 && rElbow && rElbow[2] > 0 && props.upper_arm_length !== 1.0) {
        const oldX = rElbow[0], oldY = rElbow[1];
        rElbow[0] = rShoulder[0] + (rElbow[0] - rShoulder[0]) * props.upper_arm_length;
        rElbow[1] = rShoulder[1] + (rElbow[1] - rShoulder[1]) * props.upper_arm_length;
        if (rWrist && rWrist[2] > 0) { rWrist[0] += rElbow[0] - oldX; rWrist[1] += rElbow[1] - oldY; }
    }
    if (lShoulder && lShoulder[2] > 0 && lElbow && lElbow[2] > 0 && props.upper_arm_length !== 1.0) {
        const oldX = lElbow[0], oldY = lElbow[1];
        lElbow[0] = lShoulder[0] + (lElbow[0] - lShoulder[0]) * props.upper_arm_length;
        lElbow[1] = lShoulder[1] + (lElbow[1] - lShoulder[1]) * props.upper_arm_length;
        if (lWrist && lWrist[2] > 0) { lWrist[0] += lElbow[0] - oldX; lWrist[1] += lElbow[1] - oldY; }
    }
    
    // Forearm length (scale_from elbow to wrist)
    if (rElbow && rElbow[2] > 0 && rWrist && rWrist[2] > 0 && props.forearm_length !== 1.0) {
        rWrist[0] = rElbow[0] + (rWrist[0] - rElbow[0]) * props.forearm_length;
        rWrist[1] = rElbow[1] + (rWrist[1] - rElbow[1]) * props.forearm_length;
    }
    if (lElbow && lElbow[2] > 0 && lWrist && lWrist[2] > 0 && props.forearm_length !== 1.0) {
        lWrist[0] = lElbow[0] + (lWrist[0] - lElbow[0]) * props.forearm_length;
        lWrist[1] = lElbow[1] + (lWrist[1] - lElbow[1]) * props.forearm_length;
    }
    
    // Save ankle positions for foot anchoring (match Python)
    const anchorY = (points[10] && points[10][2] > 0) ? points[10][1] :
                    (points[13] && points[13][2] > 0) ? points[13][1] : null;
    
    // Hips - scale each hip from neck independently (match Python scale_from)
    const rHip = points[8], lHip = points[11];
    
    // Torso tilt first (Python does this before torso length)
    if (props.torso_tilt !== 0) {
        // Find hip center for rotation pivot
        let pivotX = null, pivotY = null;
        if (rHip && rHip[2] > 0 && lHip && lHip[2] > 0) {
            pivotX = (rHip[0] + lHip[0]) / 2;
            pivotY = (rHip[1] + lHip[1]) / 2;
        } else if (rHip && rHip[2] > 0) {
            pivotX = rHip[0]; pivotY = rHip[1];
        } else if (lHip && lHip[2] > 0) {
            pivotX = lHip[0]; pivotY = lHip[1];
        }
        if (pivotX !== null) {
            const pivot = [pivotX, pivotY, 1];
            for (const idx of [0, 1, 2, 3, 4, 5, 6, 7, 14, 15, 16, 17]) {
                const p = points[idx];
                if (p && p[2] > 0) {
                    const rotated = rotatePointAroundPivot(p, pivot, props.torso_tilt);
                    p[0] = rotated[0]; p[1] = rotated[1];
                }
            }
        }
    }
    
    // Torso length - scale hips from neck (match Python scale_from)
    if (rHip && rHip[2] > 0 && props.torso_length !== 1.0) {
        const oldX = rHip[0], oldY = rHip[1];
        rHip[0] = neck[0] + (rHip[0] - neck[0]) * props.torso_length;
        rHip[1] = neck[1] + (rHip[1] - neck[1]) * props.torso_length;
        const ox = rHip[0] - oldX, oy = rHip[1] - oldY;
        for (const idx of [9, 10]) {
            const p = points[idx];
            if (p && p[2] > 0) { p[0] += ox; p[1] += oy; }
        }
    }
    if (lHip && lHip[2] > 0 && props.torso_length !== 1.0) {
        const oldX = lHip[0], oldY = lHip[1];
        lHip[0] = neck[0] + (lHip[0] - neck[0]) * props.torso_length;
        lHip[1] = neck[1] + (lHip[1] - neck[1]) * props.torso_length;
        const ox = lHip[0] - oldX, oy = lHip[1] - oldY;
        for (const idx of [12, 13]) {
            const p = points[idx];
            if (p && p[2] > 0) { p[0] += ox; p[1] += oy; }
        }
    }
    
    // Hip width
    if (rHip && rHip[2] > 0 && lHip && lHip[2] > 0) {
        const hipCX = (rHip[0] + lHip[0]) / 2;
        const rOff = (rHip[0] - hipCX) * (props.hip_width - 1);
        const lOff = (lHip[0] - hipCX) * (props.hip_width - 1);
        rHip[0] += rOff;
        lHip[0] += lOff;
        if (points[9] && points[9][2] > 0) points[9][0] += rOff;
        if (points[10] && points[10][2] > 0) points[10][0] += rOff;
        if (points[12] && points[12][2] > 0) points[12][0] += lOff;
        if (points[13] && points[13][2] > 0) points[13][0] += lOff;
    }
    
    // Legs - match Python: rotate then scale_from with child propagation
    const rKnee = points[9], rAnkle = points[10];
    const lKnee = points[12], lAnkle = points[13];
    
    // Leg angles
    if (props.legs_angle !== 0) {
        if (rHip && rHip[2] > 0 && rKnee && rKnee[2] > 0) {
            const rotated = rotatePointAroundPivot(rKnee, rHip, -props.legs_angle);
            const ox = rotated[0] - rKnee[0], oy = rotated[1] - rKnee[1];
            rKnee[0] = rotated[0]; rKnee[1] = rotated[1];
            if (rAnkle && rAnkle[2] > 0) { rAnkle[0] += ox; rAnkle[1] += oy; }
        }
        if (lHip && lHip[2] > 0 && lKnee && lKnee[2] > 0) {
            const rotated = rotatePointAroundPivot(lKnee, lHip, props.legs_angle);
            const ox = rotated[0] - lKnee[0], oy = rotated[1] - lKnee[1];
            lKnee[0] = rotated[0]; lKnee[1] = rotated[1];
            if (lAnkle && lAnkle[2] > 0) { lAnkle[0] += ox; lAnkle[1] += oy; }
        }
    }
    
    // Upper leg length (scale_from hip to knee, propagate to ankle)
    if (rHip && rHip[2] > 0 && rKnee && rKnee[2] > 0 && props.upper_leg_length !== 1.0) {
        const oldX = rKnee[0], oldY = rKnee[1];
        rKnee[0] = rHip[0] + (rKnee[0] - rHip[0]) * props.upper_leg_length;
        rKnee[1] = rHip[1] + (rKnee[1] - rHip[1]) * props.upper_leg_length;
        if (rAnkle && rAnkle[2] > 0) { rAnkle[0] += rKnee[0] - oldX; rAnkle[1] += rKnee[1] - oldY; }
    }
    if (lHip && lHip[2] > 0 && lKnee && lKnee[2] > 0 && props.upper_leg_length !== 1.0) {
        const oldX = lKnee[0], oldY = lKnee[1];
        lKnee[0] = lHip[0] + (lKnee[0] - lHip[0]) * props.upper_leg_length;
        lKnee[1] = lHip[1] + (lKnee[1] - lHip[1]) * props.upper_leg_length;
        if (lAnkle && lAnkle[2] > 0) { lAnkle[0] += lKnee[0] - oldX; lAnkle[1] += lKnee[1] - oldY; }
    }
    
    // Lower leg length (scale_from knee to ankle)
    if (rKnee && rKnee[2] > 0 && rAnkle && rAnkle[2] > 0 && props.lower_leg_length !== 1.0) {
        rAnkle[0] = rKnee[0] + (rAnkle[0] - rKnee[0]) * props.lower_leg_length;
        rAnkle[1] = rKnee[1] + (rAnkle[1] - rKnee[1]) * props.lower_leg_length;
    }
    if (lKnee && lKnee[2] > 0 && lAnkle && lAnkle[2] > 0 && props.lower_leg_length !== 1.0) {
        lAnkle[0] = lKnee[0] + (lAnkle[0] - lKnee[0]) * props.lower_leg_length;
        lAnkle[1] = lKnee[1] + (lAnkle[1] - lKnee[1]) * props.lower_leg_length;
    }
    
    // Foot anchoring (match Python: keep feet planted)
    if (anchorY !== null) {
        const currentY = (points[10] && points[10][2] > 0) ? points[10][1] :
                         (points[13] && points[13][2] > 0) ? points[13][1] : null;
        if (currentY !== null) {
            const offsetY = anchorY - currentY;
            for (const p of points) {
                if (p && p[2] > 0) p[1] += offsetY;
            }
        }
    }
    
    return points;
}

function applyTransform(points, scale, rotate, posX, posY, canvasWidth, canvasHeight) {
    if (!points || points.length === 0) return points;
    
    points = points.map(p => [...p]);
    
    const validPoints = points.filter(p => p && p[2] > 0);
    if (validPoints.length === 0) return points;
    
    const sampleCoords = validPoints.flatMap(p => [p[0], p[1]]);
    const maxCoord = Math.max(...sampleCoords);
    const isNormalized = maxCoord <= 1.0;
    
    const width = isNormalized ? 1.0 : canvasWidth;
    const height = isNormalized ? 1.0 : canvasHeight;
    
    const centerX = validPoints.reduce((sum, p) => sum + p[0], 0) / validPoints.length;
    const centerY = validPoints.reduce((sum, p) => sum + p[1], 0) / validPoints.length;
    
    const angleRad = rotate * Math.PI / 180;
    const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
    
    for (const p of points) {
        if (!p || p[2] === 0) continue;
        
        let dx = p[0] - centerX, dy = p[1] - centerY;
        dx *= scale; dy *= scale;
        
        const rotX = dx * cosA - dy * sinA;
        const rotY = dx * sinA + dy * cosA;
        
        p[0] = centerX + rotX + posX * width;
        p[1] = centerY + rotY + posY * height;
    }
    
    return points;
}

function drawSkeleton(ctx, points, pw, ph, canvasWidth, canvasHeight, lineWidth, pointRadius, visibleParts = null, highlightedJoint = -1) {
    if (!points || points.length < 18) return;
    
    const scaleX = pw / canvasWidth;
    const scaleY = ph / canvasHeight;
    
    // Build set of visible bone connections and points
    const visibleBones = new Set();
    const visiblePoints = new Set();
    
    if (visibleParts) {
        for (const [partName, partInfo] of Object.entries(BODY_PARTS)) {
            if (visibleParts[partName]) {
                partInfo.indices.forEach(i => visiblePoints.add(i));
                partInfo.bones.forEach(b => visibleBones.add(`${b[0]}-${b[1]}`));
            }
        }
    } else {
        // All visible by default
        for (let i = 0; i < 18; i++) visiblePoints.add(i);
        for (const [start, end, color] of BONE_CONNECTIONS) {
            visibleBones.add(`${start}-${end}`);
        }
    }
    
    // Draw bones
    ctx.lineWidth = lineWidth;
    for (const [start, end, color] of BONE_CONNECTIONS) {
        const boneKey = `${start}-${end}`;
        const boneKeyReverse = `${end}-${start}`;
        if (!visibleBones.has(boneKey) && !visibleBones.has(boneKeyReverse)) continue;
        
        const p1 = points[start], p2 = points[end];
        if (p1 && p2 && p1[2] > 0 && p2[2] > 0) {
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(p1[0] * scaleX, p1[1] * scaleY);
            ctx.lineTo(p2[0] * scaleX, p2[1] * scaleY);
            ctx.stroke();
        }
    }
    
    // Draw points
    for (let i = 0; i < 18; i++) {
        if (!visiblePoints.has(i)) continue;
        
        const point = points[i];
        if (point && point[2] > 0) {
            // Highlight selected/hovered joint
            if (i === highlightedJoint) {
                ctx.fillStyle = "#FFFFFF";
                ctx.beginPath();
                ctx.arc(point[0] * scaleX, point[1] * scaleY, pointRadius + 4, 0, Math.PI * 2);
                ctx.fill();
            }
            
            ctx.fillStyle = KEYPOINT_COLORS[i] || "#FFFFFF";
            ctx.beginPath();
            ctx.arc(point[0] * scaleX, point[1] * scaleY, pointRadius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function findClosestJoint(points, mouseX, mouseY, scaleX, scaleY, threshold = 20, visibleParts = null) {
    let closest = -1;
    let minDist = threshold;
    
    // Build set of visible points
    const visiblePoints = new Set();
    if (visibleParts) {
        for (const [partName, partInfo] of Object.entries(BODY_PARTS)) {
            if (visibleParts[partName]) {
                partInfo.indices.forEach(i => visiblePoints.add(i));
            }
        }
    } else {
        for (let i = 0; i < 18; i++) visiblePoints.add(i);
    }
    
    for (let i = 0; i < Math.min(points.length, 18); i++) {
        if (!visiblePoints.has(i)) continue;
        
        const p = points[i];
        if (p && p[2] > 0) {
            const dx = p[0] * scaleX - mouseX;
            const dy = p[1] * scaleY - mouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) {
                minDist = dist;
                closest = i;
            }
        }
    }
    return closest;
}

app.registerExtension({
    name: "ComfyVFX.PoseEditor",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // DEBUG: Log all node registrations to verify this file is loaded
        console.log("[PoseEditor DEBUG] beforeRegisterNodeDef called for:", nodeData.name);
        
        if (nodeData.name !== "ComfyVFX_PoseEditor") return;
        
        console.log("[PoseEditor DEBUG] Setting up ComfyVFX_PoseEditor node");
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);
            
            this.previewContainer = document.createElement("div");
            this.previewContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px; width: 100%;";
            
            // Visibility toggles container
            this.visibilityContainer = document.createElement("div");
            this.visibilityContainer.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; padding: 4px; background: #2a2a2a; border-radius: 4px;";
            
            // Initialize visible parts
            this.visibleParts = {
                head: true, torso: true, left_arm: true, right_arm: true, left_leg: true, right_leg: true
            };
            
            // Create toggle buttons for each body part
            for (const [partName, partInfo] of Object.entries(BODY_PARTS)) {
                const btn = document.createElement("button");
                btn.textContent = partInfo.label;
                btn.style.cssText = "padding: 4px 8px; font-size: 11px; border: none; border-radius: 3px; cursor: pointer; background: #4a9eff; color: white;";
                btn.dataset.part = partName;
                btn.addEventListener("click", () => {
                    this.visibleParts[partName] = !this.visibleParts[partName];
                    btn.style.background = this.visibleParts[partName] ? "#4a9eff" : "#666";
                    this.syncVisibilityToWidget();
                    this.updatePreview();
                });
                this.visibilityContainer.appendChild(btn);
            }
            
            // ========== CHARACTER SELECTION (Accordion) ==========
            // Character selection state
            this.charEnabled = {};  // {idx: bool} - which chars are in output
            this.charEditingIdx = null;  // which char is being individually edited (null = all)
            this.charPerParams = {};  // {idx: {param: value}} - per-character overrides
            this.charCount = 0;
            
            // Accordion container
            this.charAccordion = document.createElement("div");
            this.charAccordion.style.cssText = "display: none; background: #1e1e2e; border-radius: 4px; margin-top: 4px; overflow: hidden;";
            
            // Accordion header (clickable)
            this.charAccordionHeader = document.createElement("div");
            this.charAccordionHeader.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; cursor: pointer; background: #2a2a3a; user-select: none;";
            { this.charAccordionHeader.replaceChildren(); const _s1=document.createElement('span'); _s1.style.cssText='color:#aaa;font-size:11px;font-weight:bold;'; _s1.textContent='▶ Characters'; const _s2=document.createElement('span'); _s2.style.cssText='color:#4a9eff;font-size:11px;'; _s2.textContent='Editing: All'; this.charAccordionHeader.appendChild(_s1); this.charAccordionHeader.appendChild(_s2); }
            this.charAccordionExpanded = false;
            
            this.charAccordionHeader.addEventListener("click", () => {
                this.charAccordionExpanded = !this.charAccordionExpanded;
                this.charAccordionContent.style.display = this.charAccordionExpanded ? "flex" : "none";
                this.charAccordionHeader.querySelector("span").textContent = (this.charAccordionExpanded ? "▼" : "▶") + " Characters";
            });
            
            // Accordion content (character buttons)
            this.charAccordionContent = document.createElement("div");
            this.charAccordionContent.style.cssText = "display: none; flex-wrap: wrap; gap: 4px; padding: 8px; align-items: center;";
            
            this.charAccordion.appendChild(this.charAccordionHeader);
            this.charAccordion.appendChild(this.charAccordionContent);
            // ========== END CHARACTER SELECTION ==========
            
            // Tool selection container
            this.toolContainer = document.createElement("div");
            this.toolContainer.style.cssText = "display: flex; gap: 4px; justify-content: center; padding: 4px;";
            
            this.currentTool = "move"; // "move", "rotate", or "scale"
            
            const moveBtn = document.createElement("button");
            moveBtn.textContent = "✥ Move";
            moveBtn.style.cssText = "padding: 6px 12px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; background: #4a9eff; color: white;";
            moveBtn.addEventListener("click", () => {
                this.currentTool = "move";
                moveBtn.style.background = "#4a9eff";
                rotateBtn.style.background = "#4a4a4a";
                scaleBtn.style.background = "#4a4a4a";
            });
            
            const rotateBtn = document.createElement("button");
            rotateBtn.textContent = "↻ Rotate";
            rotateBtn.style.cssText = "padding: 6px 12px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; background: #4a4a4a; color: white;";
            rotateBtn.addEventListener("click", () => {
                this.currentTool = "rotate";
                rotateBtn.style.background = "#4a9eff";
                moveBtn.style.background = "#4a4a4a";
                scaleBtn.style.background = "#4a4a4a";
            });
            
            const scaleBtn = document.createElement("button");
            scaleBtn.textContent = "⤢ Scale";
            scaleBtn.style.cssText = "padding: 6px 12px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; background: #4a4a4a; color: white;";
            scaleBtn.addEventListener("click", () => {
                this.currentTool = "scale";
                scaleBtn.style.background = "#4a9eff";
                moveBtn.style.background = "#4a4a4a";
                rotateBtn.style.background = "#4a4a4a";
            });
            
            this.toolContainer.appendChild(moveBtn);
            this.toolContainer.appendChild(rotateBtn);
            this.toolContainer.appendChild(scaleBtn);
            this.moveBtn = moveBtn;
            this.rotateBtn = rotateBtn;
            this.scaleBtn = scaleBtn;
            
            // Size control
            this.sizeContainer = document.createElement("div");
            this.sizeContainer.style.cssText = "display: flex; gap: 8px; align-items: center; justify-content: center;";
            
            this.sizeLabel = document.createElement("span");
            this.sizeLabel.textContent = "Size: 5";
            this.sizeLabel.style.cssText = "color: #ccc; font-size: 12px; min-width: 60px;";
            
            this.sizeSlider = document.createElement("input");
            this.sizeSlider.type = "range";
            this.sizeSlider.min = "1";
            this.sizeSlider.max = "20";
            this.sizeSlider.value = "5";
            this.sizeSlider.style.cssText = "width: 150px;";
            this.sizeSlider.addEventListener("input", () => {
                this.drawSize = parseInt(this.sizeSlider.value);
                this.sizeLabel.textContent = `Size: ${this.drawSize}`;
                this.updatePreview();
            });
            
            this.sizeContainer.appendChild(this.sizeLabel);
            this.sizeContainer.appendChild(this.sizeSlider);
            
            // Canvas - high resolution
            this.previewCanvas = document.createElement("canvas");
            this.previewCanvas.width = 1280;
            this.previewCanvas.height = 1280;
            this.previewCanvas.style.cssText = "border: 1px solid #444; border-radius: 4px; width: 100%; height: auto; cursor: crosshair;";
            this.previewCtx = this.previewCanvas.getContext("2d");
            
            // Interactive joint manipulation state
            this.selectedJoint = -1;
            this.hoveredJoint = -1;
            this.isDragging = false;
            this.dragStartPos = null;
            this.originalPoints = null;
            
            // Persistent joint transforms that apply to ALL frames
            // Format: { jointIdx: { move: {x, y}, rotate: angle, scale: factor } }
            this.jointTransforms = {};
            
            // Mouse event handlers for joint manipulation
            this.previewCanvas.addEventListener("mousedown", (e) => this.onCanvasMouseDown(e));
            this.previewCanvas.addEventListener("mousemove", (e) => this.onCanvasMouseMove(e));
            this.previewCanvas.addEventListener("mouseup", (e) => this.onCanvasMouseUp(e));
            this.previewCanvas.addEventListener("mouseleave", (e) => this.onCanvasMouseUp(e));
            
            // Playback controls
            this.playbackContainer = document.createElement("div");
            this.playbackContainer.style.cssText = "display: flex; gap: 8px; align-items: center; justify-content: center;";
            
            const playBtnStyle = "padding: 6px 12px; background: #4a4a4a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;";
            
            this.prevFrameBtn = document.createElement("button");
            this.prevFrameBtn.textContent = "⏮";
            this.prevFrameBtn.style.cssText = playBtnStyle;
            this.prevFrameBtn.addEventListener("click", () => this.prevFrame());
            
            this.playPauseBtn = document.createElement("button");
            this.playPauseBtn.textContent = "▶";
            this.playPauseBtn.style.cssText = playBtnStyle + " min-width: 40px;";
            this.playPauseBtn.addEventListener("click", () => this.togglePlayback());
            
            this.nextFrameBtn = document.createElement("button");
            this.nextFrameBtn.textContent = "⏭";
            this.nextFrameBtn.style.cssText = playBtnStyle;
            this.nextFrameBtn.addEventListener("click", () => this.nextFrame());
            
            this.frameLabel = document.createElement("span");
            this.frameLabel.textContent = "Frame: 1/1";
            this.frameLabel.style.cssText = "color: #ccc; font-size: 12px; min-width: 80px;";
            
            this.playbackContainer.appendChild(this.prevFrameBtn);
            this.playbackContainer.appendChild(this.playPauseBtn);
            this.playbackContainer.appendChild(this.nextFrameBtn);
            this.playbackContainer.appendChild(this.frameLabel);
            
            // Button container
            this.buttonContainer = document.createElement("div");
            this.buttonContainer.style.cssText = "display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;";
            
            const btnStyle = "padding: 6px 12px; background: #4a4a4a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;";
            
            this.resetBtn = document.createElement("button");
            this.resetBtn.textContent = "Reset All";
            this.resetBtn.style.cssText = btnStyle + " background: #8B0000;";
            this.resetBtn.addEventListener("mouseenter", () => this.resetBtn.style.background = "#A00000");
            this.resetBtn.addEventListener("mouseleave", () => this.resetBtn.style.background = "#8B0000");
            this.resetBtn.addEventListener("click", () => this.resetAllSliders());
            
            this.exportBtn = document.createElement("button");
            this.exportBtn.textContent = "Export Preset";
            this.exportBtn.style.cssText = btnStyle;
            this.exportBtn.addEventListener("mouseenter", () => this.exportBtn.style.background = "#5a5a5a");
            this.exportBtn.addEventListener("mouseleave", () => this.exportBtn.style.background = "#4a4a4a");
            this.exportBtn.addEventListener("click", () => this.exportPreset());
            
            this.importBtn = document.createElement("button");
            this.importBtn.textContent = "Import Preset";
            this.importBtn.style.cssText = btnStyle;
            this.importBtn.addEventListener("mouseenter", () => this.importBtn.style.background = "#5a5a5a");
            this.importBtn.addEventListener("mouseleave", () => this.importBtn.style.background = "#4a4a4a");
            this.importBtn.addEventListener("click", () => this.importPreset());
            
            this.fileInput = document.createElement("input");
            this.fileInput.type = "file";
            this.fileInput.accept = ".json";
            this.fileInput.style.display = "none";
            this.fileInput.addEventListener("change", (e) => this.handleFileImport(e));
            
            this.buttonContainer.appendChild(this.resetBtn);
            this.buttonContainer.appendChild(this.exportBtn);
            this.buttonContainer.appendChild(this.importBtn);
            this.buttonContainer.appendChild(this.fileInput);
            
            this.previewContainer.appendChild(this.visibilityContainer);
            this.previewContainer.appendChild(this.charAccordion);
            this.previewContainer.appendChild(this.toolContainer);
            this.previewContainer.appendChild(this.sizeContainer);
            this.previewContainer.appendChild(this.previewCanvas);
            this.previewContainer.appendChild(this.playbackContainer);
            this.previewContainer.appendChild(this.buttonContainer);
            
            // State
            this.referenceImage = null;
            this.allFrames = [];
            this.currentFrame = 0;
            this.isPlaying = false;
            this.playbackInterval = null;
            this.drawSize = 5;
            this.canvasWidth = 512;
            this.canvasHeight = 512;
            
            this.addDOMWidget("preview", "div", this.previewContainer, { serialize: false, hideOnZoom: false });
            this.setSize([450, 1150]);
            
            // Load any saved transforms from widget after a short delay (widgets need to initialize)
            setTimeout(() => {
                // Hide the joint_transforms widget (it's for data transfer only)
                const jtWidget = this.widgets?.find(w => w.name === "joint_transforms");
                if (jtWidget && jtWidget.element) {
                    jtWidget.element.style.display = "none";
                }
                // Also try to find by iterating
                for (const w of this.widgets || []) {
                    if (w.name === "joint_transforms" || w.name === "visible_parts" || w.name === "character_selection") {
                        if (w.element) w.element.style.display = "none";
                        if (w.inputEl) w.inputEl.style.display = "none";
                        // Collapse the widget row
                        w.computeSize = () => [0, -4];
                    }
                }
                this.loadTransformsFromWidget();
                this.updatePreview();
                this.setSize([450, 1150]); // Recompute size
            }, 100);
        };
        
        // Mouse handlers for joint manipulation
        nodeType.prototype.onCanvasMouseDown = function(e) {
            const rect = this.previewCanvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) * (this.previewCanvas.width / rect.width);
            const mouseY = (e.clientY - rect.top) * (this.previewCanvas.height / rect.height);
            
            const frameData = this.allFrames[this.currentFrame];
            if (!frameData || !frameData.people || frameData.people.length === 0) return;
            
            const person = frameData.people[0];
            if (!person || !person.pose_keypoints_2d) return;
            
            // Get FULLY transformed points for accurate hit testing
            const points = this.getFullyTransformedPoints(person.pose_keypoints_2d);
            
            const scaleX = this.previewCanvas.width / this.canvasWidth;
            const scaleY = this.previewCanvas.height / this.canvasHeight;
            
            const joint = findClosestJoint(points, mouseX, mouseY, scaleX, scaleY, 30, this.visibleParts);
            
            if (joint >= 0) {
                this.selectedJoint = joint;
                this.isDragging = true;
                this.dragStartPos = { x: mouseX, y: mouseY };
                // Store the current transform state at drag start
                this.dragStartTransform = this.jointTransforms[joint] ? {...this.jointTransforms[joint]} : { move: {x: 0, y: 0}, rotate: 0, scale: 1 };
                this.previewCanvas.style.cursor = "grabbing";
                this.updatePreview();
            }
        };
        
        // Helper to get fully transformed points (same as updatePreview uses)
        nodeType.prototype.getFullyTransformedPoints = function(keypoints2d) {
            // Helper to get widget value
            const getVal = (name, def) => {
                const w = this.widgets?.find(x => x.name === name);
                return w !== undefined ? w.value : def;
            };
            
            const props = {
                head_width: getVal("head_width", 1.0), head_height: getVal("head_height", 1.0),
                head_tilt: getVal("head_tilt", 0.0), neck_length: getVal("neck_length", 1.0),
                shoulder_height: getVal("shoulder_height", 0.0), collarbone_length: getVal("collarbone_length", 1.0),
                arm_angle: getVal("arm_angle", 0.0), upper_arm_length: getVal("upper_arm_length", 1.0),
                forearm_length: getVal("forearm_length", 1.0), torso_length: getVal("torso_length", 1.0),
                torso_tilt: getVal("torso_tilt", 0.0), hip_width: getVal("hip_width", 1.0),
                legs_angle: getVal("legs_angle", 0.0), upper_leg_length: getVal("upper_leg_length", 1.0),
                lower_leg_length: getVal("lower_leg_length", 1.0),
            };
            
            const overallScale = getVal("overall_scale", 1.0);
            const overallRotate = getVal("overall_rotate", 0.0);
            const posX = getVal("position_x", 0.0);
            const posY = getVal("position_y", 0.0);
            
            let points = parseKeypoints(keypoints2d);
            points = applyProportions(points, props, this.canvasWidth, this.canvasHeight);
            points = this.applyJointTransforms(points);
            points = applyTransform(points, overallScale, overallRotate, posX, posY, this.canvasWidth, this.canvasHeight);
            
            return points;
        };
        
        nodeType.prototype.onCanvasMouseMove = function(e) {
            const rect = this.previewCanvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) * (this.previewCanvas.width / rect.width);
            const mouseY = (e.clientY - rect.top) * (this.previewCanvas.height / rect.height);
            
            if (this.isDragging && this.selectedJoint >= 0) {
                const scaleX = this.previewCanvas.width / this.canvasWidth;
                const scaleY = this.previewCanvas.height / this.canvasHeight;
                
                const deltaX = (mouseX - this.dragStartPos.x) / scaleX;
                const deltaY = (mouseY - this.dragStartPos.y) / scaleY;
                
                // Initialize transform for this joint if needed
                if (!this.jointTransforms[this.selectedJoint]) {
                    this.jointTransforms[this.selectedJoint] = { move: {x: 0, y: 0}, rotate: 0, scale: 1 };
                }
                
                if (this.currentTool === "move") {
                    // Add to existing move offset
                    this.jointTransforms[this.selectedJoint].move = {
                        x: (this.dragStartTransform.move?.x || 0) + deltaX,
                        y: (this.dragStartTransform.move?.y || 0) + deltaY
                    };
                } else if (this.currentTool === "rotate") {
                    // Calculate rotation angle based on mouse movement
                    const centerX = this.previewCanvas.width / 2;
                    const centerY = this.previewCanvas.height / 2;
                    const startAngle = Math.atan2(this.dragStartPos.y - centerY, this.dragStartPos.x - centerX);
                    const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
                    const angleDelta = (currentAngle - startAngle) * 180 / Math.PI;
                    
                    this.jointTransforms[this.selectedJoint].rotate = (this.dragStartTransform.rotate || 0) + angleDelta;
                } else if (this.currentTool === "scale") {
                    // Calculate scale based on vertical mouse movement
                    const scaleDelta = 1 + (deltaY / 200); // Drag down = smaller, drag up = larger
                    this.jointTransforms[this.selectedJoint].scale = Math.max(0.1, Math.min(3, (this.dragStartTransform.scale || 1) * scaleDelta));
                }
                
                this.updatePreview();
            } else {
                // Highlight joint on hover - use fully transformed points
                const frameData = this.allFrames[this.currentFrame];
                if (frameData && frameData.people && frameData.people.length > 0) {
                    const person = frameData.people[0];
                    if (person && person.pose_keypoints_2d) {
                        const points = this.getFullyTransformedPoints(person.pose_keypoints_2d);
                        const scaleX = this.previewCanvas.width / this.canvasWidth;
                        const scaleY = this.previewCanvas.height / this.canvasHeight;
                        
                        const joint = findClosestJoint(points, mouseX, mouseY, scaleX, scaleY, 30, this.visibleParts);
                        
                        if (joint !== this.hoveredJoint) {
                            this.hoveredJoint = joint;
                            this.previewCanvas.style.cursor = joint >= 0 ? "pointer" : "crosshair";
                            this.updatePreview();
                        }
                    }
                }
            }
        };
        
        nodeType.prototype.onCanvasMouseUp = function(e) {
            if (this.isDragging) {
                this.isDragging = false;
                this.previewCanvas.style.cursor = "crosshair";
                this.dragStartTransform = null;
                // Sync transforms to widget so Python receives them on execution
                this.syncTransformsToWidget();
            }
        };
        
        // Sync joint transforms to the hidden widget so Python can read them
        nodeType.prototype.syncTransformsToWidget = function() {
            const widget = this.widgets?.find(w => w.name === "joint_transforms");
            if (widget) {
                widget.value = JSON.stringify(this.jointTransforms);
                if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
            }
        };
        
        // Sync visibility to widget so Python can use it for rendering
        nodeType.prototype.syncVisibilityToWidget = function() {
            const widget = this.widgets?.find(w => w.name === "visible_parts");
            if (widget) {
                widget.value = JSON.stringify(this.visibleParts);
                if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
            }
        };
        
        // Load joint transforms from widget (on node creation/load)
        nodeType.prototype.loadTransformsFromWidget = function() {
            const widget = this.widgets?.find(w => w.name === "joint_transforms");
            if (widget && widget.value) {
                try {
                    this.jointTransforms = JSON.parse(widget.value);
                } catch (e) {
                    this.jointTransforms = {};
                }
            }
            // Also load visibility
            const visWidget = this.widgets?.find(w => w.name === "visible_parts");
            if (visWidget && visWidget.value) {
                try {
                    const loaded = JSON.parse(visWidget.value);
                    this.visibleParts = {...this.visibleParts, ...loaded};
                    // Update button states
                    for (const btn of this.visibilityContainer.children) {
                        const part = btn.dataset.part;
                        if (part && this.visibleParts.hasOwnProperty(part)) {
                            btn.style.background = this.visibleParts[part] ? "#4a9eff" : "#666";
                        }
                    }
                } catch (e) {}
            }
        };
        
        // Apply all stored joint transforms to a set of points
        nodeType.prototype.applyJointTransforms = function(points) {
            if (!points || points.length < 18) return points;
            if (!this.jointTransforms || Object.keys(this.jointTransforms).length === 0) return points;
            
            // Deep copy points
            points = points.map(p => [...p]);
            
            // Process transforms in hierarchical order (parents first)
            const processOrder = [1, 0, 2, 5, 8, 11, 3, 6, 9, 12, 4, 7, 10, 13, 14, 15, 16, 17];
            
            for (const jointIdx of processOrder) {
                const transform = this.jointTransforms[jointIdx];
                if (!transform) continue;
                
                const point = points[jointIdx];
                if (!point || point[2] === 0) continue;
                
                // Find parent joint for this joint (for rotation pivot)
                let pivotIdx = this.findParentJoint(jointIdx);
                const pivot = pivotIdx >= 0 && points[pivotIdx] && points[pivotIdx][2] > 0 ? points[pivotIdx] : point;
                
                // Get children that should move/rotate/scale with this joint
                const children = KEYPOINT_CHILDREN[jointIdx] || [];
                const affectedJoints = [jointIdx, ...children];
                
                // Apply move transform
                if (transform.move && (transform.move.x !== 0 || transform.move.y !== 0)) {
                    for (const idx of affectedJoints) {
                        if (points[idx] && points[idx][2] > 0) {
                            points[idx][0] += transform.move.x;
                            points[idx][1] += transform.move.y;
                        }
                    }
                }
                
                // Apply rotation transform around pivot
                if (transform.rotate && transform.rotate !== 0) {
                    const angleRad = transform.rotate * Math.PI / 180;
                    const cosA = Math.cos(angleRad);
                    const sinA = Math.sin(angleRad);
                    
                    for (const idx of affectedJoints) {
                        if (points[idx] && points[idx][2] > 0) {
                            const dx = points[idx][0] - pivot[0];
                            const dy = points[idx][1] - pivot[1];
                            points[idx][0] = pivot[0] + dx * cosA - dy * sinA;
                            points[idx][1] = pivot[1] + dx * sinA + dy * cosA;
                        }
                    }
                }
                
                // Apply scale transform from pivot
                if (transform.scale && transform.scale !== 1) {
                    for (const idx of affectedJoints) {
                        if (idx === jointIdx) continue; // Don't scale the pivot joint itself relative to parent
                        if (points[idx] && points[idx][2] > 0) {
                            const dx = points[idx][0] - point[0];
                            const dy = points[idx][1] - point[1];
                            points[idx][0] = point[0] + dx * transform.scale;
                            points[idx][1] = point[1] + dy * transform.scale;
                        }
                    }
                }
            }
            
            return points;
        };
        
        // Find parent joint index for a given joint
        nodeType.prototype.findParentJoint = function(jointIdx) {
            for (const [parent, children] of Object.entries(KEYPOINT_CHILDREN)) {
                if (children.includes(jointIdx)) {
                    return parseInt(parent);
                }
            }
            return -1; // No parent (root joints)
        };
        
        nodeType.prototype.togglePlayback = function() {
            if (this.isPlaying) {
                this.stopPlayback();
            } else {
                this.startPlayback();
            }
        };
        
        nodeType.prototype.startPlayback = function() {
            if (this.allFrames.length <= 1) return;
            this.isPlaying = true;
            this.playPauseBtn.textContent = "⏸";
            this.playbackInterval = setInterval(() => {
                this.nextFrame();
            }, 1000 / 24);
        };
        
        nodeType.prototype.stopPlayback = function() {
            this.isPlaying = false;
            this.playPauseBtn.textContent = "▶";
            if (this.playbackInterval) {
                clearInterval(this.playbackInterval);
                this.playbackInterval = null;
            }
        };
        
        nodeType.prototype.nextFrame = function() {
            if (this.allFrames.length === 0) return;
            this.currentFrame = (this.currentFrame + 1) % this.allFrames.length;
            this.updateFrameLabel();
            this.updatePreview();
        };
        
        nodeType.prototype.prevFrame = function() {
            if (this.allFrames.length === 0) return;
            this.currentFrame = (this.currentFrame - 1 + this.allFrames.length) % this.allFrames.length;
            this.updateFrameLabel();
            this.updatePreview();
        };
        
        nodeType.prototype.updateFrameLabel = function() {
            const total = Math.max(1, this.allFrames.length);
            this.frameLabel.textContent = `Frame: ${this.currentFrame + 1}/${total}`;
        };
        
        nodeType.prototype.resetAllSliders = function() {
            // Reset all sliders to defaults
            for (const paramName of SLIDER_PARAMS) {
                const widget = this.widgets?.find(w => w.name === paramName);
                if (widget) widget.value = SLIDER_DEFAULTS[paramName];
            }
            
            // Clear all manual joint transforms and sync to widget
            this.jointTransforms = {};
            this.syncTransformsToWidget();
            
            // Reset visibility to all visible
            this.visibleParts = {head: true, torso: true, left_arm: true, right_arm: true, left_leg: true, right_leg: true};
            this.syncVisibilityToWidget();
            for (const btn of this.visibilityContainer.children) {
                btn.style.background = "#4a9eff";
            }
            
            // Reset character selection
            this.charEnabled = {};
            this.charEditingIdx = null;
            this.charPerParams = {};
            this.charCount = 0;
            this.syncCharSelectionToWidget();
            this.rebuildCharacterButtons();
            
            // Reset tool to Move
            this.currentTool = "move";
            if (this.moveBtn) this.moveBtn.style.background = "#4a9eff";
            if (this.rotateBtn) this.rotateBtn.style.background = "#4a4a4a";
            if (this.scaleBtn) this.scaleBtn.style.background = "#4a4a4a";
            
            // Reset interactive state
            this.selectedJoint = -1;
            this.hoveredJoint = -1;
            this.isDragging = false;
            this.dragStartPos = null;
            this.dragStartTransform = null;
            this.originalPoints = null;
            
            // Reset playback
            this.stopPlayback();
            this.currentFrame = 0;
            this.updateFrameLabel();
            
            // Reset draw size
            this.drawSize = 5;
            if (this.sizeSlider) { this.sizeSlider.value = "5"; }
            if (this.sizeLabel) { this.sizeLabel.textContent = "Size: 5"; }
            
            this.updatePreview();
            if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
        };
        
        nodeType.prototype.exportPreset = function() {
            const preset = { 
                name: "OpenPose Preset", 
                version: "5.0", 
                created: new Date().toISOString(), 
                parameters: {},
                jointTransforms: this.jointTransforms || {}
            };
            for (const paramName of SLIDER_PARAMS) {
                const widget = this.widgets?.find(w => w.name === paramName);
                if (widget) preset.parameters[paramName] = widget.value;
            }
            const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `openpose_preset_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };
        
        nodeType.prototype.importPreset = function() { this.fileInput.click(); };
        
        nodeType.prototype.handleFileImport = function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const preset = JSON.parse(event.target.result);
                    if (!preset.parameters) { alert("Invalid preset"); return; }
                    for (const paramName of SLIDER_PARAMS) {
                        if (preset.parameters.hasOwnProperty(paramName)) {
                            const widget = this.widgets?.find(w => w.name === paramName);
                            if (widget) widget.value = preset.parameters[paramName];
                        }
                    }
                    // Load joint transforms if present and sync to widget
                    if (preset.jointTransforms) {
                        this.jointTransforms = preset.jointTransforms;
                        this.syncTransformsToWidget();
                    }
                    this.updatePreview();
                    this.setDirtyCanvas(true, true);
                } catch (err) { alert("Failed to load: " + err.message); }
            };
            reader.readAsText(file);
            this.fileInput.value = "";
        };
        
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            if (onExecuted) onExecuted.apply(this, arguments);
            
            if (message && message.reference_image && message.reference_image.length > 0) {
                const imgInfo = message.reference_image[0];
                if (imgInfo && imgInfo.filename) {
                    const url = api.apiURL(`/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder || "")}&type=${imgInfo.type}`);
                    const img = new Image();
                    img.onload = () => {
                        this.referenceImage = img;
                        // Use the reference image's aspect ratio for the canvas
                        // Keep render resolution reasonable (max 1024 on longest side)
                        const maxDim = 1024;
                        if (img.naturalWidth >= img.naturalHeight) {
                            this.canvasWidth = maxDim;
                            this.canvasHeight = Math.round(maxDim * (img.naturalHeight / img.naturalWidth));
                        } else {
                            this.canvasHeight = maxDim;
                            this.canvasWidth = Math.round(maxDim * (img.naturalWidth / img.naturalHeight));
                        }
                        this.updateCanvasSize();
                    };
                    img.src = url;
                }
            }
            
            // canvas_info from pose data is only used as fallback when no reference image
            if (message && message.canvas_info && message.canvas_info.length > 0) {
                const info = message.canvas_info[0];
                // Only apply if we don't have a reference image already
                // (reference image onload will override with correct aspect ratio)
                if (!this.referenceImage) {
                    this.canvasWidth = info.width || 512;
                    this.canvasHeight = info.height || 512;
                    this.updateCanvasSize();
                }
            }
            
            if (message && message.all_frames && message.all_frames.length > 0) {
                // Deep copy frames to allow manipulation
                this.allFrames = JSON.parse(JSON.stringify(message.all_frames));
                this.currentFrame = 0;
                this.updateFrameLabel();
                this.rebuildCharacterButtons();
                this.updatePreview();
            } else if (message && message.first_frame_keypoints) {
                // Backwards compatibility
                let kp = message.first_frame_keypoints;
                if (Array.isArray(kp) && kp.length > 0) kp = kp[0];
                this.allFrames = [JSON.parse(JSON.stringify(kp))];
                this.currentFrame = 0;
                this.updateFrameLabel();
                this.rebuildCharacterButtons();
                this.updatePreview();
            }
        };
        
        // Rebuild character selection buttons when frame data changes
        nodeType.prototype.rebuildCharacterButtons = function() {
            const frameData = this.allFrames[this.currentFrame];
            const count = frameData?.people?.length || 0;
            
            // Only show accordion if 2+ characters
            if (count < 2) {
                this.charAccordion.style.display = "none";
                this.charCount = count;
                return;
            }
            
            // Show accordion
            this.charAccordion.style.display = "block";
            
            // If count changed, rebuild buttons
            if (count !== this.charCount) {
                this.charCount = count;
                this.charAccordionContent.replaceChildren();
                
                // "All" button
                const allBtn = document.createElement("button");
                allBtn.textContent = "All";
                allBtn.style.cssText = "padding: 4px 10px; font-size: 11px; border: 2px solid #4a9eff; border-radius: 3px; cursor: pointer; background: #4a9eff; color: white;";
                allBtn.addEventListener("click", () => {
                    this.charEditingIdx = null;
                    this.updateCharButtonStyles();
                    this.charAccordionHeader.querySelectorAll("span")[1].textContent = "Editing: All";
                    this.syncCharSelectionToWidget();
                    this.updatePreview();
                });
                this.charAccordionContent.appendChild(allBtn);
                this.charAllBtn = allBtn;
                
                // Separator
                const sep = document.createElement("span");
                sep.textContent = "|";
                sep.style.cssText = "color: #555; margin: 0 6px;";
                this.charAccordionContent.appendChild(sep);
                
                // Initialize enabled state
                for (let i = 0; i < count; i++) {
                    if (this.charEnabled[i] === undefined) this.charEnabled[i] = true;
                }
                
                // Character buttons
                this.charBtns = [];
                for (let i = 0; i < count; i++) {
                    const btn = document.createElement("button");
                    btn.textContent = `#${i + 1}`;
                    btn.dataset.idx = i;
                    btn.style.cssText = "padding: 4px 8px; font-size: 11px; border: 2px solid transparent; border-radius: 3px; cursor: pointer; background: #4a9eff; color: white;";
                    
                    // Click: select for editing
                    btn.addEventListener("click", (e) => {
                        if (e.shiftKey || e.ctrlKey) {
                            // Shift/Ctrl+click: toggle enabled
                            this.charEnabled[i] = !this.charEnabled[i];
                        } else {
                            // Click: select for individual editing (or deselect if already selected)
                            this.charEditingIdx = (this.charEditingIdx === i) ? null : i;
                            const label = this.charEditingIdx !== null ? `Editing: #${this.charEditingIdx + 1}` : "Editing: All";
                            this.charAccordionHeader.querySelectorAll("span")[1].textContent = label;
                        }
                        this.updateCharButtonStyles();
                        this.syncCharSelectionToWidget();
                        this.updatePreview();
                    });
                    
                    // Right-click: toggle enabled
                    btn.addEventListener("contextmenu", (e) => {
                        e.preventDefault();
                        this.charEnabled[i] = !this.charEnabled[i];
                        this.updateCharButtonStyles();
                        this.syncCharSelectionToWidget();
                        this.updatePreview();
                    });
                    
                    this.charAccordionContent.appendChild(btn);
                    this.charBtns.push(btn);
                }
                
                this.updateCharButtonStyles();
            }
        };
        
        // Update character button visual styles
        nodeType.prototype.updateCharButtonStyles = function() {
            if (!this.charBtns) return;
            
            // All button
            const allSelected = this.charEditingIdx === null;
            if (this.charAllBtn) {
                this.charAllBtn.style.background = allSelected ? "#4a9eff" : "#3a3a4a";
                this.charAllBtn.style.borderColor = allSelected ? "#4a9eff" : "transparent";
            }
            
            // Character buttons
            for (let i = 0; i < this.charBtns.length; i++) {
                const btn = this.charBtns[i];
                const enabled = this.charEnabled[i] !== false;
                const selected = this.charEditingIdx === i;
                
                if (!enabled) {
                    btn.style.background = "#333";
                    btn.style.color = "#666";
                    btn.style.borderColor = "transparent";
                    btn.style.textDecoration = "line-through";
                } else if (selected) {
                    btn.style.background = "#4a9eff";
                    btn.style.color = "white";
                    btn.style.borderColor = "#fff";
                    btn.style.textDecoration = "none";
                } else {
                    btn.style.background = "#4a9eff";
                    btn.style.color = "white";
                    btn.style.borderColor = "transparent";
                    btn.style.textDecoration = "none";
                }
            }
        };
        
        // Sync character selection to widget
        nodeType.prototype.syncCharSelectionToWidget = function() {
            const data = {
                enabled: this.charEnabled,
                editingIdx: this.charEditingIdx,
                perChar: this.charPerParams
            };
            const widget = this.widgets?.find(w => w.name === "character_selection");
            if (widget) {
                widget.value = JSON.stringify(data);
            }
        };
        
        nodeType.prototype.updateCanvasSize = function() {
            if (!this.previewCanvas) return;
            const aspectRatio = this.canvasWidth / this.canvasHeight;
            let cw, ch;
            if (aspectRatio >= 1) {
                cw = 1280;
                ch = Math.round(1280 / aspectRatio);
            } else {
                ch = 1280;
                cw = Math.round(1280 * aspectRatio);
            }
            this.previewCanvas.width = cw;
            this.previewCanvas.height = ch;
            this.updatePreview();
        };
        
        const onWidgetChanged = nodeType.prototype.onWidgetChanged;
        nodeType.prototype.onWidgetChanged = function(name, value, old_value, widget) {
            if (onWidgetChanged) onWidgetChanged.apply(this, arguments);
            this.updatePreview();
        };
        
        nodeType.prototype.updatePreview = function() {
            if (!this.previewCtx) return;
            
            const ctx = this.previewCtx;
            const canvas = this.previewCanvas;
            const pw = canvas.width, ph = canvas.height;
            
            // Helper to get widget value
            const getVal = (name, def) => {
                const w = this.widgets?.find(x => x.name === name);
                return w !== undefined ? w.value : def;
            };
            
            const props = {
                head_width: getVal("head_width", 1.0), head_height: getVal("head_height", 1.0),
                head_tilt: getVal("head_tilt", 0.0), neck_length: getVal("neck_length", 1.0),
                shoulder_height: getVal("shoulder_height", 0.0), collarbone_length: getVal("collarbone_length", 1.0),
                arm_angle: getVal("arm_angle", 0.0), upper_arm_length: getVal("upper_arm_length", 1.0),
                forearm_length: getVal("forearm_length", 1.0), torso_length: getVal("torso_length", 1.0),
                torso_tilt: getVal("torso_tilt", 0.0), hip_width: getVal("hip_width", 1.0),
                legs_angle: getVal("legs_angle", 0.0), upper_leg_length: getVal("upper_leg_length", 1.0),
                lower_leg_length: getVal("lower_leg_length", 1.0),
            };
            
            const overallScale = getVal("overall_scale", 1.0);
            const overallRotate = getVal("overall_rotate", 0.0);
            const posX = getVal("position_x", 0.0);
            const posY = getVal("position_y", 0.0);
            
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, pw, ph);
            
            if (this.referenceImage) {
                const imgAspect = this.referenceImage.width / this.referenceImage.height;
                const canvasAspect = pw / ph;
                let dw, dh, dx, dy;
                if (imgAspect > canvasAspect) {
                    dw = pw; dh = pw / imgAspect; dx = 0; dy = (ph - dh) / 2;
                } else {
                    dh = ph; dw = ph * imgAspect; dx = (pw - dw) / 2; dy = 0;
                }
                ctx.globalAlpha = 0.6;
                ctx.drawImage(this.referenceImage, dx, dy, dw, dh);
                ctx.globalAlpha = 1.0;
            }
            
            const frameData = this.allFrames[this.currentFrame];
            
            if (frameData && frameData.people && frameData.people.length > 0) {
                // Render all enabled characters
                for (let pIdx = 0; pIdx < frameData.people.length; pIdx++) {
                    // Skip disabled characters
                    if (this.charEnabled[pIdx] === false) continue;
                    
                    const person = frameData.people[pIdx];
                    if (!person || !person.pose_keypoints_2d) continue;
                    
                    let points = parseKeypoints(person.pose_keypoints_2d);
                    points = applyProportions(points, props, this.canvasWidth, this.canvasHeight);
                    // Apply persistent joint transforms (move/rotate/scale from manual manipulation)
                    points = this.applyJointTransforms(points);
                    points = applyTransform(points, overallScale, overallRotate, posX, posY, this.canvasWidth, this.canvasHeight);
                    
                    const lineWidth = this.drawSize;
                    const pointRadius = this.drawSize + 2;
                    const highlightJoint = this.isDragging ? this.selectedJoint : (this.hoveredJoint || -1);
                    
                    // Dim non-selected characters when editing a specific one
                    if (this.charEditingIdx !== null && this.charEditingIdx !== pIdx) {
                        ctx.globalAlpha = 0.35;
                    }
                    
                    drawSkeleton(ctx, points, pw, ph, this.canvasWidth, this.canvasHeight, lineWidth, pointRadius, this.visibleParts, highlightJoint);
                    
                    // Draw face landmarks: linked to body keypoints (eyes→eyes, jaw→ears, etc.)
                    if (person.face_keypoints_2d && person.face_keypoints_2d.length >= 3) {
                        const scaleX = pw / this.canvasWidth;
                        const scaleY = ph / this.canvasHeight;
                        const origPts = parseKeypoints(person.pose_keypoints_2d);
                        
                        // Face landmark index → body keypoint anchor mapping
                        // Right eye (36-41,68) + right eyebrow (17-21) → body right eye (14)
                        // Left eye (42-47,69) + left eyebrow (22-26) → body left eye (15)
                        // Right jaw (0-7) → body right ear (16)
                        // Left jaw (9-16) → body left ear (17)
                        // Chin (8), nose (27-35), mouth (48-67) → body nose (0)
                        const faceAnchorMap = {};
                        for (let fi = 0; fi <= 7; fi++) faceAnchorMap[fi] = 16;    // right jaw → right ear
                        faceAnchorMap[8] = 0;                                       // chin → nose
                        for (let fi = 9; fi <= 16; fi++) faceAnchorMap[fi] = 17;   // left jaw → left ear
                        for (let fi = 17; fi <= 21; fi++) faceAnchorMap[fi] = 14;  // right eyebrow → right eye
                        for (let fi = 22; fi <= 26; fi++) faceAnchorMap[fi] = 15;  // left eyebrow → left eye
                        for (let fi = 27; fi <= 35; fi++) faceAnchorMap[fi] = 0;   // nose → nose
                        for (let fi = 36; fi <= 41; fi++) faceAnchorMap[fi] = 14;  // right eye → right eye
                        for (let fi = 42; fi <= 47; fi++) faceAnchorMap[fi] = 15;  // left eye → left eye
                        for (let fi = 48; fi <= 67; fi++) faceAnchorMap[fi] = 0;   // mouth → nose
                        faceAnchorMap[68] = 14;  // right pupil → right eye
                        faceAnchorMap[69] = 15;  // left pupil → left eye
                        
                        // Compute per-anchor deltas: transformed position - original position
                        const anchorDeltas = {};
                        for (const bodyIdx of [0, 14, 15, 16, 17]) {
                            const orig = origPts[bodyIdx];
                            const transformed = points[bodyIdx];
                            if (orig && orig[2] > 0 && transformed && transformed[2] > 0) {
                                anchorDeltas[bodyIdx] = {
                                    dx: transformed[0] - orig[0],
                                    dy: transformed[1] - orig[1]
                                };
                            } else {
                                // Fallback to nose delta if anchor is missing
                                const origNose = origPts[0];
                                const newNose = points[0];
                                if (origNose && origNose[2] > 0 && newNose && newNose[2] > 0) {
                                    anchorDeltas[bodyIdx] = {
                                        dx: newNose[0] - origNose[0],
                                        dy: newNose[1] - origNose[1]
                                    };
                                } else {
                                    anchorDeltas[bodyIdx] = { dx: 0, dy: 0 };
                                }
                            }
                        }
                        
                        const facePts = parseKeypoints(person.face_keypoints_2d);
                        const faceR = Math.max(1, pointRadius * 2 / 3);
                        ctx.fillStyle = "#FFFFFF";
                        for (let fi = 0; fi < facePts.length; fi++) {
                            const fp = facePts[fi];
                            if (fp[2] <= 0) continue;
                            const anchor = faceAnchorMap[fi] !== undefined ? faceAnchorMap[fi] : 0;
                            const delta = anchorDeltas[anchor] || { dx: 0, dy: 0 };
                            const fx = (fp[0] + delta.dx) * scaleX;
                            const fy = (fp[1] + delta.dy) * scaleY;
                            ctx.beginPath();
                            ctx.arc(fx, fy, faceR, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                    
                    ctx.globalAlpha = 1.0;
                }
            } else if (this.allFrames.length === 0) {
                ctx.fillStyle = "#666666";
                ctx.font = "14px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("Connect DWPose and run to see preview", pw / 2, ph / 2);
            }
            
            if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
        };
        
        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function(size) {
            if (onResize) onResize.apply(this, arguments);
            this.updateCanvasSize();
        };
        
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            if (onRemoved) onRemoved.apply(this, arguments);
            this.stopPlayback();
        };
    },
});
