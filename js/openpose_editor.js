import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// =============================================================================
// CONSTANTS
// =============================================================================

const KEYPOINT_COLORS = {
    0: "#FF0000", 1: "#FF5500", 2: "#FFAA00", 3: "#FFFF00",
    4: "#AAFF00", 5: "#55FF00", 6: "#00FF00", 7: "#00FF55",
    8: "#00FFAA", 9: "#00FFFF", 10: "#00AAFF", 11: "#0055FF",
    12: "#0000FF", 13: "#5500FF", 14: "#AA00FF", 15: "#FF00FF",
    16: "#FF00AA", 17: "#FF0055",
};

const BONE_CONNECTIONS = [
    [1, 2, "#FF5500"], [1, 5, "#AAFF00"], [2, 3, "#FFAA00"], [3, 4, "#FFFF00"],
    [5, 6, "#55FF00"], [6, 7, "#00FF00"], [1, 8, "#00FF55"], [8, 9, "#00FFAA"],
    [9, 10, "#00FFFF"], [1, 11, "#00AAFF"], [11, 12, "#0055FF"], [12, 13, "#0000FF"],
    [1, 0, "#FF0000"], [0, 14, "#FF00AA"], [14, 16, "#AA00FF"],
    [0, 15, "#FF00FF"], [15, 17, "#5500FF"],
];

const HAND_BONES = [[0,1],[0,5],[0,9],[0,13],[0,17],[1,2],[2,3],[3,4],[5,6],[6,7],[7,8],[9,10],[10,11],[11,12],[13,14],[14,15],[15,16],[17,18],[18,19],[19,20]];
// OpenPose standard finger-color gradients (matches mocap_pose_loader)
const HAND_KP_COLORS = {
    0:"#ffffff",
    1:"#ff0000",2:"#ff3c00",3:"#ff7800",4:"#ffb400",
    5:"#ffc800",6:"#ffdc00",7:"#fff000",8:"#ffff00",
    9:"#00ff00",10:"#00ff50",11:"#00ffa0",12:"#00fff0",
    13:"#00c8ff",14:"#0096ff",15:"#0064ff",16:"#0032ff",
    17:"#c800ff",18:"#9600ff",19:"#6400ff",20:"#3200ff"
};
const HAND_BONE_COLORS = {};
HAND_BONES.forEach(([s,e]) => { HAND_BONE_COLORS[s+","+e] = HAND_KP_COLORS[e] || "#b4b4b4"; });

const FACE_CONTOURS = [[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],[17,18,19,20,21],[22,23,24,25,26],[27,28,29,30],[31,32,33,34,35],[36,37,38,39,40,41,36],[42,43,44,45,46,47,42],[48,49,50,51,52,53,54,55,56,57,58,59,48],[60,61,62,63,64,65,66,67,60]];

const FACE_PARTS = {right_eye:[36,37,38,39,40,41],left_eye:[42,43,44,45,46,47],right_eyebrow:[17,18,19,20,21],left_eyebrow:[22,23,24,25,26],nose_bridge:[27,28,29,30],nose_tip:[31,32,33,34,35],outer_mouth:[48,49,50,51,52,53,54,55,56,57,58,59],inner_mouth:[60,61,62,63,64,65,66,67],jawline:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]};

const RIGHT_PUPIL=68,LEFT_PUPIL=69;
const RIGHT_EYE_TOP=[37,38],RIGHT_EYE_BOTTOM=[40,41],LEFT_EYE_TOP=[43,44],LEFT_EYE_BOTTOM=[46,47];

const BODY_PARTS = {
    head: { indices: [0, 14, 15, 16, 17], label: "Head", bones: [[1, 0], [0, 14], [14, 16], [0, 15], [15, 17]] },
    torso: { indices: [1, 8, 11], label: "Torso", bones: [[1, 8], [1, 11], [1, 2], [1, 5]] },
    left_arm: { indices: [5, 6, 7], label: "L Arm", bones: [[5, 6], [6, 7]] },
    right_arm: { indices: [2, 3, 4], label: "R Arm", bones: [[2, 3], [3, 4]] },
    left_leg: { indices: [12, 13], label: "L Leg", bones: [[11, 12], [12, 13]] },
    right_leg: { indices: [9, 10], label: "R Leg", bones: [[8, 9], [9, 10]] },
};

const FACEHAND_PARTS = { face: { label: "Face" }, left_hand: { label: "L Hand" }, right_hand: { label: "R Hand" } };

const KEYPOINT_CHILDREN = {0:[14,15,16,17],1:[0,2,5,8,11,14,15,16,17],2:[3,4],3:[4],5:[6,7],6:[7],8:[9,10],9:[10],11:[12,13],12:[13]};

const SLIDER_DEFAULTS = {temporal_smoothing:0,spatial_smoothing:0,head_width:1,head_height:1,head_tilt:0,neck_length:1,shoulder_height:0,collarbone_length:1,arm_angle:0,upper_arm_length:1,forearm_length:1,torso_length:1,torso_tilt:0,hip_width:1,legs_angle:0,upper_leg_length:1,lower_leg_length:1,eye_spacing:0,eye_height:0,eye_open:0,eyebrow_height:0,eyebrow_tilt:0,mouth_width:1,mouth_height:1,mouth_position_y:0,smile:0,jaw_width:1,nose_scale:1,face_scale:1,hand_scale:1,hand_rotate:0,overall_scale:1,overall_rotate:0,position_x:0,position_y:0};

// Collapsible slider groups for compact UI
const SLIDER_GROUPS = {
    "▸ Body": ["head_width","head_height","head_tilt","neck_length","shoulder_height","collarbone_length","arm_angle","upper_arm_length","forearm_length","torso_length","torso_tilt","hip_width","legs_angle","upper_leg_length","lower_leg_length"],
    "▸ Face": ["eye_spacing","eye_height","eye_open","eyebrow_height","eyebrow_tilt","mouth_width","mouth_height","mouth_position_y","smile","jaw_width","nose_scale","face_scale"],
    "▸ Hands": ["hand_scale","hand_rotate"],
    "▸ Transform": ["overall_scale","overall_rotate","position_x","position_y","temporal_smoothing","spatial_smoothing"],
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function parseKP(kp) { const pts = []; for (let i = 0; i < kp.length; i += 3) pts.push([kp[i], kp[i+1], kp[i+2]]); return pts; }

function centroid(pts, indices) {
    const valid = indices.filter(i => i < pts.length && pts[i][2] > 0);
    if (!valid.length) return null;
    return [valid.reduce((s, i) => s + pts[i][0], 0) / valid.length, valid.reduce((s, i) => s + pts[i][1], 0) / valid.length];
}

function rotPt(p, pivot, angle) {
    const dx = p[0] - pivot[0], dy = p[1] - pivot[1];
    return [pivot[0] + dx * Math.cos(angle) - dy * Math.sin(angle), pivot[1] + dx * Math.sin(angle) + dy * Math.cos(angle)];
}

function scalePt(p, center, sx, sy) {
    if (sy === undefined) sy = sx;
    return [center[0] + (p[0] - center[0]) * sx, center[1] + (p[1] - center[1]) * sy];
}

function findClosestJoint(points, mouseX, mouseY, scaleX, scaleY, threshold, visibleParts) {
    let closest = -1, minDist = threshold;
    const visiblePoints = new Set();
    if (visibleParts) {
        for (const [partName, partInfo] of Object.entries(BODY_PARTS)) {
            if (visibleParts[partName] !== false) partInfo.indices.forEach(i => visiblePoints.add(i));
        }
    } else {
        for (let i = 0; i < 18; i++) visiblePoints.add(i);
    }
    for (let i = 0; i < Math.min(points.length, 18); i++) {
        if (!visiblePoints.has(i)) continue;
        const p = points[i];
        if (p && p[2] > 0) {
            const dx = p[0] * scaleX - mouseX, dy = p[1] * scaleY - mouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) { minDist = dist; closest = i; }
        }
    }
    return closest;
}

// =============================================================================
// TRANSFORM FUNCTIONS
// =============================================================================

function applyBody(pts, p, cw, ch) {
    pts = pts.map(x => [...x]);
    const sf = (a, t, s, ch = []) => {
        if (pts[a][2] === 0 || pts[t][2] === 0) return;
        const vec = [pts[t][0] - pts[a][0], pts[t][1] - pts[a][1]];
        const np = [pts[a][0] + vec[0] * s, pts[a][1] + vec[1] * s];
        const off = [np[0] - pts[t][0], np[1] - pts[t][1]];
        pts[t][0] = np[0]; pts[t][1] = np[1];
        ch.forEach(c => { if (pts[c][2] > 0) { pts[c][0] += off[0]; pts[c][1] += off[1]; }});
    };
    const ra = (piv, tgt, ang, ch = []) => {
        if (pts[piv][2] === 0 || pts[tgt][2] === 0) return;
        const pivot = [pts[piv][0], pts[piv][1]];
        const np = rotPt([pts[tgt][0], pts[tgt][1]], pivot, ang * Math.PI / 180);
        const off = [np[0] - pts[tgt][0], np[1] - pts[tgt][1]];
        pts[tgt][0] = np[0]; pts[tgt][1] = np[1];
        ch.forEach(c => { if (pts[c][2] > 0) { pts[c][0] += off[0]; pts[c][1] += off[1]; }});
    };
    
    let anchorY = pts[10][2] > 0 ? pts[10][1] : (pts[13][2] > 0 ? pts[13][1] : null);
    
    if (pts[0][2] > 0) {
        const nose = [pts[0][0], pts[0][1]];
        [14, 15, 16, 17].forEach(i => {
            if (pts[i][2] > 0) {
                pts[i][0] = nose[0] + (pts[i][0] - nose[0]) * p.head_width;
                pts[i][1] = nose[1] + (pts[i][1] - nose[1]) * p.head_height;
            }
        });
    }
    
    if (p.head_tilt !== 0 && pts[1][2] > 0) {
        const neck = [pts[1][0], pts[1][1]];
        const a = p.head_tilt * Math.PI / 180;
        [0, 14, 15, 16, 17].forEach(i => {
            if (pts[i][2] > 0) { const np = rotPt([pts[i][0], pts[i][1]], neck, a); pts[i][0] = np[0]; pts[i][1] = np[1]; }
        });
    }
    
    sf(1, 0, p.neck_length, [14, 15, 16, 17]);
    if (p.shoulder_height !== 0) { const off = p.shoulder_height * Math.min(cw, ch) * 0.01; [2, 5].forEach(i => { if (pts[i][2] > 0) pts[i][1] -= off; }); }
    sf(1, 2, p.collarbone_length, [3, 4]); sf(1, 5, p.collarbone_length, [6, 7]);
    if (p.arm_angle !== 0) { ra(2, 3, p.arm_angle, [4]); ra(5, 6, -p.arm_angle, [7]); }
    sf(2, 3, p.upper_arm_length, [4]); sf(5, 6, p.upper_arm_length, [7]); sf(3, 4, p.forearm_length); sf(6, 7, p.forearm_length);
    
    if (p.torso_tilt !== 0 && pts[1][2] > 0) {
        let hc = null;
        if (pts[8][2] > 0 && pts[11][2] > 0) hc = [(pts[8][0] + pts[11][0]) / 2, (pts[8][1] + pts[11][1]) / 2];
        else if (pts[8][2] > 0) hc = [pts[8][0], pts[8][1]];
        else if (pts[11][2] > 0) hc = [pts[11][0], pts[11][1]];
        if (hc) {
            const a = p.torso_tilt * Math.PI / 180;
            [0, 1, 2, 3, 4, 5, 6, 7, 14, 15, 16, 17].forEach(i => {
                if (pts[i][2] > 0) { const np = rotPt([pts[i][0], pts[i][1]], hc, a); pts[i][0] = np[0]; pts[i][1] = np[1]; }
            });
        }
    }
    
    sf(1, 8, p.torso_length, [9, 10]); sf(1, 11, p.torso_length, [12, 13]);
    
    if (pts[8][2] > 0 && pts[11][2] > 0) {
        const hcx = (pts[8][0] + pts[11][0]) / 2;
        const ro = (pts[8][0] - hcx) * (p.hip_width - 1);
        const lo = (pts[11][0] - hcx) * (p.hip_width - 1);
        pts[8][0] += ro; pts[11][0] += lo;
        if (pts[9][2] > 0) pts[9][0] += ro; if (pts[10][2] > 0) pts[10][0] += ro;
        if (pts[12][2] > 0) pts[12][0] += lo; if (pts[13][2] > 0) pts[13][0] += lo;
    }
    
    if (p.legs_angle !== 0) { ra(8, 9, p.legs_angle, [10]); ra(11, 12, -p.legs_angle, [13]); }
    sf(8, 9, p.upper_leg_length, [10]); sf(11, 12, p.upper_leg_length, [13]); sf(9, 10, p.lower_leg_length); sf(12, 13, p.lower_leg_length);
    
    if (anchorY !== null) {
        const cy = pts[10][2] > 0 ? pts[10][1] : (pts[13][2] > 0 ? pts[13][1] : null);
        if (cy !== null) { const off = anchorY - cy; pts.forEach(pt => { if (pt[2] > 0) pt[1] += off; }); }
    }
    return pts;
}

function applyFaceToBody(bpts, fp, cw, ch) {
    if (!bpts || bpts.length < 18) return bpts;
    const e = bpts.map(x => [...x]);
    const s = Math.min(cw, ch);
    if (e[0][2] <= 0) return e;
    const nose = [e[0][0], e[0][1]];
    if (fp.face_scale !== 1) {
        [14, 15, 16, 17].forEach(i => {
            if (e[i][2] > 0) { const np = scalePt([e[i][0], e[i][1]], nose, fp.face_scale); e[i][0] = np[0]; e[i][1] = np[1]; }
        });
    }
    if (fp.eye_spacing !== 0) { const o = fp.eye_spacing * s * 0.05; if (e[14][2] > 0) e[14][0] -= o; if (e[15][2] > 0) e[15][0] += o; }
    if (fp.jaw_width !== 1) { if (e[16][2] > 0) e[16][0] = nose[0] + (e[16][0] - nose[0]) * fp.jaw_width; if (e[17][2] > 0) e[17][0] = nose[0] + (e[17][0] - nose[0]) * fp.jaw_width; }
    return e;
}

function applyTransform(pts, s, r, px, py, cw, ch) {
    if (!pts) return pts;
    pts = pts.map(x => [...x]);
    const valid = pts.filter(p => p[2] > 0);
    if (!valid.length) return pts;
    const sm = valid.flatMap(p => [p[0], p[1]]);
    const isN = Math.max(...sm) <= 1.0;
    const w = isN ? 1.0 : cw, h = isN ? 1.0 : ch;
    const cx = valid.reduce((a, p) => a + p[0], 0) / valid.length;
    const cy = valid.reduce((a, p) => a + p[1], 0) / valid.length;
    const angle = r * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    pts.forEach(p => {
        if (p[2] > 0) {
            const dx = (p[0] - cx) * s, dy = (p[1] - cy) * s;
            p[0] = cx + dx * cos - dy * sin + px * w * 0.5;
            p[1] = cy + dx * sin + dy * cos + py * h * 0.5;
        }
    });
    return pts;
}

function applyFace(fp, p, cw, ch) {
    if (!fp || fp.length < 2) return fp;
    const e = fp.map(x => [...x]);
    const s = Math.min(cw, ch);
    const nPts = e.length;
    
    // ── 48-point mocap format ────────────────────────────────────
    if (nPts < 68) {
        const JAWLINE = [0,1,2,3,4,5,6,7,8];
        const L_BROW = [9,10,11,12,13], R_BROW = [14,15,16,17,18];
        const NOSE_ALL = [19,20,21,22,23,24,25,26,27];
        const L_EYE = [28,29,30,31], R_EYE = [32,33,34,35];
        const OUTER_MOUTH = [36,37,38,39,40,41], INNER_MOUTH = [42,43,44,45];
        const ALL_MOUTH = [...OUTER_MOUTH, ...INNER_MOUTH];

        const origFc = centroid(e, Array.from({length: nPts}, (_, i) => i));
        if (p.face_scale !== 1 && origFc) {
            e.forEach((pt, i) => { if (pt[2] > 0) { const n = scalePt([pt[0], pt[1]], origFc, p.face_scale); e[i][0] = n[0]; e[i][1] = n[1]; }});
        }
        if (p.eye_spacing !== 0) {
            const o = p.eye_spacing * s * 0.05;
            [...R_EYE, ...R_BROW].forEach(i => { if (i < nPts) e[i][0] -= o; });
            [...L_EYE, ...L_BROW].forEach(i => { if (i < nPts) e[i][0] += o; });
        }
        if (p.eye_height !== 0) {
            const o = p.eye_height * s * 0.05;
            [...L_EYE, ...R_EYE, ...L_BROW, ...R_BROW].forEach(i => { if (i < nPts) e[i][1] -= o; });
        }
        if (p.eye_open !== 0) {
            const o = p.eye_open * s * 0.02;
            [29, 33].forEach(i => { if (i < nPts) e[i][1] -= o; });  // top
            [31, 35].forEach(i => { if (i < nPts) e[i][1] += o; });  // bottom
        }
        if (p.eyebrow_height !== 0) {
            const o = p.eyebrow_height * s * 0.05;
            [...L_BROW, ...R_BROW].forEach(i => { if (i < nPts) e[i][1] -= o; });
        }
        if (p.eyebrow_tilt !== 0) {
            const a = p.eyebrow_tilt * Math.PI / 180;
            R_BROW.forEach(i => { const n = rotPt([e[i][0], e[i][1]], [e[14][0], e[14][1]], -a); e[i][0] = n[0]; e[i][1] = n[1]; });
            L_BROW.forEach(i => { const n = rotPt([e[i][0], e[i][1]], [e[9][0], e[9][1]], a); e[i][0] = n[0]; e[i][1] = n[1]; });
        }
        if (p.jaw_width !== 1) {
            const jc = centroid(e, JAWLINE);
            if (jc) JAWLINE.forEach(i => { const n = scalePt([e[i][0], e[i][1]], jc, p.jaw_width, 1); e[i][0] = n[0]; e[i][1] = n[1]; });
        }
        if (p.nose_scale !== 1) {
            const nc = centroid(e, NOSE_ALL);
            if (nc) NOSE_ALL.forEach(i => { const n = scalePt([e[i][0], e[i][1]], nc, p.nose_scale); e[i][0] = n[0]; e[i][1] = n[1]; });
        }
        if (p.mouth_width !== 1) {
            const mc = centroid(e, OUTER_MOUTH);
            if (mc) ALL_MOUTH.forEach(i => { const n = scalePt([e[i][0], e[i][1]], mc, p.mouth_width, 1); e[i][0] = n[0]; e[i][1] = n[1]; });
        }
        if (p.mouth_height !== 1) {
            const mc = centroid(e, OUTER_MOUTH);
            if (mc) ALL_MOUTH.forEach(i => { const n = scalePt([e[i][0], e[i][1]], mc, 1, p.mouth_height); e[i][0] = n[0]; e[i][1] = n[1]; });
        }
        if (p.mouth_position_y !== 0) {
            const o = p.mouth_position_y * s * 0.05;
            ALL_MOUTH.forEach(i => { e[i][1] += o; });
        }
        if (p.smile !== 0) {
            const o = p.smile * s * 0.03;
            e[36][1] -= o; e[40][1] -= o; e[37][1] -= o * 0.5; e[39][1] -= o * 0.5;
        }
        return e;
    }
    
    // ── Standard 68-point OpenPose face editing ──────────────────
    const origFc = centroid(e, Array.from({length: 68}, (_, i) => i));
    
    if (p.face_scale !== 1 && origFc) {
        e.forEach((pt, i) => { if (pt[2] > 0) { const n = scalePt([pt[0], pt[1]], origFc, p.face_scale); e[i][0] = n[0]; e[i][1] = n[1]; }});
    }
    if (p.eye_spacing !== 0) {
        const o = p.eye_spacing * s * 0.05;
        FACE_PARTS.right_eye.forEach(i => { e[i][0] -= o; }); FACE_PARTS.right_eyebrow.forEach(i => { e[i][0] -= o; });
        if (e.length > RIGHT_PUPIL && e[RIGHT_PUPIL][2] > 0) e[RIGHT_PUPIL][0] -= o;
        FACE_PARTS.left_eye.forEach(i => { e[i][0] += o; }); FACE_PARTS.left_eyebrow.forEach(i => { e[i][0] += o; });
        if (e.length > LEFT_PUPIL && e[LEFT_PUPIL][2] > 0) e[LEFT_PUPIL][0] += o;
    }
    if (p.eye_height !== 0) {
        const o = p.eye_height * s * 0.05;
        [...FACE_PARTS.right_eye, ...FACE_PARTS.left_eye, ...FACE_PARTS.right_eyebrow, ...FACE_PARTS.left_eyebrow].forEach(i => { e[i][1] -= o; });
        if (e.length > RIGHT_PUPIL && e[RIGHT_PUPIL][2] > 0) e[RIGHT_PUPIL][1] -= o;
        if (e.length > LEFT_PUPIL && e[LEFT_PUPIL][2] > 0) e[LEFT_PUPIL][1] -= o;
    }
    if (p.eye_open !== 0) {
        const o = p.eye_open * s * 0.02;
        RIGHT_EYE_TOP.forEach(i => { e[i][1] -= o; }); RIGHT_EYE_BOTTOM.forEach(i => { e[i][1] += o; });
        LEFT_EYE_TOP.forEach(i => { e[i][1] -= o; }); LEFT_EYE_BOTTOM.forEach(i => { e[i][1] += o; });
    }
    if (p.eyebrow_height !== 0) { const o = p.eyebrow_height * s * 0.05; [...FACE_PARTS.right_eyebrow, ...FACE_PARTS.left_eyebrow].forEach(i => { e[i][1] -= o; }); }
    if (p.eyebrow_tilt !== 0) {
        const a = p.eyebrow_tilt * Math.PI / 180;
        FACE_PARTS.right_eyebrow.forEach(i => { const n = rotPt([e[i][0], e[i][1]], [e[21][0], e[21][1]], -a); e[i][0] = n[0]; e[i][1] = n[1]; });
        FACE_PARTS.left_eyebrow.forEach(i => { const n = rotPt([e[i][0], e[i][1]], [e[22][0], e[22][1]], a); e[i][0] = n[0]; e[i][1] = n[1]; });
    }
    if (p.jaw_width !== 1) {
        const jc = centroid(e, FACE_PARTS.jawline);
        if (jc) FACE_PARTS.jawline.forEach(i => { const n = scalePt([e[i][0], e[i][1]], jc, p.jaw_width, 1); e[i][0] = n[0]; e[i][1] = n[1]; });
    }
    if (p.nose_scale !== 1) {
        const ni = [...FACE_PARTS.nose_bridge, ...FACE_PARTS.nose_tip];
        const nc = centroid(e, ni);
        if (nc) ni.forEach(i => { const n = scalePt([e[i][0], e[i][1]], nc, p.nose_scale); e[i][0] = n[0]; e[i][1] = n[1]; });
    }
    if (p.mouth_width !== 1) {
        const mc = centroid(e, FACE_PARTS.outer_mouth);
        if (mc) [...FACE_PARTS.outer_mouth, ...FACE_PARTS.inner_mouth].forEach(i => { const n = scalePt([e[i][0], e[i][1]], mc, p.mouth_width, 1); e[i][0] = n[0]; e[i][1] = n[1]; });
    }
    if (p.mouth_height !== 1) {
        const mc = centroid(e, FACE_PARTS.outer_mouth);
        if (mc) [...FACE_PARTS.outer_mouth, ...FACE_PARTS.inner_mouth].forEach(i => { const n = scalePt([e[i][0], e[i][1]], mc, 1, p.mouth_height); e[i][0] = n[0]; e[i][1] = n[1]; });
    }
    if (p.mouth_position_y !== 0) { const o = p.mouth_position_y * s * 0.05; [...FACE_PARTS.outer_mouth, ...FACE_PARTS.inner_mouth].forEach(i => { e[i][1] += o; }); }
    if (p.smile !== 0) {
        const o = p.smile * s * 0.03;
        e[48][1] -= o; e[54][1] -= o; e[49][1] -= o * 0.5; e[53][1] -= o * 0.5; e[59][1] -= o * 0.5; e[55][1] -= o * 0.5;
    }
    return e;
}

function attachFace(fp, origBody, modBody, cw, ch, headWidth, headHeight, overallScale) {
    if (!fp || fp.length < 2) return fp;
    if (!origBody || !modBody || origBody.length <= 1 || modBody.length <= 1) return fp;
    if (origBody[0][2] <= 0 || modBody[0][2] <= 0) return fp;
    
    const nPts = fp.length;
    
    // Compute head rotation from neck→nose angle change
    let rotation = 0;
    if (origBody[1][2] > 0 && modBody[1][2] > 0) {
        const origDx = origBody[0][0] - origBody[1][0], origDy = origBody[0][1] - origBody[1][1];
        const modDx = modBody[0][0] - modBody[1][0], modDy = modBody[0][1] - modBody[1][1];
        if (Math.abs(origDx) > 1 || Math.abs(origDy) > 1) rotation = Math.atan2(modDy, modDx) - Math.atan2(origDy, origDx);
    }
    
    const e = fp.map(x => [...x]);
    const noseIdx = nPts >= 68 ? 30 : 23;
    let anchor = (noseIdx < nPts && e[noseIdx][2] > 0) ? [e[noseIdx][0], e[noseIdx][1]] : null;
    if (!anchor) anchor = [origBody[0][0], origBody[0][1]];
    
    const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
    const scaleX = headWidth * overallScale, scaleY = headHeight * overallScale;
    
    // Face landmark → body keypoint anchor mapping
    // Body: 0=nose, 14=right eye, 15=left eye, 16=right ear, 17=left ear
    // Face: 0-7=right jaw, 8=chin, 9-16=left jaw, 17-21=right eyebrow,
    //        22-26=left eyebrow, 27-35=nose, 36-41=right eye, 42-47=left eye,
    //        48-67=mouth, 68=right pupil, 69=left pupil
    const faceAnchorMap = {};
    if (nPts >= 68) {
        for (let fi = 0; fi <= 7; fi++) faceAnchorMap[fi] = 16;    // right jaw → right ear
        faceAnchorMap[8] = 0;                                       // chin → nose
        for (let fi = 9; fi <= 16; fi++) faceAnchorMap[fi] = 17;   // left jaw → left ear
        for (let fi = 17; fi <= 21; fi++) faceAnchorMap[fi] = 14;  // right eyebrow → right eye
        for (let fi = 22; fi <= 26; fi++) faceAnchorMap[fi] = 15;  // left eyebrow → left eye
        for (let fi = 27; fi <= 35; fi++) faceAnchorMap[fi] = 0;   // nose → nose
        for (let fi = 36; fi <= 41; fi++) faceAnchorMap[fi] = 14;  // right eye → right eye
        for (let fi = 42; fi <= 47; fi++) faceAnchorMap[fi] = 15;  // left eye → left eye
        for (let fi = 48; fi <= 67; fi++) faceAnchorMap[fi] = 0;   // mouth → nose
        if (nPts > 68) faceAnchorMap[68] = 14;  // right pupil
        if (nPts > 69) faceAnchorMap[69] = 15;  // left pupil
    }
    
    // Compute per-anchor target positions in modified body space
    // For anchors 14/15/16/17: use the body keypoint position directly
    // For anchor 0 (nose): use modBody[0]
    const modHead = [modBody[0][0], modBody[0][1]];
    const anchorTargets = { 0: modHead };
    for (const bodyIdx of [14, 15, 16, 17]) {
        if (modBody[bodyIdx] && modBody[bodyIdx][2] > 0 &&
            origBody[bodyIdx] && origBody[bodyIdx][2] > 0) {
            anchorTargets[bodyIdx] = [modBody[bodyIdx][0], modBody[bodyIdx][1]];
        } else {
            anchorTargets[bodyIdx] = modHead; // fallback to nose
        }
    }
    
    // For each face point: scale+rotate relative to face anchor, then position at body target
    e.forEach((p, i) => {
        if (p[2] <= 0) return;
        
        const bodyIdx = faceAnchorMap[i];
        if (bodyIdx !== undefined && bodyIdx !== 0 && anchorTargets[bodyIdx] !== modHead) {
            // This face point is anchored to a specific body keypoint (eye/ear)
            // Compute its offset from face anchor, apply scale+rotate, position at body target
            const target = anchorTargets[bodyIdx];
            // Get this body keypoint's position in original face-space
            const origAnchorBody = origBody[bodyIdx];
            // Offset of face point relative to its body anchor in original space
            const offX = (p[0] - origAnchorBody[0]) * scaleX;
            const offY = (p[1] - origAnchorBody[1]) * scaleY;
            e[i][0] = target[0] + offX * cosR - offY * sinR;
            e[i][1] = target[1] + offX * sinR + offY * cosR;
        } else {
            // Default: anchor to nose (original behavior)
            const x = (p[0] - anchor[0]) * scaleX, y = (p[1] - anchor[1]) * scaleY;
            e[i][0] = modHead[0] + x * cosR - y * sinR;
            e[i][1] = modHead[1] + x * sinR + y * cosR;
        }
    });
    return e;
}

function applyHand(hp, p, cw, ch, isLeft) {
    if (!hp || hp.length < 21) return hp;
    const e = hp.map(x => [...x]);
    const wrist = e[0][2] > 0 ? [e[0][0], e[0][1]] : null;
    if (!wrist) return e;
    if (p.hand_scale !== 1) {
        for (let i = 1; i < 21; i++) {
            if (e[i][2] > 0) { const n = scalePt([e[i][0], e[i][1]], wrist, p.hand_scale); e[i][0] = n[0]; e[i][1] = n[1]; }
        }
    }
    if (p.hand_rotate !== 0) {
        const a = (isLeft ? p.hand_rotate : -p.hand_rotate) * Math.PI / 180;
        for (let i = 1; i < 21; i++) {
            if (e[i][2] > 0) { const n = rotPt([e[i][0], e[i][1]], wrist, a); e[i][0] = n[0]; e[i][1] = n[1]; }
        }
    }
    return e;
}

function attachHandToWrist(hp, wristPos) {
    if (!hp || hp.length < 1 || hp[0][2] <= 0) return hp;
    const e = hp.map(x => [...x]);
    const ox = wristPos[0] - e[0][0], oy = wristPos[1] - e[0][1];
    e.forEach(p => { if (p[2] > 0) { p[0] += ox; p[1] += oy; }});
    return e;
}

// =============================================================================
// DRAWING FUNCTIONS
// =============================================================================

function drawBody(ctx, pts, scaleX, scaleY, lw, pr, visibility, highlightJoint) {
    // Always scale points from canvasWidth/canvasHeight space to previewCanvas pixel space
    pts = pts.map(p => [p[0] * scaleX, p[1] * scaleY, p[2]]);
    
    const partBones = {head:[[1,0],[0,14],[14,16],[0,15],[15,17]],torso:[[1,2],[1,5],[1,8],[1,11]],left_arm:[[5,6],[6,7]],right_arm:[[2,3],[3,4]],left_leg:[[11,12],[12,13]],right_leg:[[8,9],[9,10]]};
    const partPoints = {head:[0,14,15,16,17],torso:[1,8,11],left_arm:[5,6,7],right_arm:[2,3,4],left_leg:[11,12,13],right_leg:[8,9,10]};
    
    ctx.lineWidth = lw;
    BONE_CONNECTIONS.forEach(([s, e, color]) => {
        let visible = true;
        for (const [part, bones] of Object.entries(partBones)) {
            if (bones.some(([a, b]) => (a === s && b === e) || (a === e && b === s))) {
                if (visibility[part] === false) { visible = false; break; }
            }
        }
        if (!visible) return;
        if (s < pts.length && e < pts.length && pts[s][2] > 0 && pts[e][2] > 0) {
            ctx.beginPath(); ctx.moveTo(pts[s][0], pts[s][1]); ctx.lineTo(pts[e][0], pts[e][1]); ctx.strokeStyle = color; ctx.stroke();
        }
    });
    
    pts.forEach((p, idx) => {
        if (p[2] <= 0 || !KEYPOINT_COLORS[idx]) return;
        let visible = true;
        for (const [part, points] of Object.entries(partPoints)) {
            if (points.includes(idx) && visibility[part] === false) { visible = false; break; }
        }
        if (!visible) return;
        if (idx === highlightJoint) { ctx.beginPath(); ctx.arc(p[0], p[1], pr + 4, 0, Math.PI * 2); ctx.fillStyle = "#FFFFFF"; ctx.fill(); }
        ctx.beginPath(); ctx.arc(p[0], p[1], pr, 0, Math.PI * 2); ctx.fillStyle = KEYPOINT_COLORS[idx]; ctx.fill();
    });
}

function drawFace(ctx, pts, scaleX, scaleY, lw) {
    if (!pts || pts.length < 2) return;
    pts = pts.map(p => [p[0] * scaleX, p[1] * scaleY, p[2]]);
    
    // Draw contour connections only for standard 68-point OpenPose format
    if (pts.length >= 68) {
        ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = lw;
        FACE_CONTOURS.forEach(contour => {
            for (let i = 0; i < contour.length - 1; i++) {
                const i1 = contour[i], i2 = contour[i + 1];
                if (i1 < pts.length && i2 < pts.length && pts[i1][2] > 0 && pts[i2][2] > 0) {
                    ctx.beginPath(); ctx.moveTo(pts[i1][0], pts[i1][1]); ctx.lineTo(pts[i2][0], pts[i2][1]); ctx.stroke();
                }
            }
        });
    }
    // Draw dots for any face format (48-point mocap, 68-point OpenPose)
    const dotR = pts.length < 68 ? lw * 0.6 : lw * 0.8;
    pts.forEach(p => { if (p[2] > 0) { ctx.beginPath(); ctx.arc(p[0], p[1], dotR, 0, Math.PI * 2); ctx.fillStyle = "#FFFFFF"; ctx.fill(); }});
}

function drawHand(ctx, pts, scaleX, scaleY, lw) {
    if (!pts || pts.length < 21) return;
    pts = pts.map(p => [p[0] * scaleX, p[1] * scaleY, p[2]]);
    
    ctx.lineWidth = lw;
    HAND_BONES.forEach(([s, e]) => {
        if (s < pts.length && e < pts.length && pts[s][2] > 0 && pts[e][2] > 0) {
            ctx.beginPath(); ctx.moveTo(pts[s][0], pts[s][1]); ctx.lineTo(pts[e][0], pts[e][1]);
            ctx.strokeStyle = HAND_BONE_COLORS[s+","+e] || HAND_KP_COLORS[e] || "#b4b4b4"; ctx.stroke();
        }
    });
    pts.forEach((p, i) => { if (p[2] > 0) { ctx.beginPath(); ctx.arc(p[0], p[1], lw * 1.0, 0, Math.PI * 2); ctx.fillStyle = HAND_KP_COLORS[i] || "#b4b4b4"; ctx.fill(); }});
}

// =============================================================================
// MAIN EXTENSION
// =============================================================================

app.registerExtension({
    name: "ComfyVFX.OpenPoseProportionalEditor",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ComfyVFX_OpenPoseProportionalEditor") return;
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);
            
            this.previewContainer = document.createElement("div");
            this.previewContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px; width: 100%;";
            
            // Visibility toggles - will be placed in sidebar
            this.visibleParts = { head: true, torso: true, left_arm: true, right_arm: true, left_leg: true, right_leg: true, face: true, left_hand: true, right_hand: true };
            
            this.visibilityContainer = document.createElement("div");
            this.visibilityContainer.style.cssText = "display: flex; flex-direction: column; gap: 3px; padding: 6px; background: #2a2a2a; border-radius: 4px; min-width: 70px;";
            
            // Label for visibility section
            const visLabel = document.createElement("div");
            visLabel.textContent = "Visibility";
            visLabel.style.cssText = "color: #888; font-size: 10px; text-align: center; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px;";
            this.visibilityContainer.appendChild(visLabel);
            
            const allParts = { ...BODY_PARTS, ...FACEHAND_PARTS };
            for (const [key, part] of Object.entries(allParts)) {
                const btn = document.createElement("button");
                btn.textContent = part.label;
                btn.dataset.part = key;
                btn.style.cssText = "padding: 4px 6px; font-size: 10px; border: none; border-radius: 3px; cursor: pointer; background: #4a9eff; color: white; width: 100%;";
                btn.addEventListener("click", () => {
                    const vis = this.getActiveVisibleParts();
                    vis[key] = !vis[key];
                    btn.style.background = vis[key] ? "#4a9eff" : "#444";
                    this.syncVisibilityToWidget();
                    this.syncCharSelectionToWidget();
                    this.updatePreview();
                });
                this.visibilityContainer.appendChild(btn);
            }
            
            // ========== CHARACTER SELECTION (Accordion) ==========
            this.charEnabled = {};  // {idx: bool} - which chars are in output
            this.charEditingIdx = null;  // which char is being individually edited (null = all)
            this.charPerParams = {};  // {idx: {param: value}} - per-character overrides
            this.charCount = 0;
            this.charBtns = [];
            
            this.charAccordion = document.createElement("div");
            this.charAccordion.style.cssText = "background: #1e1e2e; border-radius: 4px; margin: 4px 0; overflow: hidden;";
            
            this.charAccordionHeader = document.createElement("div");
            this.charAccordionHeader.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; cursor: pointer; background: #2a2a3a; user-select: none;";
            { this.charAccordionHeader.replaceChildren(); const _s1=document.createElement('span'); _s1.style.cssText='color:#aaa;font-size:11px;font-weight:bold;'; _s1.textContent='▶ Characters'; const _s2=document.createElement('span'); _s2.style.cssText='color:#4a9eff;font-size:11px;'; _s2.textContent='Editing: All'; this.charAccordionHeader.appendChild(_s1); this.charAccordionHeader.appendChild(_s2); }
            this.charAccordionExpanded = true;  // Start expanded
            
            this.charAccordionHeader.addEventListener("click", () => {
                this.charAccordionExpanded = !this.charAccordionExpanded;
                this.charAccordionContent.style.display = this.charAccordionExpanded ? "flex" : "none";
                this.charAccordionHeader.querySelector("span").textContent = (this.charAccordionExpanded ? "▼" : "▶") + " Characters";
            });
            
            this.charAccordionContent = document.createElement("div");
            this.charAccordionContent.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; align-items: center;";
            { this.charAccordionContent.replaceChildren(); const _s=document.createElement('span'); _s.style.cssText='color:#666;font-size:11px;'; _s.textContent='Run node to detect characters'; this.charAccordionContent.appendChild(_s); }
            
            this.charAccordion.appendChild(this.charAccordionHeader);
            this.charAccordion.appendChild(this.charAccordionContent);
            // Update header to show expanded state
            this.charAccordionHeader.querySelector("span").textContent = "▼ Characters";
            // ========== END CHARACTER SELECTION ==========
            
            // Tool selection container
            this.toolContainer = document.createElement("div");
            this.toolContainer.style.cssText = "display: flex; gap: 4px; justify-content: center; padding: 4px;";
            
            this.currentTool = "move";
            
            const moveBtn = document.createElement("button");
            moveBtn.textContent = "✥ Move";
            moveBtn.style.cssText = "padding: 6px 12px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; background: #4a9eff; color: white;";
            
            const rotateBtn = document.createElement("button");
            rotateBtn.textContent = "↻ Rotate";
            rotateBtn.style.cssText = "padding: 6px 12px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; background: #4a4a4a; color: white;";
            
            const scaleBtn = document.createElement("button");
            scaleBtn.textContent = "⤢ Scale";
            scaleBtn.style.cssText = "padding: 6px 12px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; background: #4a4a4a; color: white;";
            
            moveBtn.addEventListener("click", () => { this.currentTool = "move"; moveBtn.style.background = "#4a9eff"; rotateBtn.style.background = "#4a4a4a"; scaleBtn.style.background = "#4a4a4a"; });
            rotateBtn.addEventListener("click", () => { this.currentTool = "rotate"; rotateBtn.style.background = "#4a9eff"; moveBtn.style.background = "#4a4a4a"; scaleBtn.style.background = "#4a4a4a"; });
            scaleBtn.addEventListener("click", () => { this.currentTool = "scale"; scaleBtn.style.background = "#4a9eff"; moveBtn.style.background = "#4a4a4a"; rotateBtn.style.background = "#4a4a4a"; });
            
            this.toolContainer.appendChild(moveBtn);
            this.toolContainer.appendChild(rotateBtn);
            this.toolContainer.appendChild(scaleBtn);
            this.moveBtn = moveBtn; this.rotateBtn = rotateBtn; this.scaleBtn = scaleBtn;
            
            // Size control
            this.sizeContainer = document.createElement("div");
            this.sizeContainer.style.cssText = "display: flex; gap: 8px; align-items: center; justify-content: center;";
            
            this.sizeLabel = document.createElement("span");
            this.sizeLabel.textContent = "Size: 5";
            this.sizeLabel.style.cssText = "color: #ccc; font-size: 12px; min-width: 60px;";
            
            this.sizeSlider = document.createElement("input");
            this.sizeSlider.type = "range"; this.sizeSlider.min = "1"; this.sizeSlider.max = "20"; this.sizeSlider.value = "5";
            this.sizeSlider.style.cssText = "width: 150px;";
            this.sizeSlider.addEventListener("input", () => {
                this.drawSize = parseInt(this.sizeSlider.value);
                this.sizeLabel.textContent = `Size: ${this.drawSize}`;
                this.updatePreview();
            });
            
            this.sizeContainer.appendChild(this.sizeLabel);
            this.sizeContainer.appendChild(this.sizeSlider);
            
            // Canvas
            this.previewCanvas = document.createElement("canvas");
            this.previewCanvas.width = 1280; this.previewCanvas.height = 1280;
            this.previewCanvas.style.cssText = "border: 1px solid #444; border-radius: 4px; flex: 1; height: auto; cursor: crosshair; min-width: 0;";
            this.previewCtx = this.previewCanvas.getContext("2d");
            
            // Interactive joint manipulation state
            this.selectedJoint = -1;
            this.hoveredJoint = -1;
            this.isDragging = false;
            this.dragStartPos = null;
            this.dragStartTransform = null;
            this.jointTransforms = {};  // Global joint transforms (used when editing All)
            this.perCharJointTransforms = {};  // {charIdx: {jointIdx: transform}}
            this.perCharVisibleParts = {};  // {charIdx: {partName: bool}}
            
            // Mouse event handlers
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
            this.resetBtn.addEventListener("click", () => {
                try {
                // Reset all sliders to defaults — update both widget value AND custom UI
                for (const w of this.widgets || []) {
                    if (SLIDER_DEFAULTS[w.name] !== undefined) {
                        const def = SLIDER_DEFAULTS[w.name];
                        w.value = def;
                        if (w._sectionSlider) w._sectionSlider.value = def;
                        if (w._sectionDisplay) w._sectionDisplay.textContent = parseFloat(def).toFixed(2);
                    }
                }
                // Reset keyframes FIRST (before sync, so getVal reads widget defaults)
                this.paramKeyframes = {};
                this.selectedKF = -1;
                // Reset joint transforms
                this.jointTransforms = {};
                this.perCharJointTransforms = {};
                // Reset visibility
                this.visibleParts = { head: true, torso: true, left_arm: true, right_arm: true, left_leg: true, right_leg: true, face: true, left_hand: true, right_hand: true };
                this.perCharVisibleParts = {};
                for (const btn of this.visibilityContainer.children) btn.style.background = "#4a9eff";
                // Reset character selection
                this.charEnabled = {};
                this.charEditingIdx = null;
                this.charPerParams = {};
                this.charCount = 0;
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
                this.dragCharIdx = null;
                // Reset playback
                this.isPlaying = false;
                this.playPauseBtn.textContent = "▶";
                if (this.playbackInterval) { clearInterval(this.playbackInterval); this.playbackInterval = null; }
                this.currentFrame = 0;
                // Reset draw size
                this.drawSize = 5;
                if (this.sizeSlider) { this.sizeSlider.value = "5"; }
                if (this.sizeLabel) { this.sizeLabel.textContent = "Size: 5"; }
                // Reset background opacity
                this.bgOpacity = 0.6;
                // Sync all state to hidden widgets
                const jtW = this.widgets?.find(w => w.name === "joint_transforms");
                if (jtW) jtW.value = JSON.stringify({ global: {}, perChar: {} });
                const vpW = this.widgets?.find(w => w.name === "visible_parts");
                if (vpW) vpW.value = JSON.stringify(this.visibleParts);
                const csW = this.widgets?.find(w => w.name === "character_selection");
                if (csW) csW.value = JSON.stringify({ enabled: {}, editingIdx: null, perChar: {} });
                const pkW = this.widgets?.find(w => w.name === "param_keyframes");
                if (pkW) pkW.value = JSON.stringify({});
                // Update frame label directly
                this.frameLabel.textContent = `Frame: 1/${Math.max(1, this.allFrames.length)}`;
                // Rebuild character buttons
                this.charAccordionContent.replaceChildren();
                this.charBtns = [];
                const count = this.allFrames[0]?.people?.length || 0;
                if (count <= 1) {
                    const _s = document.createElement("span");
                    _s.style.cssText = "color:#888;font-size:11px;";
                    _s.textContent = count === 1 ? "Single character detected" : "Run node to detect characters";
                    this.charAccordionContent.appendChild(_s);
                }
                // Refresh keyframe diamonds on sliders
                for (const w of this.widgets || []) {
                    if (w._diamondLayer && SLIDER_DEFAULTS[w.name] !== undefined) {
                        w._diamondLayer.replaceChildren();
                    }
                }
                // Redraw preview
                if (typeof this.updatePreview === "function") this.updatePreview();
                if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
                } catch (err) { console.error("[OpenPose Editor] Reset All error:", err); }
            });
            
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
            this.fileInput.type = "file"; this.fileInput.accept = ".json"; this.fileInput.style.display = "none";
            this.fileInput.addEventListener("change", (e) => this.handleFileImport(e));
            
            this.buttonContainer.appendChild(this.resetBtn);
            this.buttonContainer.appendChild(this.exportBtn);
            this.buttonContainer.appendChild(this.importBtn);
            this.buttonContainer.appendChild(this.fileInput);
            
            // Create horizontal wrapper for sidebar + canvas
            this.canvasRow = document.createElement("div");
            this.canvasRow.style.cssText = "display: flex; gap: 8px; align-items: stretch;";
            
            // Canvas wrapper to maintain aspect ratio
            this.canvasWrapper = document.createElement("div");
            this.canvasWrapper.style.cssText = "flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center;";
            this.canvasWrapper.appendChild(this.previewCanvas);
            
            this.canvasRow.appendChild(this.visibilityContainer);
            this.canvasRow.appendChild(this.canvasWrapper);
            
            // ── Keyframe Timeline ──
            // Keyframe controls — simplified, per-slider diamonds are in the accordion sections
            this.kfContainer = document.createElement("div");
            this.kfContainer.style.cssText = "display: flex; gap: 8px; justify-content: center; align-items: center; padding: 4px;";
            
            this.kfClearBtn = document.createElement("button");
            this.kfClearBtn.textContent = "Clear All Keyframes";
            this.kfClearBtn.style.cssText = "padding: 4px 12px; font-size: 10px; border: none; border-radius: 3px; cursor: pointer; background: #8B0000; color: white;";
            this.kfClearBtn.addEventListener("click", () => {
                // Clear global keyframes only
                this.paramKeyframes = {};
                this.selectedKF = -1;
                // Clear per-character keyframes (but keep their static overrides)
                for (const idx in this.charPerParams) {
                    if (this.charPerParams[idx]?._keyframes) {
                        delete this.charPerParams[idx]._keyframes;
                    }
                }
                this.syncParamKeyframesToWidget();
                this.syncCharSelectionToWidget();
                this.refreshAllSliderKeyframes();
                this.updatePreview();
            });
            
            this.kfContainer.appendChild(this.kfClearBtn);
            
            // Assemble preview container
            this.previewContainer.appendChild(this.charAccordion);
            this.previewContainer.appendChild(this.toolContainer);
            this.previewContainer.appendChild(this.sizeContainer);
            this.previewContainer.appendChild(this.canvasRow);
            this.previewContainer.appendChild(this.playbackContainer);
            this.previewContainer.appendChild(this.kfContainer);
            this.previewContainer.appendChild(this.buttonContainer);
            
            // State
            this.referenceImage = null;
            this.bgFrames = [];
            this.bgOpacity = 0.6;
            this.allFrames = [];
            this.currentFrame = 0;
            this.isPlaying = false;
            this.playbackInterval = null;
            this.drawSize = 5;
            this.canvasWidth = 512;
            this.canvasHeight = 512;
            this.fps = 24;
            this.paramKeyframes = {};  // {paramName: [{frame, value, easing}, ...]}
            this.selectedKF = -1;
            
            this.addDOMWidget("preview", "div", this.previewContainer, { 
                serialize: false, 
                hideOnZoom: false,
                // Prevent Nodes 2.0 from hiding the widget when partially off-screen
                getMinHeight: () => 100,
            });
            this.setSize([450, 1500]);
            
            // Workaround: Nodes 2.0 Vue rendering hides DOM widgets when the node's
            // top edge goes off-screen. We use a MutationObserver to force-visible,
            // but ONLY when the node is still partially in the canvas viewport.
            // We check LiteGraph node pos/size against the canvas view (not DOM rect,
            // which returns zeros when the element is already hidden).
            const domWidget = this.widgets?.[this.widgets.length - 1];
            if (domWidget?.element) {
                const el = domWidget.element;
                const nodeRef = this; // reference to the LGraphNode
                const observer = new MutationObserver((mutations) => {
                    // Use LiteGraph's own coordinate system to check visibility.
                    // node.pos = [x, y] in graph coords, node.size = [w, h]
                    // app.canvas = LGraphCanvas instance with visible_area or ds (offset/scale)
                    try {
                        const lgCanvas = window.app?.canvas || window.LGraphCanvas?.active;
                        if (lgCanvas && nodeRef.pos && nodeRef.size) {
                            const ds = lgCanvas.ds || { offset: [0, 0], scale: 1 };
                            const scale = ds.scale || 1;
                            const offsetX = ds.offset?.[0] || 0;
                            const offsetY = ds.offset?.[1] || 0;
                            // Convert node position to screen coordinates
                            const screenX = nodeRef.pos[0] * scale + offsetX;
                            const screenY = nodeRef.pos[1] * scale + offsetY;
                            const screenW = nodeRef.size[0] * scale;
                            const screenH = nodeRef.size[1] * scale;
                            // Check if node rect overlaps the viewport at all
                            const inView = (screenX + screenW) > 0 && screenX < window.innerWidth
                                        && (screenY + screenH) > 0 && screenY < window.innerHeight;
                            if (!inView) return; // Fully off-screen — let ComfyUI hide it
                        }
                    } catch(e) { /* If we can't determine, err on side of keeping visible */ }
                    
                    for (const m of mutations) {
                        if (m.type === "attributes" && m.attributeName === "style") {
                            const target = m.target;
                            if (target.style.display === "none" || target.style.visibility === "hidden") {
                                target.style.display = "";
                                target.style.visibility = "visible";
                            }
                        }
                    }
                });
                // Observe the widget element and a few parent containers
                const watchEl = (e, depth) => {
                    if (!e || depth > 3) return;
                    observer.observe(e, { attributes: true, attributeFilter: ["style"] });
                    if (e.parentElement && e.parentElement !== document.body) watchEl(e.parentElement, depth + 1);
                };
                setTimeout(() => watchEl(el, 0), 500);
            }
            
            // Hide internal widgets and setup callbacks
            setTimeout(() => {
                const hiddenNames = new Set(["joint_transforms", "visible_parts", "character_selection", "param_keyframes"]);
                const sliderNames = new Set(Object.keys(SLIDER_DEFAULTS));
                // Also hide fps, frame_multiplier, bg_opacity as we'll put them in a section
                const extraHide = new Set(["fps", "frame_multiplier", "bg_opacity"]);
                
                for (const w of this.widgets || []) {
                    if (hiddenNames.has(w.name) || sliderNames.has(w.name) || extraHide.has(w.name)) {
                        if (w.element) w.element.style.display = "none";
                        if (w.inputEl) w.inputEl.style.display = "none";
                        w.computeSize = () => [0, -4];
                    }
                    if (sliderNames.has(w.name)) {
                        const origCallback = w.callback;
                        w.callback = (value) => { if (origCallback) origCallback.call(w, value); this.updatePreview(); };
                    }
                }
                
                // Build collapsible section UI inside the DOM widget
                this._buildSliderSections();
                
                this.loadTransformsFromWidget();
                this.loadVisibilityFromWidget();
                this.loadCharSelectionFromWidget();
                this.loadParamKeyframesFromWidget();
                this.updatePreview();
            }, 100);
        };
        
        // ── Build collapsible slider sections inside the preview container ──
        nodeType.prototype._buildSliderSections = function() {
            // Insert sections container before the tool buttons
            if (this._sectionsContainer) this._sectionsContainer.remove();
            this._sectionsContainer = document.createElement("div");
            this._sectionsContainer.style.cssText = "display: flex; flex-direction: column; gap: 2px; margin-top: 12px; margin-bottom: 4px;";
            
            // Insert before the character_selection widget area (after the inputs, before the canvas area)
            const charAccordion = this.charAccordion || this.toolContainer;
            if (charAccordion && charAccordion.parentNode) {
                charAccordion.parentNode.insertBefore(this._sectionsContainer, charAccordion);
            } else {
                this.previewContainer.insertBefore(this._sectionsContainer, this.previewContainer.firstChild);
            }
            
            let openSection = null;
            
            for (const [groupLabel, paramNames] of Object.entries(SLIDER_GROUPS)) {
                const section = document.createElement("div");
                section.style.cssText = "background: #1e1e1e; border: 1px solid #333; border-radius: 4px; overflow: hidden;";
                
                // Header (click to toggle)
                const header = document.createElement("div");
                header.style.cssText = "padding: 6px 10px; cursor: pointer; font-size: 12px; font-weight: 600; color: #ccc; background: #2a2a2a; display: flex; justify-content: space-between; align-items: center; user-select: none;";
                header.textContent = groupLabel;
                
                const badge = document.createElement("span");
                badge.style.cssText = "font-size: 10px; color: #666; font-weight: normal;";
                badge.textContent = `${paramNames.length} params`;
                header.appendChild(badge);
                
                // Content (hidden by default)
                const content = document.createElement("div");
                content.style.cssText = "display: none; padding: 4px 8px;";
                
                // Build mini sliders for each param — with per-slider keyframe diamonds
                for (const pName of paramNames) {
                    const w = this.widgets?.find(x => x.name === pName);
                    if (!w) continue;
                    
                    const row = document.createElement("div");
                    row.style.cssText = "display: flex; align-items: center; gap: 4px; padding: 2px 0; font-size: 11px;";
                    
                    const label = document.createElement("span");
                    label.style.cssText = "color: #999; min-width: 90px; font-size: 10px;";
                    label.textContent = pName.replace(/_/g, " ");
                    label.title = pName;
                    
                    // Slider + diamond overlay wrapper
                    const sliderWrap = document.createElement("div");
                    sliderWrap.style.cssText = "flex: 1; position: relative; height: 18px; display: flex; align-items: center;";
                    
                    const slider = document.createElement("input");
                    slider.type = "range";
                    slider.min = w.options?.min ?? 0;
                    slider.max = w.options?.max ?? 1;
                    slider.step = 0.01;
                    slider.value = w.value;
                    slider.style.cssText = "width: 100%; height: 4px; accent-color: #4a9eff; cursor: pointer; position: relative; z-index: 2;";
                    
                    // Diamond overlay — keyframe markers rendered on the slider track
                    const diamondLayer = document.createElement("div");
                    diamondLayer.style.cssText = "position: absolute; top: 0; left: 8px; right: 8px; height: 100%; pointer-events: none; z-index: 3;";
                    diamondLayer.dataset.param = pName;
                    
                    sliderWrap.append(slider, diamondLayer);
                    
                    const valDisplay = document.createElement("span");
                    valDisplay.style.cssText = "color: #ddd; min-width: 36px; text-align: right; font-family: Consolas, monospace; font-size: 10px;";
                    valDisplay.textContent = parseFloat(w.value).toFixed(2);
                    
                    // Keyframe toggle button (diamond icon)
                    const kfBtn = document.createElement("span");
                    kfBtn.textContent = "◆";
                    kfBtn.style.cssText = "cursor: pointer; color: #555; font-size: 11px; padding: 0 1px; user-select: none; line-height: 1;";
                    kfBtn.title = "Add/remove keyframe at current frame";
                    kfBtn.addEventListener("click", () => {
                        this.toggleSliderKeyframe(pName, parseFloat(slider.value));
                        this.refreshSliderKeyframeDiamonds(pName, diamondLayer);
                        this.syncParamKeyframesToWidget();
                    });
                    
                    // Sync slider → widget
                    slider.addEventListener("input", () => {
                        const v = parseFloat(slider.value);
                        if (this.charEditingIdx !== null) {
                            const idxStr = String(this.charEditingIdx);
                            if (!this.charPerParams[idxStr]) this.charPerParams[idxStr] = {};
                            this.charPerParams[idxStr][pName] = v;
                            this.syncCharSelectionToWidget();
                        } else {
                            w.value = v;
                            if (w.callback) w.callback(v);
                        }
                        valDisplay.textContent = v.toFixed(2);
                        this.updateKeyframeValueAtCurrentFrame(pName, v);
                        this.updatePreview();
                    });
                    
                    // Double-click to reset
                    slider.addEventListener("dblclick", () => {
                        const def = SLIDER_DEFAULTS[pName] ?? 0;
                        slider.value = def;
                        if (this.charEditingIdx !== null) {
                            const idxStr = String(this.charEditingIdx);
                            if (this.charPerParams[idxStr]) { delete this.charPerParams[idxStr][pName]; }
                            this.syncCharSelectionToWidget();
                        } else {
                            w.value = def;
                            if (w.callback) w.callback(def);
                        }
                        valDisplay.textContent = def.toFixed(2);
                        this.updatePreview();
                    });
                    slider.title = "Double-click to reset. ◆ = keyframe.";
                    
                    row.append(label, sliderWrap, valDisplay, kfBtn);
                    content.appendChild(row);
                    
                    w._sectionSlider = slider;
                    w._sectionDisplay = valDisplay;
                    w._diamondLayer = diamondLayer;
                }
                
                // Also add fps, frame_multiplier, bg_opacity to Transform section
                if (groupLabel.includes("Transform")) {
                    for (const extraName of ["fps", "frame_multiplier", "bg_opacity"]) {
                        const w = this.widgets?.find(x => x.name === extraName);
                        if (!w) continue;
                        const row = document.createElement("div");
                        row.style.cssText = "display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 11px;";
                        const label = document.createElement("span");
                        label.style.cssText = "color: #999; min-width: 100px; font-size: 10px;";
                        label.textContent = extraName.replace(/_/g, " ");
                        const slider = document.createElement("input");
                        slider.type = "range";
                        slider.min = w.options?.min ?? 0;
                        slider.max = w.options?.max ?? 1;
                        slider.step = 0.01;  // Always smooth
                        slider.value = w.value;
                        slider.style.cssText = "flex: 1; height: 4px; accent-color: #4a9eff; cursor: pointer;";
                        const valDisplay = document.createElement("span");
                        valDisplay.style.cssText = "color: #ddd; min-width: 40px; text-align: right; font-family: Consolas, monospace; font-size: 10px;";
                        valDisplay.textContent = parseFloat(w.value).toFixed(2);
                        slider.addEventListener("input", () => {
                            const v = parseFloat(slider.value);
                            w.value = v;
                            valDisplay.textContent = v.toFixed(2);
                            if (w.callback) w.callback(v);
                        });
                        row.append(label, slider, valDisplay);
                        content.appendChild(row);
                        w._sectionSlider = slider;
                        w._sectionDisplay = valDisplay;
                    }
                }
                
                // Toggle
                header.addEventListener("click", () => {
                    const isOpen = content.style.display !== "none";
                    if (isOpen) {
                        content.style.display = "none";
                        header.textContent = groupLabel;
                        header.appendChild(badge);
                    } else {
                        // Close other sections (accordion)
                        if (openSection && openSection !== content) {
                            openSection.style.display = "none";
                            openSection.parentElement.querySelector("div").textContent = openSection._groupLabel;
                            openSection.parentElement.querySelector("div").appendChild(openSection._badge);
                        }
                        content.style.display = "block";
                        header.textContent = groupLabel.replace("▸", "▾");
                        header.appendChild(badge);
                        openSection = content;
                        content._groupLabel = groupLabel;
                        content._badge = badge;
                    }
                    // Resize node — only GROW, never shrink height.
                    // Nodes 2.0 uses the node's size for visibility culling. If we shrink
                    // the node, the DOM widget overflows below the node frame and the node
                    // gets hidden as soon as the (now-small) frame goes off-screen.
                    const sz = this.computeSize();
                    const newW = Math.max(this.size[0], sz[0]);
                    const newH = Math.max(this.size[1], sz[1]);
                    this.setSize([newW, newH]);
                    if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
                });
                
                section.append(header, content);
                this._sectionsContainer.appendChild(section);
            }
        };
        
        // Mouse handlers — use offsetX/offsetY for Nodes 2.0 compatibility
        nodeType.prototype._canvasMouseXY = function(e) {
            // Use getBoundingClientRect for reliable coordinate mapping.
            // Compute position relative to the canvas content area (inside border).
            const rect = this.previewCanvas.getBoundingClientRect();
            const borderLeft = parseInt(getComputedStyle(this.previewCanvas).borderLeftWidth) || 0;
            const borderTop = parseInt(getComputedStyle(this.previewCanvas).borderTopWidth) || 0;
            const contentW = rect.width - borderLeft * 2;
            const contentH = rect.height - borderTop * 2;
            const relX = e.clientX - rect.left - borderLeft;
            const relY = e.clientY - rect.top - borderTop;
            const mouseX = (relX / contentW) * this.previewCanvas.width;
            const mouseY = (relY / contentH) * this.previewCanvas.height;
            return [mouseX, mouseY];
        };
        
        nodeType.prototype.onCanvasMouseDown = function(e) {
            const [mouseX, mouseY] = this._canvasMouseXY(e);
            
            const frameData = this.allFrames[this.currentFrame];
            if (!frameData?.people?.length) return;
            
            // Determine which character to interact with
            const targetIdx = this.charEditingIdx !== null ? this.charEditingIdx : 0;
            const person = frameData.people[targetIdx];
            if (!person?.pose_keypoints_2d) return;
            
            const points = this.getFullyTransformedPointsForChar(person.pose_keypoints_2d, targetIdx);
            const scaleX = this.previewCanvas.width / this.canvasWidth;
            const scaleY = this.previewCanvas.height / this.canvasHeight;
            
            const charVis = this.getVisibilityForChar(targetIdx);
            const joint = findClosestJoint(points, mouseX, mouseY, scaleX, scaleY, 30, charVis);
            
            if (joint >= 0) {
                this.selectedJoint = joint;
                this.dragCharIdx = targetIdx;  // Remember which character we're dragging
                this.isDragging = true;
                this.dragStartPos = { x: mouseX, y: mouseY };
                const jt = this.getActiveJointTransforms();
                this.dragStartTransform = jt[joint] ? {...jt[joint], move: {...(jt[joint].move || {x:0, y:0})}} : { move: {x: 0, y: 0}, rotate: 0, scale: 1 };
                this.previewCanvas.style.cursor = "grabbing";
                this.updatePreview();
            }
        };
        
        nodeType.prototype.onCanvasMouseMove = function(e) {
            const [mouseX, mouseY] = this._canvasMouseXY(e);
            
            if (this.isDragging && this.selectedJoint >= 0) {
                const scaleX = this.previewCanvas.width / this.canvasWidth;
                const scaleY = this.previewCanvas.height / this.canvasHeight;
                const deltaX = (mouseX - this.dragStartPos.x) / scaleX;
                const deltaY = (mouseY - this.dragStartPos.y) / scaleY;
                
                const jt = this.getActiveJointTransforms();
                if (!jt[this.selectedJoint]) {
                    jt[this.selectedJoint] = { move: {x: 0, y: 0}, rotate: 0, scale: 1 };
                }
                
                if (this.currentTool === "move") {
                    jt[this.selectedJoint].move = {
                        x: (this.dragStartTransform.move?.x || 0) + deltaX,
                        y: (this.dragStartTransform.move?.y || 0) + deltaY
                    };
                } else if (this.currentTool === "rotate") {
                    const centerX = this.previewCanvas.width / 2, centerY = this.previewCanvas.height / 2;
                    const startAngle = Math.atan2(this.dragStartPos.y - centerY, this.dragStartPos.x - centerX);
                    const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
                    jt[this.selectedJoint].rotate = (this.dragStartTransform.rotate || 0) + (currentAngle - startAngle) * 180 / Math.PI;
                } else if (this.currentTool === "scale") {
                    const scaleDelta = 1 - (deltaY / 200);
                    jt[this.selectedJoint].scale = Math.max(0.1, Math.min(3, (this.dragStartTransform.scale || 1) * scaleDelta));
                }
                
                this.syncTransformsToWidget();
                this.updatePreview();
            } else {
                const frameData = this.allFrames[this.currentFrame];
                const targetIdx = this.charEditingIdx !== null ? this.charEditingIdx : 0;
                const person = frameData?.people?.[targetIdx];
                if (person?.pose_keypoints_2d) {
                    const points = this.getFullyTransformedPointsForChar(person.pose_keypoints_2d, targetIdx);
                    const scaleX = this.previewCanvas.width / this.canvasWidth;
                    const scaleY = this.previewCanvas.height / this.canvasHeight;
                    const charVis = this.getVisibilityForChar(targetIdx);
                    const newHover = findClosestJoint(points, mouseX, mouseY, scaleX, scaleY, 30, charVis);
                    if (newHover !== this.hoveredJoint) {
                        this.hoveredJoint = newHover;
                        this.previewCanvas.style.cursor = newHover >= 0 ? "pointer" : "crosshair";
                        this.updatePreview();
                    }
                }
            }
        };
        
        nodeType.prototype.onCanvasMouseUp = function(e) {
            if (this.isDragging) this.syncTransformsToWidget();
            this.isDragging = false;
            this.dragStartPos = null;
            this.dragCharIdx = null;
            this.previewCanvas.style.cursor = this.hoveredJoint >= 0 ? "pointer" : "crosshair";
        };
        
        nodeType.prototype.getVal = function(name, def) {
            // If we have per-param keyframes and multiple frames, interpolate
            if (this.paramKeyframes && typeof this.paramKeyframes === "object" && this.paramKeyframes[name] && this.paramKeyframes[name].length > 0 && this.allFrames.length > 1) {
                const val = this.interpolateParamAtFrame(name, this.currentFrame);
                if (val !== undefined) return val;
            }
            const w = this.widgets?.find(x => x.name === name);
            return w !== undefined ? w.value : def;
        };
        
        // Get param value for a specific character index.
        // Priority: per-char keyframes > per-char static > global keyframes > global widget
        nodeType.prototype.getValForChar = function(name, def, charIdx) {
            const idxStr = String(charIdx);
            const charData = this.charPerParams[idxStr];
            
            // 1. Per-character keyframes (if they exist and we have multiple frames)
            if (charData?._keyframes?.[name]?.length > 0 && this.allFrames.length > 1) {
                const val = this._interpolatePerCharKeyframe(charData._keyframes[name], this.currentFrame);
                if (val !== undefined) return val;
            }
            
            // 2. Per-character static override
            if (charData && charData[name] !== undefined) {
                return charData[name];
            }
            
            // 3. Global (includes global keyframes via getVal)
            return this.getVal(name, def);
        };
        
        // Interpolate from a per-character keyframe track
        nodeType.prototype._interpolatePerCharKeyframe = function(kfs, frame) {
            if (!kfs || kfs.length === 0) return undefined;
            const total = this.allFrames.length || 1;
            const sorted = kfs.slice().sort((a, b) => (a.frame || 0) - (b.frame || 0));
            if (sorted[0].frame > 0) sorted.unshift({ frame: 0, value: sorted[0].value, easing: "linear" });
            const lastFrame = total - 1;
            if (sorted[sorted.length - 1].frame < lastFrame) sorted.push({ frame: lastFrame, value: sorted[sorted.length - 1].value, easing: "linear" });
            let before = sorted[0], after = sorted[sorted.length - 1];
            for (let i = 0; i < sorted.length - 1; i++) {
                if (sorted[i].frame <= frame && frame <= sorted[i + 1].frame) { before = sorted[i]; after = sorted[i + 1]; break; }
            }
            const fs = before.frame || 0, fe = after.frame || 0;
            let t = (fe === fs) ? 0 : (frame - fs) / (fe - fs);
            t = this.applyEasing(t, before.easing || "linear");
            const a = before.value ?? 0, b = after.value ?? 0;
            return a + (b - a) * t;
        };
        
        // Get visibility for a specific character index.
        // Checks per-character visibility first, falls back to global.
        nodeType.prototype.getVisibilityForChar = function(charIdx) {
            const idxStr = String(charIdx);
            if (this.perCharVisibleParts[idxStr]) {
                return this.perCharVisibleParts[idxStr];
            }
            return this.visibleParts;
        };
        
        // Get joint transforms for a specific character index.
        nodeType.prototype.getJointTransformsForChar = function(charIdx) {
            const idxStr = String(charIdx);
            if (this.perCharJointTransforms[idxStr]) {
                return this.perCharJointTransforms[idxStr];
            }
            return this.jointTransforms;
        };
        
        // Get the ACTIVE joint transforms (for the currently-edited character or global)
        nodeType.prototype.getActiveJointTransforms = function() {
            if (this.charEditingIdx !== null) {
                const idxStr = String(this.charEditingIdx);
                if (!this.perCharJointTransforms[idxStr]) this.perCharJointTransforms[idxStr] = {};
                return this.perCharJointTransforms[idxStr];
            }
            return this.jointTransforms;
        };
        
        // Get the ACTIVE visibility (for the currently-edited character or global)
        nodeType.prototype.getActiveVisibleParts = function() {
            if (this.charEditingIdx !== null) {
                const idxStr = String(this.charEditingIdx);
                if (!this.perCharVisibleParts[idxStr]) {
                    this.perCharVisibleParts[idxStr] = { ...this.visibleParts };
                }
                return this.perCharVisibleParts[idxStr];
            }
            return this.visibleParts;
        };
        
        // Keyframe interpolation for per-param format: {paramName: [{frame, value, easing}]}
        nodeType.prototype.interpolateParamAtFrame = function(paramName, frame) {
            const kfs = this.paramKeyframes?.[paramName];
            if (!kfs || kfs.length === 0) return undefined;
            
            const total = this.allFrames.length || 1;
            const sorted = kfs.slice().sort((a, b) => (a.frame || 0) - (b.frame || 0));
            
            // Extend: hold first/last values to cover full range
            if (sorted[0].frame > 0) {
                sorted.unshift({ frame: 0, value: sorted[0].value, easing: "linear" });
            }
            const lastFrame = total - 1;
            if (sorted[sorted.length - 1].frame < lastFrame) {
                sorted.push({ frame: lastFrame, value: sorted[sorted.length - 1].value, easing: "linear" });
            }
            
            // Find surrounding keyframes
            let before = sorted[0], after = sorted[sorted.length - 1];
            for (let i = 0; i < sorted.length - 1; i++) {
                if (sorted[i].frame <= frame && frame <= sorted[i + 1].frame) {
                    before = sorted[i]; after = sorted[i + 1]; break;
                }
            }
            
            const fs = before.frame || 0, fe = after.frame || 0;
            let t = (fe === fs) ? 0 : (frame - fs) / (fe - fs);
            t = this.applyEasing(t, before.easing || "linear");
            
            const a = before.value !== undefined ? before.value : (SLIDER_DEFAULTS[paramName] ?? 0);
            const b = after.value !== undefined ? after.value : (SLIDER_DEFAULTS[paramName] ?? 0);
            return a + (b - a) * t;
        };
        
        nodeType.prototype.applyEasing = function(t, mode) {
            if (mode === "ease_in") return t * t;
            if (mode === "ease_out") return 1 - (1 - t) * (1 - t);
            if (mode === "ease_in_out") return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            return t; // linear
        };
        
        nodeType.prototype.getFullyTransformedPoints = function(kp) {
            return this.getFullyTransformedPointsForChar(kp, this.charEditingIdx !== null ? this.charEditingIdx : 0);
        };
        
        nodeType.prototype.getFullyTransformedPointsForChar = function(kp, charIdx) {
            const bp = {head_width:this.getValForChar("head_width",1,charIdx),head_height:this.getValForChar("head_height",1,charIdx),head_tilt:this.getValForChar("head_tilt",0,charIdx),neck_length:this.getValForChar("neck_length",1,charIdx),shoulder_height:this.getValForChar("shoulder_height",0,charIdx),collarbone_length:this.getValForChar("collarbone_length",1,charIdx),arm_angle:this.getValForChar("arm_angle",0,charIdx),upper_arm_length:this.getValForChar("upper_arm_length",1,charIdx),forearm_length:this.getValForChar("forearm_length",1,charIdx),torso_length:this.getValForChar("torso_length",1,charIdx),torso_tilt:this.getValForChar("torso_tilt",0,charIdx),hip_width:this.getValForChar("hip_width",1,charIdx),legs_angle:this.getValForChar("legs_angle",0,charIdx),upper_leg_length:this.getValForChar("upper_leg_length",1,charIdx),lower_leg_length:this.getValForChar("lower_leg_length",1,charIdx)};
            const fp = {eye_spacing:this.getValForChar("eye_spacing",0,charIdx),face_scale:this.getValForChar("face_scale",1,charIdx),jaw_width:this.getValForChar("jaw_width",1,charIdx)};
            
            let pts = parseKP(kp);
            pts = applyBody(pts, bp, this.canvasWidth, this.canvasHeight);
            pts = applyFaceToBody(pts, fp, this.canvasWidth, this.canvasHeight);
            pts = this.applyJointTransforms(pts, this.getJointTransformsForChar(charIdx));
            
            const os = this.getValForChar("overall_scale", 1, charIdx), or = this.getValForChar("overall_rotate", 0, charIdx);
            const px = this.getValForChar("position_x", 0, charIdx), py = this.getValForChar("position_y", 0, charIdx);
            pts = applyTransform(pts, os, or, px, py, this.canvasWidth, this.canvasHeight);
            return pts;
        };
        
        nodeType.prototype.findParentJoint = function(jointIdx) {
            for (const [parent, children] of Object.entries(KEYPOINT_CHILDREN)) {
                if (children.includes(jointIdx)) return parseInt(parent);
            }
            return -1;
        };
        
        nodeType.prototype.applyJointTransforms = function(points, transforms) {
            transforms = transforms || this.jointTransforms;
            if (!points || points.length < 18) return points;
            if (!transforms || Object.keys(transforms).length === 0) return points;
            
            points = points.map(p => [...p]);
            const processOrder = [1, 0, 2, 5, 8, 11, 3, 6, 9, 12, 4, 7, 10, 13, 14, 15, 16, 17];
            
            for (const jointIdx of processOrder) {
                const transform = transforms[jointIdx];
                if (!transform) continue;
                
                const point = points[jointIdx];
                if (!point || point[2] === 0) continue;
                
                const pivotIdx = this.findParentJoint(jointIdx);
                const pivot = pivotIdx >= 0 && points[pivotIdx] && points[pivotIdx][2] > 0 ? points[pivotIdx] : point;
                const children = KEYPOINT_CHILDREN[jointIdx] || [];
                const affected = [jointIdx, ...children];
                
                if (transform.move && (transform.move.x !== 0 || transform.move.y !== 0)) {
                    for (const idx of affected) {
                        if (points[idx] && points[idx][2] > 0) { points[idx][0] += transform.move.x; points[idx][1] += transform.move.y; }
                    }
                }
                
                if (transform.rotate && transform.rotate !== 0) {
                    const angleRad = transform.rotate * Math.PI / 180;
                    for (const idx of affected) {
                        if (points[idx] && points[idx][2] > 0) {
                            const np = rotPt([points[idx][0], points[idx][1]], [pivot[0], pivot[1]], angleRad);
                            points[idx][0] = np[0]; points[idx][1] = np[1];
                        }
                    }
                }
                
                if (transform.scale && transform.scale !== 1) {
                    for (const idx of affected) {
                        if (idx === jointIdx) continue;
                        if (points[idx] && points[idx][2] > 0) {
                            const np = scalePt([points[idx][0], points[idx][1]], [point[0], point[1]], transform.scale);
                            points[idx][0] = np[0]; points[idx][1] = np[1];
                        }
                    }
                }
            }
            return points;
        };
        
        nodeType.prototype.updatePreview = function() {
            if (!this.previewCtx) return;
            
            const ctx = this.previewCtx;
            let pw = this.previewCanvas.width, ph = this.previewCanvas.height;
            
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, pw, ph);
            
            const frameData = this.allFrames[this.currentFrame];
            if (!frameData?.people) {
                // Still draw background even without pose data
                if (this.referenceImage || this.bgFrames.length > 0) {
                    let bgImg = this.referenceImage;
                    if (this.bgFrames.length > 0) bgImg = this.bgFrames[Math.min(this.currentFrame, this.bgFrames.length - 1)] || this.referenceImage;
                    if (bgImg) { ctx.globalAlpha = this.bgOpacity; ctx.drawImage(bgImg, 0, 0, pw, ph); ctx.globalAlpha = 1.0; }
                }
                ctx.fillStyle = "#666666"; ctx.font = "14px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText("Connect DWPose and run to see preview", pw / 2, ph / 2);
                this.frameLabel.textContent = "Frame: 0/0";
                return;
            }
            
            // Sync canvas dimensions from frame data FIRST — before drawing anything
            const frameCW = frameData.canvas_width || this.canvasWidth;
            const frameCH = frameData.canvas_height || this.canvasHeight;
            if (frameCW !== this.canvasWidth || frameCH !== this.canvasHeight) {
                this.canvasWidth = frameCW;
                this.canvasHeight = frameCH;
                this.updateCanvasSize();
                return;
            }
            
            // Re-read pw/ph after potential canvas resize
            pw = this.previewCanvas.width;
            ph = this.previewCanvas.height;
            
            // Debug: log dimensions once per execution
            
            // Draw background image stretched to fill canvas.
            // Python ensures bg image and keypoint data are both at canvasWidth x canvasHeight.
            if (this.referenceImage || this.bgFrames.length > 0) {
                let bgImg = this.referenceImage;
                if (this.bgFrames.length > 0) {
                    const bgIdx = Math.min(this.currentFrame, this.bgFrames.length - 1);
                    bgImg = this.bgFrames[bgIdx] || this.referenceImage;
                }
                if (bgImg) {
                    ctx.globalAlpha = this.bgOpacity;
                    ctx.drawImage(bgImg, 0, 0, pw, ph);
                    ctx.globalAlpha = 1.0;
                }
            }
            
            const scaleX = pw / this.canvasWidth, scaleY = ph / this.canvasHeight;
            const lw = this.drawSize, pr = this.drawSize + 2;
            const highlightJoint = this.isDragging ? this.selectedJoint : this.hoveredJoint;
            
            frameData.people.forEach((person, pIdx) => {
                // Skip disabled characters
                if (this.charEnabled[pIdx] === false) return;
                
                // Dim non-selected characters when editing a specific one
                if (this.charEditingIdx !== null && this.charEditingIdx !== pIdx) {
                    ctx.globalAlpha = 0.35;
                }
                
                // Read params per-character (uses per-char overrides if they exist)
                const bp = {head_width:this.getValForChar("head_width",1,pIdx),head_height:this.getValForChar("head_height",1,pIdx),head_tilt:this.getValForChar("head_tilt",0,pIdx),neck_length:this.getValForChar("neck_length",1,pIdx),shoulder_height:this.getValForChar("shoulder_height",0,pIdx),collarbone_length:this.getValForChar("collarbone_length",1,pIdx),arm_angle:this.getValForChar("arm_angle",0,pIdx),upper_arm_length:this.getValForChar("upper_arm_length",1,pIdx),forearm_length:this.getValForChar("forearm_length",1,pIdx),torso_length:this.getValForChar("torso_length",1,pIdx),torso_tilt:this.getValForChar("torso_tilt",0,pIdx),hip_width:this.getValForChar("hip_width",1,pIdx),legs_angle:this.getValForChar("legs_angle",0,pIdx),upper_leg_length:this.getValForChar("upper_leg_length",1,pIdx),lower_leg_length:this.getValForChar("lower_leg_length",1,pIdx)};
                const fp = {eye_spacing:this.getValForChar("eye_spacing",0,pIdx),eye_height:this.getValForChar("eye_height",0,pIdx),eye_open:this.getValForChar("eye_open",0,pIdx),eyebrow_height:this.getValForChar("eyebrow_height",0,pIdx),eyebrow_tilt:this.getValForChar("eyebrow_tilt",0,pIdx),mouth_width:this.getValForChar("mouth_width",1,pIdx),mouth_height:this.getValForChar("mouth_height",1,pIdx),mouth_position_y:this.getValForChar("mouth_position_y",0,pIdx),smile:this.getValForChar("smile",0,pIdx),jaw_width:this.getValForChar("jaw_width",1,pIdx),nose_scale:this.getValForChar("nose_scale",1,pIdx),face_scale:this.getValForChar("face_scale",1,pIdx)};
                const hp = {hand_scale:this.getValForChar("hand_scale",1,pIdx),hand_rotate:this.getValForChar("hand_rotate",0,pIdx)};
                const os = this.getValForChar("overall_scale", 1, pIdx), or = this.getValForChar("overall_rotate", 0, pIdx);
                const ppx = this.getValForChar("position_x", 0, pIdx), ppy = this.getValForChar("position_y", 0, pIdx);
                
                // Per-character visibility
                const charVis = this.getVisibilityForChar(pIdx);
                
                let origBpts = null, bpts = null, lwp = null, rwp = null;
                
                if (person.pose_keypoints_2d?.length) {
                    origBpts = parseKP(person.pose_keypoints_2d);
                    bpts = applyBody(origBpts.map(p => [...p]), bp, this.canvasWidth, this.canvasHeight);
                    bpts = applyFaceToBody(bpts, fp, this.canvasWidth, this.canvasHeight);
                    bpts = this.applyJointTransforms(bpts, this.getJointTransformsForChar(pIdx));
                    bpts = applyTransform(bpts, os, or, ppx, ppy, this.canvasWidth, this.canvasHeight);
                    if (bpts[4][2] > 0) rwp = [bpts[4][0], bpts[4][1]];
                    if (bpts[7][2] > 0) lwp = [bpts[7][0], bpts[7][1]];
                    drawBody(ctx, bpts, scaleX, scaleY, lw, pr, charVis, highlightJoint);
                }
                
                if (person.face_keypoints_2d?.length && charVis.face !== false) {
                    let fpts = parseKP(person.face_keypoints_2d);
                    fpts = applyFace(fpts, fp, this.canvasWidth, this.canvasHeight);
                    if (origBpts && bpts) fpts = attachFace(fpts, origBpts, bpts, this.canvasWidth, this.canvasHeight, bp.head_width, bp.head_height, os);
                    drawFace(ctx, fpts, scaleX, scaleY, Math.max(1, lw - 1));
                }
                
                if (person.hand_left_keypoints_2d?.length && charVis.left_hand !== false) {
                    let hpts = parseKP(person.hand_left_keypoints_2d);
                    hpts = applyHand(hpts, hp, this.canvasWidth, this.canvasHeight, true);
                    hpts = applyTransform(hpts, os, or, ppx, ppy, this.canvasWidth, this.canvasHeight);
                    if (lwp) hpts = attachHandToWrist(hpts, lwp);
                    drawHand(ctx, hpts, scaleX, scaleY, Math.max(1, lw - 1));
                }
                
                if (person.hand_right_keypoints_2d?.length && charVis.right_hand !== false) {
                    let hpts = parseKP(person.hand_right_keypoints_2d);
                    hpts = applyHand(hpts, hp, this.canvasWidth, this.canvasHeight, false);
                    hpts = applyTransform(hpts, os, or, ppx, ppy, this.canvasWidth, this.canvasHeight);
                    if (rwp) hpts = attachHandToWrist(hpts, rwp);
                    drawHand(ctx, hpts, scaleX, scaleY, Math.max(1, lw - 1));
                }
                
                ctx.globalAlpha = 1.0;
            });
            
            this.frameLabel.textContent = `Frame: ${this.currentFrame + 1}/${Math.max(1, this.allFrames.length)}`;
            if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
        };
        
        nodeType.prototype.updateCanvasSize = function() {
            if (this.canvasWidth && this.canvasHeight) {
                const aspectRatio = this.canvasWidth / this.canvasHeight;
                let cw = 1280, ch = 1280;
                if (aspectRatio > 1) { cw = 1280; ch = Math.round(1280 / aspectRatio); }
                else { ch = 1280; cw = Math.round(1280 * aspectRatio); }
                this.previewCanvas.width = cw;
                this.previewCanvas.height = ch;
                this.updatePreview();
            }
        };
        
        // Playback
        nodeType.prototype.togglePlayback = function() { if (this.isPlaying) this.stopPlayback(); else this.startPlayback(); };
        nodeType.prototype.startPlayback = function() { if (this.allFrames.length <= 1) return; this.isPlaying = true; this.playPauseBtn.textContent = "⏸"; this.playbackInterval = setInterval(() => this.nextFrame(), 1000 / this.fps); };
        nodeType.prototype.stopPlayback = function() { this.isPlaying = false; this.playPauseBtn.textContent = "▶"; if (this.playbackInterval) { clearInterval(this.playbackInterval); this.playbackInterval = null; } };
        nodeType.prototype.nextFrame = function() { if (this.allFrames.length === 0) return; this.currentFrame = (this.currentFrame + 1) % this.allFrames.length; this.updateKFPlayhead(); this.updatePreview(); };
        nodeType.prototype.prevFrame = function() { if (this.allFrames.length === 0) return; this.currentFrame = (this.currentFrame - 1 + this.allFrames.length) % this.allFrames.length; this.updateKFPlayhead(); this.updatePreview(); };
        
        // ── Per-Slider Keyframe Management ──
        // paramKeyframes format: {paramName: [{frame, value, easing}, ...], ...}
        
        nodeType.prototype._getKeyframeStore = function(paramName) {
            // Returns the keyframe array for this param, creating if needed.
            // When editing a specific character, uses per-char keyframes.
            if (this.charEditingIdx !== null) {
                const idxStr = String(this.charEditingIdx);
                if (!this.charPerParams[idxStr]) this.charPerParams[idxStr] = {};
                if (!this.charPerParams[idxStr]._keyframes) this.charPerParams[idxStr]._keyframes = {};
                if (!this.charPerParams[idxStr]._keyframes[paramName]) this.charPerParams[idxStr]._keyframes[paramName] = [];
                return this.charPerParams[idxStr]._keyframes[paramName];
            }
            if (!this.paramKeyframes) this.paramKeyframes = {};
            if (!this.paramKeyframes[paramName]) this.paramKeyframes[paramName] = [];
            return this.paramKeyframes[paramName];
        };
        
        nodeType.prototype._getKeyframeStoreReadOnly = function(paramName) {
            // Returns the keyframe array for reading (for diamonds display).
            if (this.charEditingIdx !== null) {
                const idxStr = String(this.charEditingIdx);
                return this.charPerParams[idxStr]?._keyframes?.[paramName] || [];
            }
            return this.paramKeyframes?.[paramName] || [];
        };
        
        nodeType.prototype.toggleSliderKeyframe = function(paramName, value) {
            const kfs = this._getKeyframeStore(paramName);
            const existIdx = kfs.findIndex(k => k.frame === this.currentFrame);
            
            if (existIdx >= 0) {
                kfs.splice(existIdx, 1);
                // Clean up empty arrays
                if (kfs.length === 0) {
                    if (this.charEditingIdx !== null) {
                        const idxStr = String(this.charEditingIdx);
                        if (this.charPerParams[idxStr]?._keyframes) {
                            delete this.charPerParams[idxStr]._keyframes[paramName];
                        }
                    } else {
                        delete this.paramKeyframes[paramName];
                    }
                }
            } else {
                kfs.push({ frame: this.currentFrame, value: value, easing: "linear" });
                kfs.sort((a, b) => a.frame - b.frame);
            }
            this.syncParamKeyframesToWidget();
            this.syncCharSelectionToWidget();
        };
        
        nodeType.prototype.updateKeyframeValueAtCurrentFrame = function(paramName, value) {
            // Update in per-char keyframes if editing a character
            if (this.charEditingIdx !== null) {
                const idxStr = String(this.charEditingIdx);
                const kfs = this.charPerParams[idxStr]?._keyframes?.[paramName];
                if (kfs) {
                    const kf = kfs.find(k => k.frame === this.currentFrame);
                    if (kf) { kf.value = value; this.syncCharSelectionToWidget(); }
                }
                return;
            }
            // Global keyframes
            if (!this.paramKeyframes?.[paramName]) return;
            const kf = this.paramKeyframes[paramName].find(k => k.frame === this.currentFrame);
            if (kf) {
                kf.value = value;
                this.syncParamKeyframesToWidget();
            }
        };
        
        nodeType.prototype.refreshSliderKeyframeDiamonds = function(paramName, diamondLayer) {
            if (!diamondLayer) return;
            diamondLayer.replaceChildren();
            const total = this.allFrames.length || 1;
            const kfs = this._getKeyframeStoreReadOnly(paramName);
            
            for (const kf of kfs) {
                const pct = total > 1 ? (kf.frame / (total - 1)) * 100 : 50;
                const isCurrentFrame = kf.frame === this.currentFrame;
                const d = document.createElement("div");
                d.style.cssText = `position: absolute; top: 50%; left: ${pct}%; width: 7px; height: 7px; background: ${isCurrentFrame ? "#ffcc00" : "#e8a020"}; transform: translate(-50%, -50%) rotate(45deg); pointer-events: auto; cursor: pointer; border: 1px solid ${isCurrentFrame ? "#fff" : "#886600"};`;
                d.title = `Frame ${kf.frame}: ${kf.value.toFixed(2)} (${kf.easing})`;
                d.addEventListener("click", (e) => {
                    e.stopPropagation();
                    // Jump to this keyframe's frame
                    this.currentFrame = kf.frame;
                    this.refreshAllSliderKeyframes();
                    this.updatePreview();
                });
                d.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Cycle easing on right-click
                    const modes = ["linear", "ease_in", "ease_out", "ease_in_out"];
                    kf.easing = modes[(modes.indexOf(kf.easing || "linear") + 1) % modes.length];
                    d.title = `Frame ${kf.frame}: ${kf.value.toFixed(2)} (${kf.easing})`;
                    this.syncParamKeyframesToWidget();
                });
                diamondLayer.appendChild(d);
            }
        };
        
        nodeType.prototype.refreshAllSliderKeyframes = function() {
            for (const w of this.widgets || []) {
                if (w._diamondLayer && SLIDER_DEFAULTS[w.name] !== undefined) {
                    this.refreshSliderKeyframeDiamonds(w.name, w._diamondLayer);
                }
            }
        };
        
        nodeType.prototype.updateKFPlayhead = function() {
            // Update all diamond highlights when frame changes
            this.refreshAllSliderKeyframes();
        };
        
        nodeType.prototype.renderKFTimeline = function() {
            // Compat stub — now handled per-slider
            this.refreshAllSliderKeyframes();
        };
        
        nodeType.prototype.syncParamKeyframesToWidget = function() {
            const w = this.widgets?.find(x => x.name === "param_keyframes");
            if (w) {
                w.value = JSON.stringify(this.paramKeyframes || {});
                if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
            }
        };
        
        nodeType.prototype.loadParamKeyframesFromWidget = function() {
            const w = this.widgets?.find(x => x.name === "param_keyframes");
            if (w && w.value) {
                try {
                    const parsed = JSON.parse(w.value);
                    if (Array.isArray(parsed)) {
                        // Convert old format [{frame, easing, param1, ...}] to new {param: [{frame, value, easing}]}
                        this.paramKeyframes = {};
                        for (const kf of parsed) {
                            for (const pn of Object.keys(SLIDER_DEFAULTS)) {
                                if (kf[pn] !== undefined && kf[pn] !== SLIDER_DEFAULTS[pn]) {
                                    if (!this.paramKeyframes[pn]) this.paramKeyframes[pn] = [];
                                    this.paramKeyframes[pn].push({ frame: kf.frame, value: kf[pn], easing: kf.easing || "linear" });
                                }
                            }
                        }
                    } else if (typeof parsed === "object") {
                        this.paramKeyframes = parsed;
                    }
                } catch (e) {
                    this.paramKeyframes = {};
                }
            }
            this.refreshAllSliderKeyframes();
        };
        
        // Reset/Export/Import
        nodeType.prototype.resetAllSliders = function() {
            console.log("[OpenPose Editor] Reset All triggered");
            try {
            // Reset all sliders to defaults — update both widget value AND custom UI
            for (const w of this.widgets || []) {
                if (SLIDER_DEFAULTS[w.name] !== undefined) {
                    const def = SLIDER_DEFAULTS[w.name];
                    w.value = def;
                    if (w._sectionSlider) w._sectionSlider.value = def;
                    if (w._sectionDisplay) w._sectionDisplay.textContent = parseFloat(def).toFixed(2);
                }
            }
            
            // Reset joint transforms
            this.jointTransforms = {};
            this.perCharJointTransforms = {};
            this.syncTransformsToWidget();
            
            // Reset visibility to all visible
            this.visibleParts = { head: true, torso: true, left_arm: true, right_arm: true, left_leg: true, right_leg: true, face: true, left_hand: true, right_hand: true };
            this.perCharVisibleParts = {};
            this.syncVisibilityToWidget();
            for (const btn of this.visibilityContainer.children) btn.style.background = "#4a9eff";
            
            // Reset character selection
            this.charEnabled = {};
            this.charEditingIdx = null;
            this.charPerParams = {};
            this.charCount = 0;
            this.syncCharSelectionToWidget();
            this.rebuildCharacterButtons();
            
            // Reset keyframes
            this.paramKeyframes = {};
            this.selectedKF = -1;
            this.syncParamKeyframesToWidget();
            this.refreshAllSliderKeyframes();
            
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
            this.dragCharIdx = null;
            
            // Reset playback
            this.stopPlayback();
            this.currentFrame = 0;
            this.frameLabel.textContent = `Frame: 1/${Math.max(1, this.allFrames.length)}`;
            
            // Reset draw size
            this.drawSize = 5;
            if (this.sizeSlider) { this.sizeSlider.value = "5"; }
            if (this.sizeLabel) { this.sizeLabel.textContent = "Size: 5"; }
            
            // Reset background opacity
            this.bgOpacity = 0.6;
            
            this.updatePreview();
            if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
            console.log("[OpenPose Editor] Reset All complete");
            } catch (err) {
                console.error("[OpenPose Editor] Reset All error:", err);
            }
        };
        
        nodeType.prototype.exportPreset = function() {
            const preset = {
                name: "OpenPose Preset", version: "2.1", parameters: {},
                jointTransforms: this.jointTransforms || {},
                perCharJointTransforms: this.perCharJointTransforms || {},
                visibility: this.visibleParts,
                perCharVisibleParts: this.perCharVisibleParts || {},
                charEnabled: this.charEnabled,
                charPerParams: this.charPerParams,
                paramKeyframes: this.paramKeyframes || []
            };
            for (const w of this.widgets || []) { if (SLIDER_DEFAULTS[w.name] !== undefined) preset.parameters[w.name] = w.value; }
            const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = `openpose_preset_${Date.now()}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        };
        
        nodeType.prototype.importPreset = function() { this.fileInput.click(); };
        
        nodeType.prototype.handleFileImport = function(e) {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const preset = JSON.parse(event.target.result);
                    if (preset.parameters) { for (const w of this.widgets || []) { if (preset.parameters[w.name] !== undefined) w.value = preset.parameters[w.name]; } }
                    if (preset.jointTransforms) { this.jointTransforms = preset.jointTransforms; }
                    if (preset.perCharJointTransforms) { this.perCharJointTransforms = preset.perCharJointTransforms; }
                    this.syncTransformsToWidget();
                    if (preset.visibility) {
                        this.visibleParts = { ...this.visibleParts, ...preset.visibility };
                    }
                    if (preset.perCharVisibleParts) { this.perCharVisibleParts = preset.perCharVisibleParts; }
                    this.syncVisibilityToWidget();
                    this.refreshVisibilityButtons();
                    if (preset.charEnabled) { this.charEnabled = preset.charEnabled; }
                    if (preset.charPerParams) { this.charPerParams = preset.charPerParams; }
                    if (preset.paramKeyframes) { this.paramKeyframes = preset.paramKeyframes; this.syncParamKeyframesToWidget(); this.renderKFTimeline(); }
                    this.syncCharSelectionToWidget();
                    this.updateCharButtonStyles();
                    this.updatePreview();
                    if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
                } catch (err) { console.error("Failed to import preset:", err); }
            };
            reader.readAsText(file);
            e.target.value = "";
        };
        
        // Widget sync — includes per-character data
        nodeType.prototype.syncTransformsToWidget = function() {
            const w = this.widgets?.find(w => w.name === "joint_transforms");
            if (w) w.value = JSON.stringify({ global: this.jointTransforms, perChar: this.perCharJointTransforms });
        };
        nodeType.prototype.loadTransformsFromWidget = function() {
            const w = this.widgets?.find(w => w.name === "joint_transforms");
            if (w?.value) {
                try {
                    const data = JSON.parse(w.value);
                    if (data.global !== undefined) {
                        // New format: {global: {...}, perChar: {...}}
                        this.jointTransforms = data.global || {};
                        this.perCharJointTransforms = data.perChar || {};
                    } else {
                        // Old format: just the transforms object directly
                        this.jointTransforms = data;
                        this.perCharJointTransforms = {};
                    }
                } catch { this.jointTransforms = {}; this.perCharJointTransforms = {}; }
            }
        };
        nodeType.prototype.syncVisibilityToWidget = function() {
            const w = this.widgets?.find(w => w.name === "visible_parts");
            if (w) w.value = JSON.stringify({ global: this.visibleParts, perChar: this.perCharVisibleParts });
        };
        nodeType.prototype.loadVisibilityFromWidget = function() {
            const w = this.widgets?.find(w => w.name === "visible_parts");
            if (w?.value) {
                try {
                    const data = JSON.parse(w.value);
                    if (data.global !== undefined) {
                        this.visibleParts = { ...this.visibleParts, ...data.global };
                        this.perCharVisibleParts = data.perChar || {};
                    } else {
                        // Old format
                        this.visibleParts = { ...this.visibleParts, ...data };
                        this.perCharVisibleParts = {};
                    }
                } catch {}
            }
        };
        
        // Character selection widget sync
        nodeType.prototype.syncCharSelectionToWidget = function() {
            const data = { enabled: this.charEnabled, editingIdx: this.charEditingIdx, perChar: this.charPerParams };
            const w = this.widgets?.find(w => w.name === "character_selection");
            if (w) w.value = JSON.stringify(data);
        };
        
        // Refresh visibility button styles to reflect current editing character
        nodeType.prototype.refreshVisibilityButtons = function() {
            if (!this.visibilityContainer) return;
            const vis = this.getActiveVisibleParts();
            const btns = this.visibilityContainer.querySelectorAll("button[data-part]");
            btns.forEach(btn => {
                const key = btn.dataset.part;
                btn.style.background = vis[key] !== false ? "#4a9eff" : "#444";
            });
        };
        
        // Refresh slider displays to reflect current editing character's values
        nodeType.prototype.refreshSliderDisplayForChar = function() {
            const sliderNames = Object.keys(SLIDER_DEFAULTS);
            for (const w of this.widgets || []) {
                if (!sliderNames.includes(w.name)) continue;
                if (!w._sectionSlider) continue;
                const val = this.charEditingIdx !== null
                    ? this.getValForChar(w.name, SLIDER_DEFAULTS[w.name], this.charEditingIdx)
                    : w.value;
                w._sectionSlider.value = val;
                if (w._sectionDisplay) w._sectionDisplay.textContent = parseFloat(val).toFixed(2);
            }
        };
        nodeType.prototype.loadCharSelectionFromWidget = function() {
            const w = this.widgets?.find(w => w.name === "character_selection");
            if (w?.value) {
                try {
                    const data = JSON.parse(w.value);
                    this.charEnabled = data.enabled || {};
                    this.charEditingIdx = data.editingIdx ?? null;
                    this.charPerParams = data.perChar || {};
                } catch { }
            }
        };
        
        // Rebuild character selection buttons when frame data changes
        nodeType.prototype.rebuildCharacterButtons = function() {
            const frameData = this.allFrames[this.currentFrame];
            const count = frameData?.people?.length || 0;
            
            // Clear content
            this.charAccordionContent.replaceChildren();
            this.charBtns = [];
            
            // No data yet
            if (count === 0) {
                { this.charAccordionContent.replaceChildren(); const _s=document.createElement('span'); _s.style.cssText='color:#666;font-size:11px;'; _s.textContent='Run node to detect characters'; this.charAccordionContent.appendChild(_s); }
                this.charCount = 0;
                return;
            }
            
            // Only 1 character
            if (count === 1) {
                { this.charAccordionContent.replaceChildren(); const _s=document.createElement('span'); _s.style.cssText='color:#888;font-size:11px;'; _s.textContent='Single character detected'; this.charAccordionContent.appendChild(_s); }
                this.charCount = 1;
                this.charEnabled = {0: true};
                this.charEditingIdx = null;
                return;
            }
            
            // 2+ characters - build the UI
            this.charCount = count;
            
            // "All" button
            const allBtn = document.createElement("button");
            allBtn.textContent = "All";
            allBtn.style.cssText = "padding: 4px 10px; font-size: 11px; border: 2px solid #4a9eff; border-radius: 3px; cursor: pointer; background: #4a9eff; color: white; margin-right: 4px;";
            allBtn.addEventListener("click", () => {
                this.charEditingIdx = null;
                // Re-enable all characters
                for (let j = 0; j < this.charCount; j++) {
                    this.charEnabled[j] = true;
                }
                this.updateCharButtonStyles();
                this.charAccordionHeader.querySelectorAll("span")[1].textContent = "Editing: All";
                this.syncCharSelectionToWidget();
                this.refreshVisibilityButtons();
                this.refreshSliderDisplayForChar();
                this.refreshAllSliderKeyframes();
                this.updatePreview();
            });
            this.charAccordionContent.appendChild(allBtn);
            this.charAllBtn = allBtn;
            
            // Separator
            const sep = document.createElement("span");
            sep.textContent = "|";
            sep.style.cssText = "color: #555; margin: 0 6px;";
            this.charAccordionContent.appendChild(sep);
            
            // Initialize enabled state for new characters
            for (let i = 0; i < count; i++) {
                if (this.charEnabled[i] === undefined) this.charEnabled[i] = true;
            }
            
            // Character buttons
            for (let i = 0; i < count; i++) {
                const btn = document.createElement("button");
                btn.textContent = `#${i + 1}`;
                btn.dataset.idx = i;
                btn.style.cssText = "padding: 4px 8px; font-size: 11px; border: 2px solid transparent; border-radius: 3px; cursor: pointer; background: #4a9eff; color: white; margin: 0 2px;";
                
                // Click: select for editing
                btn.addEventListener("click", (e) => {
                    if (e.shiftKey || e.ctrlKey) {
                        // Toggle enabled (manual override)
                        this.charEnabled[i] = !this.charEnabled[i];
                    } else {
                        // Select for editing (or deselect back to All)
                        if (this.charEditingIdx === i) {
                            // Deselect — back to editing all, re-enable everyone
                            this.charEditingIdx = null;
                            for (let j = 0; j < this.charCount; j++) {
                                this.charEnabled[j] = true;
                            }
                        } else {
                            // Select this character — disable all others
                            this.charEditingIdx = i;
                            for (let j = 0; j < this.charCount; j++) {
                                this.charEnabled[j] = (j === i);
                            }
                        }
                        const label = this.charEditingIdx !== null ? `Editing: #${this.charEditingIdx + 1}` : "Editing: All";
                        this.charAccordionHeader.querySelectorAll("span")[1].textContent = label;
                    }
                    this.updateCharButtonStyles();
                    this.syncCharSelectionToWidget();
                    this.refreshVisibilityButtons();
                    this.refreshSliderDisplayForChar();
                    this.refreshAllSliderKeyframes();
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
            
            // Add help text
            const helpText = document.createElement("span");
            helpText.textContent = "(click=edit, right-click=toggle)";
            helpText.style.cssText = "color: #555; font-size: 10px; margin-left: 8px;";
            this.charAccordionContent.appendChild(helpText);
            
            this.updateCharButtonStyles();
        };
        
        // Update character button visual styles
        nodeType.prototype.updateCharButtonStyles = function() {
            if (!this.charBtns) return;
            
            const allSelected = this.charEditingIdx === null;
            if (this.charAllBtn) {
                this.charAllBtn.style.background = allSelected ? "#4a9eff" : "#3a3a4a";
                this.charAllBtn.style.borderColor = allSelected ? "#4a9eff" : "transparent";
            }
            
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
        
        // Callbacks
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            if (onExecuted) onExecuted.apply(this, arguments);
            
            // canvas_info from pose data — only use as fallback if no images will load
            const hasImages = message?.bg_frames?.length > 0 || message?.reference_image?.[0]?.filename;
            if (message?.canvas_info?.[0] && !hasImages) {
                this.canvasWidth = message.canvas_info[0].width || 512;
                this.canvasHeight = message.canvas_info[0].height || 512;
                this.updateCanvasSize();
            }
            
            if (message?.all_frames) { this.allFrames = message.all_frames; this.currentFrame = Math.min(this.currentFrame, Math.max(0, this.allFrames.length - 1)); this.rebuildCharacterButtons(); this.renderKFTimeline(); }
            if (message?.fps?.[0]) { this.fps = message.fps[0]; }
            if (message?.bg_opacity?.[0] !== undefined) { this.bgOpacity = message.bg_opacity[0]; }
            
            // Helper: update canvas to match image aspect ratio
            const _applyImageAspect = (img) => {
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
            
            // Load background frame sequence
            if (message?.bg_frames?.length > 0) {
                this.bgFrames = [];
                this.referenceImage = null;
                let loadedCount = 0;
                const total = message.bg_frames.length;
                
                for (let i = 0; i < total; i++) {
                    const info = message.bg_frames[i];
                    if (!info?.filename) continue;
                    const url = api.apiURL(`/view?filename=${encodeURIComponent(info.filename)}&type=${info.type}&subfolder=${encodeURIComponent(info.subfolder || "")}`);
                    const img = new Image();
                    const idx = i;
                    img.onload = () => {
                        this.bgFrames[idx] = img;
                        if (idx === 0) {
                            this.referenceImage = img;
                            _applyImageAspect(img);
                        }
                        loadedCount++;
                        if (loadedCount >= total) this.updatePreview();
                    };
                    img.src = url;
                }
            } else if (message?.reference_image?.[0]?.filename) {
                const ref = message.reference_image[0];
                const url = api.apiURL(`/view?filename=${encodeURIComponent(ref.filename)}&type=${ref.type}&subfolder=${encodeURIComponent(ref.subfolder || "")}`);
                const img = new Image();
                img.onload = () => {
                    this.referenceImage = img;
                    this.bgFrames = [img];
                    _applyImageAspect(img);
                };
                img.src = url;
            }
            this.updatePreview();
        };
        
        const onWidgetChanged = nodeType.prototype.onWidgetChanged;
        nodeType.prototype.onWidgetChanged = function(name, value, old_value, widget) { if (onWidgetChanged) onWidgetChanged.apply(this, arguments); this.updatePreview(); };
        
        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function(size) { if (onResize) onResize.apply(this, arguments); };
        
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() { if (onRemoved) onRemoved.apply(this, arguments); this.stopPlayback(); };
        
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(o) {
            if (onConfigure) onConfigure.apply(this, arguments);
            setTimeout(() => { this.loadTransformsFromWidget(); this.loadVisibilityFromWidget(); this.loadCharSelectionFromWidget(); this.loadParamKeyframesFromWidget(); this.refreshAllSliderKeyframes(); this.updatePreview(); }, 100);
        };
    }
});
