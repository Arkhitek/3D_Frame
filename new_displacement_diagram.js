// 新しい変位図描画関数の実装

/**
 * 部材途中の変形を計算する関数（3Dフレーム対応）
 * 曲げモーメントによるたわみを考慮した詳細な変形計算
 * 
 * @param {object} member - 部材オブジェクト
 * @param {array} nodes - 節点配列
 * @param {array} D_global - 全体変位ベクトル
 * @param {object} memberForce - 部材力オブジェクト
 * @param {number} xi - 部材長さ方向の無次元座標 (0.0 ~ 1.0)
 * @param {number} dispScale - 変位の拡大倍率
 * @returns {object} 変形後の3D座標 {x, y, z}
 */
const calculateMemberDeformation = (member, nodes, D_global, memberForce, xi, dispScale) => {
    const nodeI = nodes[member.i];
    const nodeJ = nodes[member.j];
    
    if (!nodeI || !nodeJ) return null;
    
    const is3D = D_global.length / nodes.length === 6;
    
    // 部材の元の座標（線形補間）
    const original_x = nodeI.x + (nodeJ.x - nodeI.x) * xi;
    const original_y = (nodeI.y || 0) + ((nodeJ.y || 0) - (nodeI.y || 0)) * xi;
    const original_z = (nodeI.z || 0) + ((nodeJ.z || 0) - (nodeI.z || 0)) * xi;
    
    if (!is3D) {
        // 2Dの場合は単純な線形補間
        const d_i = {
            dx: D_global[member.i * 3][0],
            dy: D_global[member.i * 3 + 1][0]
        };
        const d_j = {
            dx: D_global[member.j * 3][0],
            dy: D_global[member.j * 3 + 1][0]
        };
        
        const dx = d_i.dx + (d_j.dx - d_i.dx) * xi;
        const dy = d_i.dy + (d_j.dy - d_i.dy) * xi;
        
        return {
            x: original_x + dx * dispScale,
            y: original_y + dy * dispScale,
            z: original_z
        };
    }
    
    // 3Dの場合は節点変位と回転を考慮
    const d_i = {
        dx: D_global[member.i * 6][0],
        dy: D_global[member.i * 6 + 1][0],
        dz: D_global[member.i * 6 + 2][0],
        rx: D_global[member.i * 6 + 3][0],
        ry: D_global[member.i * 6 + 4][0],
        rz: D_global[member.i * 6 + 5][0]
    };
    const d_j = {
        dx: D_global[member.j * 6][0],
        dy: D_global[member.j * 6 + 1][0],
        dz: D_global[member.j * 6 + 2][0],
        rx: D_global[member.j * 6 + 3][0],
        ry: D_global[member.j * 6 + 4][0],
        rz: D_global[member.j * 6 + 5][0]
    };
    
    // 部材の長さ
    const L = Math.sqrt(
        Math.pow(nodeJ.x - nodeI.x, 2) +
        Math.pow((nodeJ.y || 0) - (nodeI.y || 0), 2) +
        Math.pow((nodeJ.z || 0) - (nodeI.z || 0), 2)
    );
    
    if (L < 1e-10) return null;
    
    // 部材の局所座標系における変位を計算
    // エルミート補間を使用して曲げ変形を表現
    const x = xi; // 無次元座標（0~1）
    
    // エルミート基底関数（変位用）
    const H1 = 1 - 3*x*x + 2*x*x*x;
    const H2 = x - 2*x*x + x*x*x;
    const H3 = 3*x*x - 2*x*x*x;
    const H4 = -x*x + x*x*x;
    
    // 曲げ変形の計算
    // エルミート補間により、節点の変位と回転角から部材途中の変形を計算
    
    // 節点の変位と回転角
    // Y方向（全体座標系のY方向の変位）
    const v_i = d_i.dy;
    const v_j = d_j.dy;
    const theta_z_i = d_i.rz;
    const theta_z_j = d_j.rz;
    
    // Z方向（全体座標系のZ方向の変位）
    const w_i = d_i.dz;
    const w_j = d_j.dz;
    const theta_y_i = -d_i.ry; // 符号注意：右手系座標
    const theta_y_j = -d_j.ry;
    
    // エルミート補間による変形曲線
    // v(x) = H1 * v_i + H2 * L * θz_i + H3 * v_j + H4 * L * θz_j
    const dy = H1 * v_i + H2 * L * theta_z_i + H3 * v_j + H4 * L * theta_z_j;
    const dz = H1 * w_i + H2 * L * theta_y_i + H3 * w_j + H4 * L * theta_y_j;
    
    // 軸方向変位の線形補間
    const dx = d_i.dx + (d_j.dx - d_i.dx) * xi;
    
    // 変形後の座標
    return {
        x: original_x + dx * dispScale,
        y: original_y + dy * dispScale,
        z: original_z + dz * dispScale
    };
};

/**
 * 部材途中の曲げモーメントを計算する関数（3Dフレーム対応）
 * せん断力が一定の場合は線形、等分布荷重がある場合は二次曲線を考慮
 * 
 * @param {object} memberForce - 部材力オブジェクト
 * @param {number} L - 部材長さ (m)
 * @param {number} xi - 部材長さ方向の無次元座標 (0.0 ~ 1.0)
 * @param {string} axis - モーメント軸 ('y' or 'z')
 * @param {number} w - 等分布荷重 (kN/m) - オプション
 * @returns {number} 位置xiでの曲げモーメント値 (kN・m)
 */
const calculateMemberAxial = (memberForce, xi) => {
    if (!memberForce) return 0;
    const { Ni, Nj } = getAxialComponents(memberForce);
    const start = toNumber(Ni, 0);
    const end = toNumber(Nj, start);
    return start + (end - start) * xi;
};

const calculateMemberMoment = (memberForce, L, xi, axis = 'y', w = null) => {
    if (!memberForce) return 0;
    if (!Number.isFinite(L) || Math.abs(L) <= 1e-9) return 0;

    const { Mi, Mj } = getMomentComponentsForAxis(memberForce, axis);
    const { Qi, Qj } = getShearComponentsForAxis(memberForce, axis);

    const M_i = Mi;
    const M_j = Mj;
    const Q_i = Number.isFinite(Qi) ? Qi : 0;
    const Q_j = Number.isFinite(Qj) ? Qj : Q_i;

    const x_m = xi * L; // 実際の距離（m）

    let equivalentW;
    if (Number.isFinite(w) && w !== null) {
        equivalentW = w;
    } else if (Number.isFinite(Q_i) && Number.isFinite(Q_j)) {
        equivalentW = (Q_i - Q_j) / L;
    } else {
        equivalentW = 0;
    }

    let moment = M_i + Q_i * x_m - 0.5 * equivalentW * x_m * x_m;

    if (Number.isFinite(M_j)) {
        const predictedEndMoment = M_i + Q_i * L - 0.5 * equivalentW * L * L;
        const delta = predictedEndMoment - M_j;
        if (Number.isFinite(delta) && Math.abs(L) > 1e-9) {
            moment -= delta * (x_m / L);
        }
    }

    return moment;
};

/**
 * 部材途中のせん断力を計算する関数（3Dフレーム対応）
 * 
 * @param {object} memberForce - 部材力オブジェクト
 * @param {number} L - 部材長さ (m)
 * @param {number} xi - 部材長さ方向の無次元座標 (0.0 ~ 1.0)
 * @param {string} axis - せん断力方向 ('y' or 'z')
 * @param {number} w - 等分布荷重 (kN/m) - オプション
 * @returns {number} 位置xiでのせん断力値 (kN)
 */
const calculateMemberShear = (memberForce, L, xi, axis = 'y', w = null) => {
    if (!memberForce) return 0;
    const x_m = xi * L; // 実際の距離（m）

    const { Qi, Qj } = getShearComponentsForAxis(memberForce, axis);
    const Q_i = Number.isFinite(Qi) ? Qi : 0;
    const Q_j = Number.isFinite(Qj) ? Qj : Q_i;

    let equivalentW;
    if (Number.isFinite(w) && w !== null) {
        equivalentW = w;
    } else if (Number.isFinite(Q_i) && Number.isFinite(Q_j) && Math.abs(L) > 1e-9) {
        equivalentW = (Q_i - Q_j) / L;
    } else {
        equivalentW = 0;
    }

    const shear = Q_i - equivalentW * x_m;

    return shear;
};

const toNumber = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

const pickDominantComponent = (primary, secondary) => {
    const p = toNumber(primary);
    const s = toNumber(secondary);
    if (Math.abs(p) >= Math.abs(s)) return p;
    return s;
};

const getMomentComponentsForAxis = (memberForce, axis) => {
    if (!memberForce) return { Mi: 0, Mj: 0 };

    const fallbackMi = toNumber(memberForce.M_i);
    const fallbackMj = toNumber(memberForce.M_j);

    switch (axis) {
        case 'z':
            return {
                Mi: toNumber(memberForce.Mz_i, fallbackMi),
                Mj: toNumber(memberForce.Mz_j, fallbackMj)
            };
        case 'y':
            return {
                Mi: toNumber(memberForce.My_i, fallbackMi),
                Mj: toNumber(memberForce.My_j, fallbackMj)
            };
        case 'x':
        default:
            return {
                Mi: toNumber(memberForce.Mx_i, fallbackMi),
                Mj: toNumber(memberForce.Mx_j, fallbackMj)
            };
    }
};

const getShearComponentsForAxis = (memberForce, axis) => {
    if (!memberForce) return { Qi: 0, Qj: 0 };

    const fallbackQi = toNumber(memberForce.Q_i);
    const fallbackQj = toNumber(memberForce.Q_j);

    switch (axis) {
        case 'z':
            return {
                Qi: toNumber(memberForce.Qy_i, fallbackQi),
                Qj: toNumber(memberForce.Qy_j, fallbackQj)
            };
        case 'y':
            return {
                Qi: toNumber(memberForce.Qz_i, fallbackQi),
                Qj: toNumber(memberForce.Qz_j, fallbackQj)
            };
        case 'x':
        default:
            return {
                Qi: pickDominantComponent(memberForce.Qy_i, memberForce.Qz_i ?? fallbackQi),
                Qj: pickDominantComponent(memberForce.Qy_j, memberForce.Qz_j ?? fallbackQj)
            };
    }
};

const getAxialComponents = (memberForce) => ({
    Ni: toNumber(memberForce?.N_i),
    Nj: toNumber(memberForce?.N_j)
});

const getAxisForProjection = (projectionMode) => {
    switch (projectionMode) {
        case 'xy':
            return 'z';
        case 'xz':
            return 'y';
        case 'yz':
            return 'x';
        default:
            return 'y';
    }
};

const getDistributedLoadForAxis = (memberForce, axis) => {
    if (!memberForce) return null;
    if (axis === 'z') return toNumber(memberForce.w, null);
    if (axis === 'y') return toNumber(memberForce.wz, null);
    if (axis === 'x') return toNumber(memberForce.wx, null);
    return null;
};

const getMomentDiagramFactor = (axis) => {
    switch (axis) {
        case 'y':
        case 'z':
            return -1;
        case 'x':
        default:
            return 1;
    }
};

const getShearDiagramFactor = (axis) => {
    switch (axis) {
        case 'y':
        case 'z':
            return 1;
        case 'x':
        default:
            return 1;
    }
};

const getAxialDiagramFactor = (axis) => 1;

const convertMomentForDiagram = (value, axis) => toNumber(value, 0) * getMomentDiagramFactor(axis);

const convertShearForDiagram = (value, axis) => toNumber(value, 0) * getShearDiagramFactor(axis);

const convertAxialForDiagram = (value, axis) => toNumber(value, 0) * getAxialDiagramFactor(axis);

// 3D座標を2D投影する関数
const project3DTo2D = (node, projectionMode) => {
    const nodeY = node.y !== undefined ? node.y : 0;  // Y座標(水平)
    const nodeZ = node.z !== undefined ? node.z : 0;  // Z座標(鉛直)
    
    switch(projectionMode) {
        case 'xy':  // XY平面(水平面を上から見た図)
            return { x: node.x, y: nodeY };
        case 'xz':  // XZ平面(X方向鉛直断面)
            return { x: node.x, y: nodeZ };
        case 'yz':  // YZ平面(Y方向鉛直断面)
            return { x: nodeY, y: nodeZ };
        case 'iso': // 等角投影(アイソメトリック)
            // 30度回転の等角投影
            const angle = Math.PI / 6; // 30度
            return {
                x: node.x - nodeY * Math.cos(angle),
                y: nodeZ + nodeY * Math.sin(angle)
            };
        default:
            return { x: node.x, y: nodeZ };
    }
};

const getDisplacementOrientation = () => ({ x: 1, y: 1, z: 1 });

const applyOrientationToPoint = (originalPoint, displacedPoint, orientation) => {
    if (!originalPoint || !displacedPoint || !orientation) {
        return displacedPoint;
    }

    const adjusted = { ...displacedPoint };
    if (typeof originalPoint.x === 'number' && typeof displacedPoint.x === 'number') {
        adjusted.x = originalPoint.x + (displacedPoint.x - originalPoint.x) * (orientation.x ?? 1);
    }
    if (typeof originalPoint.y === 'number' && typeof displacedPoint.y === 'number') {
        adjusted.y = originalPoint.y + (displacedPoint.y - originalPoint.y) * (orientation.y ?? 1);
    }
    if (typeof originalPoint.z === 'number' && typeof displacedPoint.z === 'number') {
        adjusted.z = originalPoint.z + (displacedPoint.z - originalPoint.z) * (orientation.z ?? 1);
    }
    return adjusted;
};

const LABEL_CANDIDATE_OFFSETS = Object.freeze([
    { x: 0, y: -26 },
    { x: 26, y: 0 },
    { x: 0, y: 26 },
    { x: -26, y: 0 },
    { x: 20, y: -20 },
    { x: -20, y: -20 },
    { x: 20, y: 20 },
    { x: -20, y: 20 },
    { x: 0, y: -40 },
    { x: 32, y: -18 },
    { x: -32, y: -18 },
    { x: 32, y: 18 },
    { x: -32, y: 18 }
]);

const rectanglesOverlap = (a, b) => !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);

const createRectFromCenter = (cx, cy, width, height, padding = 2) => ({
    x1: cx - width / 2 - padding,
    y1: cy - height / 2 - padding,
    x2: cx + width / 2 + padding,
    y2: cy + height / 2 + padding
});

const measureTextDimensions = (ctx, text) => {
    const metrics = ctx.measureText(text);
    const width = metrics.width;
    const ascent = metrics.actualBoundingBoxAscent ?? 10;
    const descent = metrics.actualBoundingBoxDescent ?? 4;
    return {
        width,
        ascent,
        descent,
        height: ascent + descent
    };
};

const findLabelPlacement = (baseX, baseY, size, obstacles, offsets = LABEL_CANDIDATE_OFFSETS) => {
    for (const offset of offsets) {
        const cx = baseX + offset.x;
        const cy = baseY + offset.y;
        const rect = createRectFromCenter(cx, cy, size, size, 3);
        if (!obstacles.some(obstacle => rectanglesOverlap(obstacle, rect))) {
            return { cx, cy, rect };
        }
    }
    const fallbackRect = createRectFromCenter(baseX, baseY, size, size, 3);
    return { cx: baseX, cy: baseY, rect: fallbackRect };
};

const drawSquareNumberLabel = (ctx, text, baseX, baseY, obstacles, options = {}) => {
    ctx.save();
    ctx.font = options.font || 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const { width, height } = measureTextDimensions(ctx, text);
    const padding = options.padding ?? 8;
    const size = Math.max(width, height) + padding;
    const placement = findLabelPlacement(baseX, baseY, size, obstacles, options.offsets);

    ctx.fillStyle = options.background || 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = options.border || '#222';
    ctx.lineWidth = options.lineWidth || 1.5;
    ctx.beginPath();
    ctx.rect(placement.cx - size / 2, placement.cy - size / 2, size, size);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = options.color || '#000';
    ctx.fillText(text, placement.cx, placement.cy);

    obstacles.push(placement.rect);
    ctx.restore();
};

const drawCircleNumberLabel = (ctx, text, baseX, baseY, obstacles, options = {}) => {
    ctx.save();
    ctx.font = options.font || 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const { width, height } = measureTextDimensions(ctx, text);
    const padding = options.padding ?? 8;
    const diameter = Math.max(width, height) + padding;
    const placement = findLabelPlacement(baseX, baseY, diameter, obstacles, options.offsets);

    const radius = diameter / 2;
    ctx.fillStyle = options.background || 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = options.border || '#222';
    ctx.lineWidth = options.lineWidth || 1.5;
    ctx.beginPath();
    ctx.arc(placement.cx, placement.cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = options.color || '#000';
    ctx.fillText(text, placement.cx, placement.cy);

    obstacles.push(createRectFromCenter(placement.cx, placement.cy, diameter, diameter, 0));
    ctx.restore();
};

const drawTextWithPlacement = (ctx, text, baseX, baseY, obstacles, options = {}) => {
    const offsets = options.offsets || LABEL_CANDIDATE_OFFSETS;
    const metrics = measureTextDimensions(ctx, text);
    const padding = options.padding ?? 10;
    const size = Math.max(metrics.width, metrics.height) + padding;
    const placement = findLabelPlacement(baseX, baseY, size, obstacles, offsets);

    const prevStroke = ctx.strokeStyle;
    const prevFill = ctx.fillStyle;

    if (options.strokeStyle) ctx.strokeStyle = options.strokeStyle;
    if (options.fillStyle) ctx.fillStyle = options.fillStyle;

    const doStroke = options.strokeStyle && options.stroke !== false;
    const doFill = options.fill !== false;

    if (doStroke) {
        ctx.strokeText(text, placement.cx, placement.cy);
    }
    if (doFill) {
        ctx.fillText(text, placement.cx, placement.cy);
    }

    ctx.strokeStyle = prevStroke;
    ctx.fillStyle = prevFill;

    registerTextObstacle(obstacles, ctx, text, placement.cx, placement.cy, {
        padding: options.textPadding ?? 4,
        align: options.align,
        baseline: options.baseline
    });

    return placement;
};

const registerTextObstacle = (obstacles, ctx, text, x, y, options = {}) => {
    const { width, ascent, descent, height } = measureTextDimensions(ctx, text);
    const padding = options.padding ?? 4;
    const textAlign = options.align || ctx.textAlign || 'start';
    const textBaseline = options.baseline || ctx.textBaseline || 'alphabetic';

    let x1 = x;
    if (textAlign === 'center') {
        x1 = x - width / 2;
    } else if (textAlign === 'right' || textAlign === 'end') {
        x1 = x - width;
    }
    const x2 = x1 + width;

    let yTop = y;
    if (textBaseline === 'middle') {
        yTop = y - height / 2;
    } else if (textBaseline === 'alphabetic' || textBaseline === 'ideographic') {
        yTop = y - ascent;
    }

    const rect = {
        x1: x1 - padding,
        y1: yTop - padding,
        x2: x2 + padding,
        y2: yTop + height + padding
    };

    obstacles.push(rect);
};

const registerCircleObstacle = (obstacles, cx, cy, radius, padding = 4) => {
    obstacles.push({
        x1: cx - radius - padding,
        y1: cy - radius - padding,
        x2: cx + radius + padding,
        y2: cy + radius + padding
    });
};

// 各投影面の全ての座標値を取得する関数
const getAllFrameCoordinates = (nodes, projectionMode) => {
    const uniqueCoords = new Set();
    const tolerance = 0.01;

    nodes.forEach(node => {
        let coord = 0;
        if (projectionMode === 'xy') {
            coord = node.z !== undefined ? node.z : 0;
        } else if (projectionMode === 'xz') {
            coord = node.y !== undefined ? node.y : 0;
        } else if (projectionMode === 'yz') {
            coord = node.x;
        }

        // 誤差範囲内で丸める
        const roundedCoord = Math.round(coord / tolerance) * tolerance;
        uniqueCoords.add(roundedCoord);
    });

    return [...uniqueCoords].sort((a, b) => a - b);
};

const drawDisplacementDiagram = (nodes, members, D_global, memberForces, manualScale = null) => {
    const canvas = elements.displacementCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const clampDispScale = (value) => {
        if (!isFinite(value)) return 1;
        if (value <= 0) return 0;
        return Math.min(value, 100000);
    };

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2D/3D判定（自由度数から判定）
    const dofPerNode = D_global.length / nodes.length;
    const is3D = dofPerNode === 6;

    // 3つの投影面を定義
    const projectionModes = ['xy', 'xz', 'yz'];

    // 各投影面の構面座標を取得し、変位が0以外の構面のみをフィルタリング
    const frameData = [];
    const tolerance = 0.01;
    
    projectionModes.forEach(mode => {
        const coords = getAllFrameCoordinates(nodes, mode);
        if (coords.length > 0) {
            coords.forEach(coord => {
                // この構面に含まれる節点をチェック
                let hasNonZeroDisplacement = false;
                
                for (let i = 0; i < nodes.length; i++) {
                    let coordToCheck = 0;
                    if (mode === 'xy') coordToCheck = nodes[i].z;
                    else if (mode === 'xz') coordToCheck = nodes[i].y;
                    else if (mode === 'yz') coordToCheck = nodes[i].x;
                    
                    if (Math.abs(coordToCheck - coord) < tolerance) {
                        // この節点の変位をチェック
                        const dx = D_global[i * (is3D ? 6 : 3)][0];
                        const dy = D_global[i * (is3D ? 6 : 3) + 1][0];
                        const dz = is3D ? D_global[i * 6 + 2][0] : 0;
                        
                        const totalDisp = Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000; // mm単位
                        if (totalDisp > 0.01) { // 0.01mm以上の変位があれば表示
                            hasNonZeroDisplacement = true;
                            break;
                        }
                    }
                }
                
                // 変位が0以外の構面のみを追加
                if (hasNonZeroDisplacement) {
                    frameData.push({ mode, coord });
                }
            });
        }
    });

    if (frameData.length === 0) return;

    // 横スクロール式のレイアウト: 各構面を元のキャンバスサイズで横に並べる
    const frameWidth = 1200;  // 各構面の幅
    const frameHeight = 900; // 各構面の高さ
    const framePadding = 40; // 構面間の余白
    const headerHeight = 80; // ヘッダー高さ
    const margin = 40; // 描画領域の余白
    const drawAreaWidth = frameWidth - 2 * margin;
    const drawAreaHeight = frameHeight - 2 * margin;

    const prepareFrameGeometry = (frame) => {
        const visibleNodeSet = new Set();
        nodes.forEach((node, idx) => {
            let coordToCheck = 0;
            if (frame.mode === 'xy') {
                coordToCheck = node.z;
            } else if (frame.mode === 'xz') {
                coordToCheck = node.y;
            } else if (frame.mode === 'yz') {
                coordToCheck = node.x;
            }
            if (Math.abs(coordToCheck - frame.coord) < tolerance) {
                visibleNodeSet.add(idx);
            }
        });

        const visibleMemberIndices = [];
        members.forEach((member, idx) => {
            if (visibleNodeSet.has(member.i) && visibleNodeSet.has(member.j)) {
                visibleMemberIndices.push(idx);
            }
        });

        if (visibleMemberIndices.length === 0) {
            return { frame, hasContent: false };
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        visibleMemberIndices.forEach(idx => {
            const member = members[idx];
            const pi = project3DTo2D(nodes[member.i], frame.mode);
            const pj = project3DTo2D(nodes[member.j], frame.mode);
            minX = Math.min(minX, pi.x, pj.x);
            maxX = Math.max(maxX, pi.x, pj.x);
            minY = Math.min(minY, pi.y, pj.y);
            maxY = Math.max(maxY, pi.y, pj.y);
        });

        if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
            return { frame, hasContent: false };
        }

        const modelWidth = maxX - minX;
        const modelHeight = maxY - minY;
        let scale = 1;
        if (modelWidth > 0 && modelHeight > 0) {
            scale = Math.min(drawAreaWidth / modelWidth, drawAreaHeight / modelHeight) * 0.9;
        }

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        return {
            frame,
            hasContent: true,
            visibleNodeIndices: Array.from(visibleNodeSet),
            visibleMemberIndices,
            minX,
            maxX,
            minY,
            maxY,
            scale,
            centerX,
            centerY
        };
    };

    const frameGeometries = frameData
        .map(frame => prepareFrameGeometry(frame))
        .filter(geometry => geometry.hasContent);

    if (frameGeometries.length === 0) return;

    // キャンバスサイズを調整（横スクロール対応）
    const totalWidth = frameGeometries.length * (frameWidth + framePadding) + framePadding;
    const totalHeight = frameHeight + headerHeight + framePadding * 2;

    // 高DPI対応: デバイスピクセル比を取得
    const dpr = window.devicePixelRatio || 1;

    // キャンバスの内部解像度を高解像度に設定
    canvas.width = totalWidth * dpr;
    canvas.height = totalHeight * dpr;

    // CSSでの表示サイズは元のサイズ
    canvas.style.width = totalWidth + 'px';
    canvas.style.height = totalHeight + 'px';

    // コンテキストをスケール
    ctx.scale(dpr, dpr);

    // 全体の変位スケールを計算
    let dispScale = 0;
    if (D_global.length > 0) {
        if (manualScale !== null) {
            dispScale = clampDispScale(manualScale);
        } else {
            let max_disp = 0;
            if (is3D) {
                for (let i = 0; i < nodes.length; i++) {
                    const dx = Math.abs(D_global[i*6][0]);
                    const dy = Math.abs(D_global[i*6+1][0]);
                    const dz = Math.abs(D_global[i*6+2][0]);
                    max_disp = Math.max(max_disp, dx, dy, dz);
                }
            } else {
                for (let i = 0; i < nodes.length; i++) {
                    const dx = Math.abs(D_global[i*3][0]);
                    const dy = Math.abs(D_global[i*3+1][0]);
                    max_disp = Math.max(max_disp, dx, dy);
                }
            }

            // 構造のサイズを計算
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            nodes.forEach(n => {
                minX = Math.min(minX, n.x);
                maxX = Math.max(maxX, n.x);
                minY = Math.min(minY, n.y || 0);
                maxY = Math.max(maxY, n.y || 0);
                minZ = Math.min(minZ, n.z || 0);
                maxZ = Math.max(maxZ, n.z || 0);
            });
            const structureSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

            // 変位倍率の計算: 構造サイズと変位量の比率を考慮
            // 目標: 最大変位が構造サイズの5%程度に表示されるようにする
            if (max_disp > 1e-12 && structureSize > 0) {
                dispScale = clampDispScale((structureSize * 0.05) / max_disp);
            } else if (max_disp > 1e-12) {
                // 構造サイズが取得できない場合のフォールバック
                dispScale = clampDispScale(1000);
            }
        }
    }

    const calculateFrameDispScaleLimit = (geometry) => {
        if (!geometry.hasContent || geometry.scale <= 0) return Infinity;

        const localTransform = (px, py) => ({
            x: frameWidth / 2 + (px - geometry.centerX) * geometry.scale,
            y: frameHeight / 2 - (py - geometry.centerY) * geometry.scale
        });

        const minAllowedX = margin;
        const maxAllowedX = frameWidth - margin;
        const minAllowedY = margin;
        const maxAllowedY = frameHeight - margin;

    const numDivisions = 20;
    let frameLimit = Infinity;
    const orientation = getDisplacementOrientation(geometry.frame.mode);

        for (const memberIdx of geometry.visibleMemberIndices) {
            const member = members[memberIdx];
            const memberForce = memberForces && memberForces[memberIdx] ? memberForces[memberIdx] : null;

            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                const originalPoint = calculateMemberDeformation(member, nodes, D_global, memberForce, xi, 0);
        const deformedUnitRaw = calculateMemberDeformation(member, nodes, D_global, memberForce, xi, 1);
        const deformedUnit = applyOrientationToPoint(originalPoint, deformedUnitRaw, orientation);
                if (!originalPoint || !deformedUnit) continue;

                const originalProjected = project3DTo2D(originalPoint, geometry.frame.mode);
                const deformedProjected = project3DTo2D(deformedUnit, geometry.frame.mode);

                const originalPixel = localTransform(originalProjected.x, originalProjected.y);
                const unitPixel = localTransform(deformedProjected.x, deformedProjected.y);

                const deltaX = unitPixel.x - originalPixel.x;
                const deltaY = unitPixel.y - originalPixel.y;

                if (Math.abs(deltaX) > 1e-6) {
                    const availableX = deltaX > 0
                        ? maxAllowedX - originalPixel.x
                        : originalPixel.x - minAllowedX;
                    if (availableX <= 0) return 0;
                    frameLimit = Math.min(frameLimit, availableX / Math.abs(deltaX));
                }

                if (Math.abs(deltaY) > 1e-6) {
                    const availableY = deltaY > 0
                        ? maxAllowedY - originalPixel.y
                        : originalPixel.y - minAllowedY;
                    if (availableY <= 0) return 0;
                    frameLimit = Math.min(frameLimit, availableY / Math.abs(deltaY));
                }
            }
        }

        if (!isFinite(frameLimit) || frameLimit <= 0) return Infinity;
        return frameLimit * 0.98;
    };

    let autoScaleLimit = Infinity;
    frameGeometries.forEach(geometry => {
        const limit = calculateFrameDispScaleLimit(geometry);
        if (limit < autoScaleLimit) {
            autoScaleLimit = limit;
        }
    });

    if (autoScaleLimit < Infinity) {
        if (dispScale > 0) {
            dispScale = clampDispScale(Math.min(dispScale, autoScaleLimit));
        } else {
            dispScale = clampDispScale(autoScaleLimit);
        }
    } else if (dispScale > 0) {
        dispScale = clampDispScale(dispScale);
    }

    if (typeof window.updateAnimationAutoScale === 'function') {
        window.updateAnimationAutoScale(dispScale);
    } else {
        window.lastDisplacementScale = dispScale;
    }
    if (elements.dispScaleInput) {
        elements.dispScaleInput.value = dispScale.toFixed(2);
    }

    // 各フレームを描画（横並び）
    frameGeometries.forEach((geometry, index) => {
        const frame = geometry.frame;
        const x = framePadding + index * (frameWidth + framePadding);
        const y = headerHeight + framePadding;

        // 構面のタイトルを描画（フレームの上部）
        const axisName = frame.mode === 'xy' ? 'Z' : (frame.mode === 'xz' ? 'Y' : 'X');
        ctx.fillStyle = '#333';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${frame.mode.toUpperCase()}平面 (${axisName}=${frame.coord.toFixed(2)}m)`, x + frameWidth / 2, framePadding + 25);
        ctx.font = '16px Arial';
        ctx.fillText(`変位倍率: ${dispScale.toFixed(2)}`, x + frameWidth / 2, framePadding + 50);

        // 構面の背景を描画
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, frameWidth, frameHeight);

        // 構面の境界を描画
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, frameWidth, frameHeight);

        // 構面内に描画するための座標変換を設定
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, frameWidth, frameHeight);
        ctx.clip();

        const transform = (px, py) => ({
            x: x + frameWidth / 2 + (px - geometry.centerX) * geometry.scale,
            y: y + frameHeight / 2 - (py - geometry.centerY) * geometry.scale
        });
        const orientation = getDisplacementOrientation(frame.mode);
        const labelObstacles = [];
        const nodeScreenData = [];
        const memberScreenData = [];

        // 元の構造を描画（グレー）
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        geometry.visibleMemberIndices.forEach(memberIdx => {
            const member = members[memberIdx];
            const pi = project3DTo2D(nodes[member.i], frame.mode);
            const pj = project3DTo2D(nodes[member.j], frame.mode);
            const p1 = transform(pi.x, pi.y);
            const p2 = transform(pj.x, pj.y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.hypot(dx, dy) || 1;
            memberScreenData.push({
                memberIndex: memberIdx,
                midX: (p1.x + p2.x) / 2,
                midY: (p1.y + p2.y) / 2,
                tangent: { x: dx / length, y: dy / length },
                normal: { x: -dy / length, y: dx / length }
            });
        });

        // 変形後の構造を描画（赤、太線）- 曲げ変形を考慮
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2.5;
        geometry.visibleMemberIndices.forEach(memberIdx => {
            const member = members[memberIdx];
            const memberForce = memberForces && memberForces[memberIdx] ? memberForces[memberIdx] : null;

            ctx.beginPath();
            const numDivisions = 20;
            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                const originalPoint = calculateMemberDeformation(
                    member,
                    nodes,
                    D_global,
                    memberForce,
                    xi,
                    0
                );
                const deformedRaw = calculateMemberDeformation(
                    member,
                    nodes,
                    D_global,
                    memberForce,
                    xi,
                    dispScale
                );
                const deformed = applyOrientationToPoint(originalPoint, deformedRaw, orientation);

                if (deformed) {
                    const projected = project3DTo2D(deformed, frame.mode);
                    const point = transform(projected.x, projected.y);

                    if (k === 0) ctx.moveTo(point.x, point.y);
                    else ctx.lineTo(point.x, point.y);
                }
            }
            ctx.stroke();
        });

        // 節点の変位量を表示
        ctx.fillStyle = 'blue';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        geometry.visibleNodeIndices.forEach(nodeIdx => {
            const node = nodes[nodeIdx];
            const projected = project3DTo2D(node, frame.mode);
            const point = transform(projected.x, projected.y);

            ctx.fillStyle = 'blue';
            ctx.beginPath();
            ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
            ctx.fill();

             registerCircleObstacle(labelObstacles, point.x, point.y, 6);
             nodeScreenData.push({ nodeIndex: nodeIdx, x: point.x, y: point.y });

            if (is3D && D_global.length > nodeIdx * 6 + 2) {
                const dx = D_global[nodeIdx * 6][0] * 1000;
                const dy = D_global[nodeIdx * 6 + 1][0] * 1000;
                const dz = D_global[nodeIdx * 6 + 2][0] * 1000;
                const totalDisp = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (totalDisp > 0.1) {
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 5;
                    const dispText = `${totalDisp.toFixed(1)}mm`;
                    const textX = point.x;
                    const textY = point.y - 15;
                    ctx.strokeText(dispText, textX, textY);
                    ctx.fillStyle = 'darkblue';
                    ctx.fillText(dispText, textX, textY);
                    registerTextObstacle(labelObstacles, ctx, dispText, textX, textY);
                }
            }
        });

        const nodeLabelOffsets = [
            { x: 0, y: 28 },
            { x: 26, y: 12 },
            { x: -26, y: 12 },
            { x: 0, y: -32 },
            { x: 32, y: -16 },
            { x: -32, y: -16 }
        ];
        nodeScreenData.forEach(({ nodeIndex, x: nodeX, y: nodeY }) => {
            drawCircleNumberLabel(ctx, String(nodeIndex + 1), nodeX, nodeY, labelObstacles, {
                offsets: nodeLabelOffsets,
                font: 'bold 13px Arial'
            });
        });

        memberScreenData.forEach(({ memberIndex, midX, midY, tangent, normal }) => {
            const dynamicOffsets = [
                { x: normal.x * 28, y: normal.y * 28 },
                { x: -normal.x * 28, y: -normal.y * 28 },
                { x: tangent.x * 32, y: tangent.y * 32 },
                { x: -tangent.x * 32, y: -tangent.y * 32 },
                { x: normal.x * 42, y: normal.y * 42 },
                { x: -normal.x * 42, y: -normal.y * 42 }
            ];
            drawSquareNumberLabel(ctx, String(memberIndex + 1), midX, midY, labelObstacles, {
                offsets: dynamicOffsets,
                font: 'bold 13px Arial'
            });
        });

        ctx.restore();
    });
};

// 応力図描画関数（全投影・各構面対応）
const drawStressDiagram = (canvas, nodes, members, memberForces, stressType, title) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2D/3D判定
    const dofPerNode = 6; // 3Dフレーム想定
    const is3D = true;

    // 3つの投影面を定義
    const projectionModes = ['xy', 'xz', 'yz'];

    // 各投影面の構面座標を取得し、応力が0以外の構面のみをフィルタリング
    const frameData = [];
    const tolerance = 0.01;
    
    projectionModes.forEach(mode => {
        const coords = getAllFrameCoordinates(nodes, mode);
        if (coords.length > 0) {
            coords.forEach(coord => {
                // この構面に含まれる部材をチェック
                let hasNonZeroStress = false;
                
                for (let idx = 0; idx < members.length; idx++) {
                    const m = members[idx];
                    const nodeI = nodes[m.i];
                    const nodeJ = nodes[m.j];
                    if (!nodeI || !nodeJ) continue;
                    
                    // 部材の両端節点がこの構面上にあるかチェック
                    let coordI = 0, coordJ = 0;
                    if (mode === 'xy') {
                        coordI = nodeI.z;
                        coordJ = nodeJ.z;
                    } else if (mode === 'xz') {
                        coordI = nodeI.y;
                        coordJ = nodeJ.y;
                    } else if (mode === 'yz') {
                        coordI = nodeI.x;
                        coordJ = nodeJ.x;
                    }
                    
                    // 両端点がこの構面上にある場合
                    if (Math.abs(coordI - coord) < tolerance && Math.abs(coordJ - coord) < tolerance) {
                        if (memberForces[idx]) {
                            const forces = memberForces[idx];
                            const axis = getAxisForProjection(mode);

                            let stress = 0;
                            if (stressType === 'moment') {
                                const { Mi, Mj } = getMomentComponentsForAxis(forces, axis);
                                const start = convertMomentForDiagram(Mi, axis);
                                const end = convertMomentForDiagram(Mj, axis);
                                stress = Math.max(Math.abs(start), Math.abs(end));
                            } else if (stressType === 'axial') {
                                const { Ni, Nj } = getAxialComponents(forces);
                                const start = convertAxialForDiagram(Ni, axis);
                                const end = convertAxialForDiagram(Nj, axis);
                                stress = Math.max(Math.abs(start), Math.abs(end));
                            } else if (stressType === 'shear') {
                                const { Qi, Qj } = getShearComponentsForAxis(forces, axis);
                                const start = convertShearForDiagram(Qi, axis);
                                const end = convertShearForDiagram(Qj, axis);
                                stress = Math.max(Math.abs(start), Math.abs(end));
                            }

                            if (stress > 0.001) { // 0.001以上の応力があれば表示
                                hasNonZeroStress = true;
                                break;
                            }
                        }
                    }
                }
                
                // 応力が0以外の構面のみを追加
                if (hasNonZeroStress) {
                    frameData.push({ mode, coord });
                }
            });
        }
    });

    if (frameData.length === 0) return;

    // 横スクロール式のレイアウト: 各構面を元のキャンバスサイズで横に並べる
    const frameWidth = 1200;  // 各構面の幅
    const frameHeight = 900; // 各構面の高さ
    const framePadding = 40; // 構面間の余白
    const headerHeight = 80; // ヘッダー高さ
    
    // キャンバスサイズを調整（横スクロール対応）
    const totalWidth = frameData.length * (frameWidth + framePadding) + framePadding;
    const totalHeight = frameHeight + headerHeight + framePadding * 2;

    // 高DPI対応: デバイスピクセル比を取得
    const dpr = window.devicePixelRatio || 1;

    // キャンバスの内部解像度を高解像度に設定
    canvas.width = totalWidth * dpr;
    canvas.height = totalHeight * dpr;

    // CSSでの表示サイズは元のサイズ
    canvas.style.width = totalWidth + 'px';
    canvas.style.height = totalHeight + 'px';

    // コンテキストをスケール
    ctx.scale(dpr, dpr);

    // 応力の最大値を計算（スケール決定用）
    const axesForFrames = Array.from(new Set(frameData.map(frame => getAxisForProjection(frame.mode))));
    let maxStress = 0;
    members.forEach((m, idx) => {
        if (!memberForces[idx]) return;
        const forces = memberForces[idx];

        axesForFrames.forEach(axis => {
            if (stressType === 'moment') {
                const { Mi, Mj } = getMomentComponentsForAxis(forces, axis);
                const start = convertMomentForDiagram(Mi, axis);
                const end = convertMomentForDiagram(Mj, axis);
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            } else if (stressType === 'axial') {
                const { Ni, Nj } = getAxialComponents(forces);
                const start = convertAxialForDiagram(Ni, axis);
                const end = convertAxialForDiagram(Nj, axis);
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            } else if (stressType === 'shear') {
                const { Qi, Qj } = getShearComponentsForAxis(forces, axis);
                const start = convertShearForDiagram(Qi, axis);
                const end = convertShearForDiagram(Qj, axis);
                maxStress = Math.max(maxStress, Math.abs(start), Math.abs(end));
            }
        });
    });

    // 各フレームを描画（横並び）
    frameData.forEach((frame, index) => {
        const x = framePadding + index * (frameWidth + framePadding);
        const y = headerHeight + framePadding;

        // 構面のタイトルを描画（フレームの上部）
        const axisName = frame.mode === 'xy' ? 'Z' : (frame.mode === 'xz' ? 'Y' : 'X');
        ctx.fillStyle = '#333';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${frame.mode.toUpperCase()}平面 (${axisName}=${frame.coord.toFixed(2)}m)`, x + frameWidth / 2, framePadding + 25);
        ctx.font = '16px Arial';
        ctx.fillText(title, x + frameWidth / 2, framePadding + 50);

        // 構面の背景を描画
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, frameWidth, frameHeight);

        // 構面の境界を描画
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, frameWidth, frameHeight);

        // 構面内に描画するための座標変換を設定
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, frameWidth, frameHeight);
        ctx.clip();

        // この構面の節点と部材を取得
        const tolerance = 0.01;
        const visibleNodes = new Set();
        nodes.forEach((node, idx) => {
            let coordToCheck = 0;
            if (frame.mode === 'xy') {
                coordToCheck = node.z;
            } else if (frame.mode === 'xz') {
                coordToCheck = node.y;
            } else if (frame.mode === 'yz') {
                coordToCheck = node.x;
            }
            if (Math.abs(coordToCheck - frame.coord) < tolerance) {
                visibleNodes.add(idx);
            }
        });

        // この構面の部材のみをフィルタリング
        const visibleMembers = members.filter(m =>
            visibleNodes.has(m.i) && visibleNodes.has(m.j)
        );

        if (visibleMembers.length === 0) {
            ctx.restore();
            return;
        }

        // モデルの範囲を計算
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        visibleMembers.forEach(m => {
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            minX = Math.min(minX, pi.x, pj.x);
            maxX = Math.max(maxX, pi.x, pj.x);
            minY = Math.min(minY, pi.y, pj.y);
            maxY = Math.max(maxY, pi.y, pj.y);
        });

        const modelWidth = maxX - minX;
        const modelHeight = maxY - minY;
        const margin = 40;
        const drawWidth = frameWidth - 2 * margin;
        const drawHeight = frameHeight - 2 * margin;

        let modelScale = 1;
        if (modelWidth > 0 && modelHeight > 0) {
            modelScale = Math.min(drawWidth / modelWidth, drawHeight / modelHeight) * 0.9;
        }

        // 応力図のスケール（ピクセル単位）- 描画領域のサイズに応じて調整
        // 最大応力が描画領域からはみ出さないように制限
        // まず仮のスケールを計算
        let maxStressPixels = Math.min(drawWidth, drawHeight) * 0.06; // 8%から6%に縮小
        let stressScale = maxStress > 0 ? maxStressPixels / maxStress : 1;

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const offsetX = x + frameWidth / 2;
        const offsetY = y + frameHeight / 2;

        // 構面内座標変換関数
        const transform = (px, py) => {
            return {
                x: offsetX + (px - centerX) * modelScale,
                y: offsetY - (py - centerY) * modelScale
            };
        };

        const labelObstacles = [];
        const nodeScreenData = [];
        const memberScreenData = [];

        visibleNodes.forEach(idx => {
            const node = nodes[idx];
            const projected = project3DTo2D(node, frame.mode);
            const pos = transform(projected.x, projected.y);
            nodeScreenData.push({ nodeIndex: idx, x: pos.x, y: pos.y });
            registerCircleObstacle(labelObstacles, pos.x, pos.y, 4);
        });

        // 枠外にはみ出さないよう、許容スケール上限を算出
        const EPS = 1e-9;
        let scaleLimit = Infinity;
        const frameAxis = getAxisForProjection(frame.mode);
        visibleMembers.forEach(m => {
            if (scaleLimit <= EPS) return;
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            if (memberIndex === -1 || !memberForces[memberIndex]) return;

            const forces = memberForces[memberIndex];
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);

            const L = Math.sqrt(
                Math.pow(nj.x - ni.x, 2) +
                Math.pow((nj.y || 0) - (ni.y || 0), 2) +
                Math.pow((nj.z || 0) - (ni.z || 0), 2)
            );
            if (!isFinite(L) || L < EPS) return;

            const distributedLoad = getDistributedLoadForAxis(forces, frameAxis);
            const numDivisions = 20;

            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;

                if (stressType === 'moment') {
                    stressValue = convertMomentForDiagram(
                        calculateMemberMoment(forces, L, xi, frameAxis, distributedLoad),
                        frameAxis
                    );
                } else if (stressType === 'axial') {
                    stressValue = convertAxialForDiagram(
                        calculateMemberAxial(forces, xi),
                        frameAxis
                    );
                } else if (stressType === 'shear') {
                    stressValue = convertShearForDiagram(
                        calculateMemberShear(forces, L, xi, frameAxis, distributedLoad),
                        frameAxis
                    );
                }

                const absStress = Math.abs(stressValue);
                if (absStress < EPS) continue;

                const pos_x = pi.x + (pj.x - pi.x) * xi;
                const pos_y = pi.y + (pj.y - pi.y) * xi;
                const p = transform(pos_x, pos_y);

                const distToLeft = p.x - x;
                const distToRight = (x + frameWidth) - p.x;
                const distToTop = p.y - y;
                const distToBottom = (y + frameHeight) - p.y;
                const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

                if (minDist <= EPS) {
                    scaleLimit = 0;
                    return;
                }

                const candidateScale = minDist / absStress;
                if (candidateScale < scaleLimit) {
                    scaleLimit = candidateScale;
                }
            }
        });

        if (scaleLimit < Infinity) {
            stressScale = Math.min(stressScale, scaleLimit * 0.95);
        }

        // 元の構造を描画（グレー）
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            if (memberIndex === -1) return;
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            const p1 = transform(pi.x, pi.y);
            const p2 = transform(pj.x, pj.y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.hypot(dx, dy) || 1;
            memberScreenData.push({
                memberIndex,
                midX: (p1.x + p2.x) / 2,
                midY: (p1.y + p2.y) / 2,
                tangent: { x: dx / length, y: dy / length },
                normal: { x: -dy / length, y: dx / length }
            });
        });

        // 応力図を描画（部材途中の値も考慮）
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            if (memberIndex === -1 || !memberForces[memberIndex]) return;

            const forces = memberForces[memberIndex];
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            
            // 部材の長さを計算
            const L = Math.sqrt(
                Math.pow(nj.x - ni.x, 2) +
                Math.pow((nj.y || 0) - (ni.y || 0), 2) +
                Math.pow((nj.z || 0) - (ni.z || 0), 2)
            );
            
            // 部材の方向ベクトル（2D投影面上）
            const dx = pj.x - pi.x;
            const dy = pj.y - pi.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            if (length === 0) return;

            // 垂直方向（応力図を描画する方向）
            const perpX = -dy / length;
            const perpY = dx / length;

            // 部材の等分布荷重を取得（memberForcesに含まれる）
            const distributedLoad = getDistributedLoadForAxis(forces, frameAxis); // kN/m

            if (window?.DEBUG_STRESS_DIAGRAMS) {
                console.log(`📊 応力図描画: 部材 ${m.i + 1}-${m.j + 1}, axis=${frameAxis}, w=${distributedLoad}, stressType=${stressType}`);
            }

            // 部材を分割して応力値を計算
            const numDivisions = 20; // 部材を20分割
            const stressPoints = [];
            
            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;

                if (stressType === 'moment') {
                    // 曲げモーメント（等分布荷重を考慮）
                    stressValue = convertMomentForDiagram(
                        calculateMemberMoment(forces, L, xi, frameAxis, distributedLoad),
                        frameAxis
                    );
                } else if (stressType === 'axial') {
                    // 軸力（線形分布を想定）
                    stressValue = convertAxialForDiagram(
                        calculateMemberAxial(forces, xi),
                        frameAxis
                    );
                } else if (stressType === 'shear') {
                    // せん断力（等分布荷重を考慮）
                    stressValue = convertShearForDiagram(
                        calculateMemberShear(forces, L, xi, frameAxis, distributedLoad),
                        frameAxis
                    );
                }
                
                // 部材上の位置（2D投影）
                const pos_x = pi.x + (pj.x - pi.x) * xi;
                const pos_y = pi.y + (pj.y - pi.y) * xi;
                const p = transform(pos_x, pos_y);
                
                stressPoints.push({
                    x: p.x,
                    y: p.y,
                    value: stressValue,
                    offset: stressValue * stressScale
                });
            }

            // 応力図を塗りつぶし（複数のセグメントに分割）
            for (let k = 0; k < numDivisions; k++) {
                const p1 = stressPoints[k];
                const p2 = stressPoints[k + 1];
                const avgValue = (p1.value + p2.value) / 2;
                
                ctx.fillStyle = avgValue >= 0 ? 'rgba(255, 100, 100, 0.5)' : 'rgba(100, 100, 255, 0.5)';
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p1.x + perpX * p1.offset, p1.y - perpY * p1.offset);
                ctx.lineTo(p2.x + perpX * p2.offset, p2.y - perpY * p2.offset);
                ctx.lineTo(p2.x, p2.y);
                ctx.closePath();
                ctx.fill();
            }

            // 応力図の輪郭を描画（滑らかな曲線）
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let k = 0; k <= numDivisions; k++) {
                const p = stressPoints[k];
                const px = p.x + perpX * p.offset;
                const py = p.y - perpY * p.offset;
                
                if (k === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            
            // 最大応力値の位置を見つけて表示
            let maxAbsValue = 0;
            let maxAbsIndex = 0;
            stressPoints.forEach((p, idx) => {
                if (Math.abs(p.value) > maxAbsValue) {
                    maxAbsValue = Math.abs(p.value);
                    maxAbsIndex = idx;
                }
            });
            
            // 部材端の応力値を表示
            const p1 = stressPoints[0];
            const pN = stressPoints[numDivisions];
            
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.lineWidth = 5;
            
            if (Math.abs(p1.value) > 0.01) {
                const startValueText = p1.value.toFixed(2);
                const baseX = p1.x + perpX * p1.offset;
                const baseY = p1.y - perpY * p1.offset - 8;
                drawTextWithPlacement(ctx, startValueText, baseX, baseY, labelObstacles, {
                    strokeStyle: 'white',
                    fillStyle: '#000',
                    padding: 14
                });
            }
            
            if (Math.abs(pN.value) > 0.01) {
                const endValueText = pN.value.toFixed(2);
                const baseX = pN.x + perpX * pN.offset;
                const baseY = pN.y - perpY * pN.offset - 8;
                drawTextWithPlacement(ctx, endValueText, baseX, baseY, labelObstacles, {
                    strokeStyle: 'white',
                    fillStyle: '#000',
                    padding: 14
                });
            }
            
            // 最大応力値の位置にマーカーと値を表示（端点以外の場合のみ）
            if (maxAbsIndex > 0 && maxAbsIndex < numDivisions && maxAbsValue > 0.01) {
                const pMax = stressPoints[maxAbsIndex];
                const maxX = pMax.x + perpX * pMax.offset;
                const maxY = pMax.y - perpY * pMax.offset;
                
                // マーカー（円）を描画
                ctx.fillStyle = pMax.value >= 0 ? 'red' : 'blue';
                ctx.beginPath();
                ctx.arc(maxX, maxY, 5, 0, 2 * Math.PI);
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.stroke();
                
                // 最大値を表示
                ctx.font = 'bold 16px Arial';
                ctx.lineWidth = 4;
                ctx.strokeStyle = 'white';
                const maxText = `Max: ${pMax.value.toFixed(2)}`;
                const fillColor = pMax.value >= 0 ? '#cc0000' : '#0000cc';
                drawTextWithPlacement(ctx, maxText, maxX, maxY - 12, labelObstacles, {
                    strokeStyle: 'white',
                    fillStyle: fillColor,
                    padding: 16
                });
            }
        });

        const nodeLabelOffsets = [
            { x: 0, y: 26 },
            { x: 24, y: 0 },
            { x: -24, y: 0 },
            { x: 0, y: -28 },
            { x: 28, y: -18 },
            { x: -28, y: -18 }
        ];
        nodeScreenData.forEach(({ nodeIndex, x: nodeX, y: nodeY }) => {
            drawCircleNumberLabel(ctx, String(nodeIndex + 1), nodeX, nodeY, labelObstacles, {
                offsets: nodeLabelOffsets,
                font: 'bold 13px Arial'
            });
        });

        memberScreenData.forEach(({ memberIndex, midX, midY, tangent, normal }) => {
            const dynamicOffsets = [
                { x: normal.x * 28, y: normal.y * 28 },
                { x: -normal.x * 28, y: -normal.y * 28 },
                { x: tangent.x * 30, y: tangent.y * 30 },
                { x: -tangent.x * 30, y: -tangent.y * 30 },
                { x: normal.x * 40, y: normal.y * 40 },
                { x: -normal.x * 40, y: -normal.y * 40 }
            ];
            drawSquareNumberLabel(ctx, String(memberIndex + 1), midX, midY, labelObstacles, {
                offsets: dynamicOffsets,
                font: 'bold 13px Arial'
            });
        });

        ctx.restore();
    });
};

// 検定比図描画関数（全投影・各構面対応）
const drawCapacityRatioDiagram = (canvas, nodes, members, sectionCheckResults) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 3つの投影面を定義
    const projectionModes = ['xy', 'xz', 'yz'];

    // 各投影面の構面座標を取得し、検定比が0以外の構面のみをフィルタリング
    const frameData = [];
    const tolerance = 0.01;
    
    projectionModes.forEach(mode => {
        const coords = getAllFrameCoordinates(nodes, mode);
        if (coords.length > 0) {
            coords.forEach(coord => {
                // この構面に含まれる部材をチェック
                let hasNonZeroRatio = false;
                
                for (let idx = 0; idx < members.length; idx++) {
                    const m = members[idx];
                    const nodeI = nodes[m.i];
                    const nodeJ = nodes[m.j];
                    if (!nodeI || !nodeJ) continue;
                    
                    // 部材の両端節点がこの構面上にあるかチェック
                    let coordI = 0, coordJ = 0;
                    if (mode === 'xy') {
                        coordI = nodeI.z;
                        coordJ = nodeJ.z;
                    } else if (mode === 'xz') {
                        coordI = nodeI.y;
                        coordJ = nodeJ.y;
                    } else if (mode === 'yz') {
                        coordI = nodeI.x;
                        coordJ = nodeJ.x;
                    }
                    
                    // 両端点がこの構面上にある場合
                    if (Math.abs(coordI - coord) < tolerance && Math.abs(coordJ - coord) < tolerance) {
                        if (sectionCheckResults && sectionCheckResults[idx]) {
                            const result = sectionCheckResults[idx];
                            const ratio = (typeof result.maxRatio === 'number') ? result.maxRatio : 0;
                            
                            if (ratio > 0.001) { // 0.001以上の検定比があれば表示
                                hasNonZeroRatio = true;
                                break;
                            }
                        }
                    }
                }
                
                // 検定比が0以外の構面のみを追加
                if (hasNonZeroRatio) {
                    frameData.push({ mode, coord });
                }
            });
        }
    });

    if (frameData.length === 0) return;

    // 横スクロール式のレイアウト: 各構面を元のキャンバスサイズで横に並べる
    const frameWidth = 1200;  // 各構面の幅
    const frameHeight = 900; // 各構面の高さ
    const framePadding = 40; // 構面間の余白
    const headerHeight = 80; // ヘッダー高さ
    
    // キャンバスサイズを調整（横スクロール対応）
    const totalWidth = frameData.length * (frameWidth + framePadding) + framePadding;
    const totalHeight = frameHeight + headerHeight + framePadding * 2;

    // 高DPI対応: デバイスピクセル比を取得
    const dpr = window.devicePixelRatio || 1;

    // キャンバスの内部解像度を高解像度に設定
    canvas.width = totalWidth * dpr;
    canvas.height = totalHeight * dpr;

    // CSSでの表示サイズは元のサイズ
    canvas.style.width = totalWidth + 'px';
    canvas.style.height = totalHeight + 'px';

    // コンテキストをスケール
    ctx.scale(dpr, dpr);

    // 検定比の最大値を計算
    let maxRatio = 0;
    members.forEach((m, idx) => {
        if (sectionCheckResults && sectionCheckResults[idx]) {
            const result = sectionCheckResults[idx];
            const ratio = (typeof result.maxRatio === 'number') ? result.maxRatio : 0;
            maxRatio = Math.max(maxRatio, ratio);
        }
    });

    // 各フレームを描画（横並び）
    frameData.forEach((frame, index) => {
        const x = framePadding + index * (frameWidth + framePadding);
        const y = headerHeight + framePadding;

        // 構面のタイトルを描画（フレームの上部）
        const axisName = frame.mode === 'xy' ? 'Z' : (frame.mode === 'xz' ? 'Y' : 'X');
        ctx.fillStyle = '#333';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${frame.mode.toUpperCase()}平面 (${axisName}=${frame.coord.toFixed(2)}m)`, x + frameWidth / 2, framePadding + 25);
        ctx.font = '16px Arial';
        ctx.fillText(`検定比図 (最大: ${maxRatio.toFixed(3)})`, x + frameWidth / 2, framePadding + 50);

        // 構面の背景を描画
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, frameWidth, frameHeight);

        // 構面の境界を描画
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, frameWidth, frameHeight);

        // 構面内に描画するための座標変換を設定
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, frameWidth, frameHeight);
        ctx.clip();

        // この構面の節点と部材を取得
        const tolerance = 0.01;
        const visibleNodes = new Set();
        nodes.forEach((node, idx) => {
            let coordToCheck = 0;
            if (frame.mode === 'xy') {
                coordToCheck = node.z;
            } else if (frame.mode === 'xz') {
                coordToCheck = node.y;
            } else if (frame.mode === 'yz') {
                coordToCheck = node.x;
            }
            if (Math.abs(coordToCheck - frame.coord) < tolerance) {
                visibleNodes.add(idx);
            }
        });

        // この構面の部材のみをフィルタリング
        const visibleMembers = members.filter(m =>
            visibleNodes.has(m.i) && visibleNodes.has(m.j)
        );

        if (visibleMembers.length === 0) {
            ctx.restore();
            return;
        }

        // モデルの範囲を計算
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        visibleMembers.forEach(m => {
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            minX = Math.min(minX, pi.x, pj.x);
            maxX = Math.max(maxX, pi.x, pj.x);
            minY = Math.min(minY, pi.y, pj.y);
            maxY = Math.max(maxY, pi.y, pj.y);
        });

        const modelWidth = maxX - minX;
        const modelHeight = maxY - minY;
        const margin = 40;
        const drawWidth = frameWidth - 2 * margin;
        const drawHeight = frameHeight - 2 * margin;

        let scale = 1;
        if (modelWidth > 0 && modelHeight > 0) {
            scale = Math.min(drawWidth / modelWidth, drawHeight / modelHeight) * 0.9;
        }

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const offsetX = x + frameWidth / 2;
        const offsetY = y + frameHeight / 2;

        // 構面内座標変換関数
        const transform = (px, py) => {
            return {
                x: offsetX + (px - centerX) * scale,
                y: offsetY - (py - centerY) * scale
            };
        };

        const labelObstacles = [];
        const nodeScreenData = [];
        const memberScreenData = [];

        visibleNodes.forEach(idx => {
            const node = nodes[idx];
            const projected = project3DTo2D(node, frame.mode);
            const pos = transform(projected.x, projected.y);
            nodeScreenData.push({ nodeIndex: idx, x: pos.x, y: pos.y });
            registerCircleObstacle(labelObstacles, pos.x, pos.y, 4);
        });

        // 検定比に応じた色を返す関数
        const getRatioColor = (ratio) => {
            if (ratio < 0.5) return '#00ff00';      // 緑
            if (ratio < 0.7) return '#90ee90';      // 薄緑
            if (ratio < 0.9) return '#ffff00';      // 黄色
            if (ratio < 1.0) return '#ffa500';      // オレンジ
            return '#ff0000';                        // 赤
        };

        // 最大検定比を計算してスケーリング
        let maxRatioValue = 0;
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            const result = (memberIndex !== -1 && sectionCheckResults && sectionCheckResults[memberIndex])
                ? sectionCheckResults[memberIndex]
                : null;
            if (result && result.ratios) {
                result.ratios.forEach(r => {
                    if (r > maxRatioValue) maxRatioValue = r;
                });
            }
        });

        // 検定比図のスケール（描画領域の8%程度）
        const maxRatioPixels = Math.min(drawWidth, drawHeight) * 0.08;
        const ratioScale = maxRatioValue > 0 ? maxRatioPixels / maxRatioValue : 1;

        // 元の構造を描画（グレー）
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);
            const p1 = transform(pi.x, pi.y);
            const p2 = transform(pj.x, pj.y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();

            if (memberIndex !== -1) {
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const length = Math.hypot(dx, dy) || 1;
                memberScreenData.push({
                    memberIndex,
                    midX: (p1.x + p2.x) / 2,
                    midY: (p1.y + p2.y) / 2,
                    tangent: { x: dx / length, y: dy / length },
                    normal: { x: -dy / length, y: dx / length }
                });
            }
        });

        // 検定比分布を描画
        visibleMembers.forEach(m => {
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);
            const result = (memberIndex !== -1 && sectionCheckResults && sectionCheckResults[memberIndex])
                ? sectionCheckResults[memberIndex]
                : null;

            if (!result || !result.ratios || result.ratios.length === 0) return;

            const ni = nodes[m.i];
            const nj = nodes[m.j];
            const pi = project3DTo2D(ni, frame.mode);
            const pj = project3DTo2D(nj, frame.mode);

            // 部材の方向ベクトル
            const dx = pj.x - pi.x;
            const dy = pj.y - pi.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            if (length === 0) return;

            // 垂直方向（検定比図を描画する方向）
            const perpX = -dy / length;
            const perpY = dx / length;

            const p1 = transform(pi.x, pi.y);
            const p2 = transform(pj.x, pj.y);

            const numPoints = result.ratios.length;
            console.log(`部材${memberIndex + 1}: ${numPoints}箇所の検定比データを使用して分布描画`);

            // 検定比分布を塗りつぶしで描画
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);

            // 上側の曲線（検定比分布）
            for (let k = 0; k < numPoints; k++) {
                const t = k / (numPoints - 1);
                const ratio = result.ratios[k];
                const baseX = p1.x + t * (p2.x - p1.x);
                const baseY = p1.y + t * (p2.y - p1.y);
                const offset = ratio * ratioScale;
                const px = baseX + perpX * offset;
                const py = baseY + perpY * offset;
                ctx.lineTo(px, py);
            }

            // 下側の線（部材に戻る）
            ctx.lineTo(p2.x, p2.y);
            ctx.closePath();

            // 最大検定比に応じた色で塗りつぶし
            ctx.fillStyle = getRatioColor(result.maxRatio);
            ctx.globalAlpha = 0.6;
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // 輪郭線を描画（色分け）
            ctx.lineWidth = 3;
            for (let k = 0; k < numPoints - 1; k++) {
                const t1 = k / (numPoints - 1);
                const t2 = (k + 1) / (numPoints - 1);
                const ratio1 = result.ratios[k];
                const ratio2 = result.ratios[k + 1];
                const avgRatio = (ratio1 + ratio2) / 2;

                const base1X = p1.x + t1 * (p2.x - p1.x);
                const base1Y = p1.y + t1 * (p2.y - p1.y);
                const offset1 = ratio1 * ratioScale;
                const px1 = base1X + perpX * offset1;
                const py1 = base1Y + perpY * offset1;

                const base2X = p1.x + t2 * (p2.x - p1.x);
                const base2Y = p1.y + t2 * (p2.y - p1.y);
                const offset2 = ratio2 * ratioScale;
                const px2 = base2X + perpX * offset2;
                const py2 = base2Y + perpY * offset2;

                ctx.strokeStyle = getRatioColor(avgRatio);
                ctx.beginPath();
                ctx.moveTo(px1, py1);
                ctx.lineTo(px2, py2);
                ctx.stroke();
            }

            // 最大検定比の位置にマーカーと値を表示
            const maxRatio = result.maxRatio;
            let maxRatioIndex = 0;
            let maxValue = 0;
            result.ratios.forEach((r, idx) => {
                if (r > maxValue) {
                    maxValue = r;
                    maxRatioIndex = idx;
                }
            });

            const maxT = maxRatioIndex / (numPoints - 1);
            const maxBaseX = p1.x + maxT * (p2.x - p1.x);
            const maxBaseY = p1.y + maxT * (p2.y - p1.y);
            const maxOffset = maxRatio * ratioScale;
            const maxX = maxBaseX + perpX * maxOffset;
            const maxY = maxBaseY + perpY * maxOffset;

            // 最大検定比位置にマーカー（円）を描画
            ctx.fillStyle = getRatioColor(maxRatio);
            ctx.beginPath();
            ctx.arc(maxX, maxY, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 最大検定比の値をテキストで表示
            const textColor = maxRatio > 1.0 ? '#ff0000' : '#000';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.lineWidth = 5;
            // 白い縁取り
            ctx.strokeStyle = 'white';
            const ratioText = maxRatio.toFixed(3);
            ctx.strokeText(ratioText, maxX, maxY - 12);
            // カラーテキスト
            ctx.fillStyle = textColor;
            ctx.fillText(ratioText, maxX, maxY - 12);
            registerTextObstacle(labelObstacles, ctx, ratioText, maxX, maxY - 12);
        });

        const nodeLabelOffsets = [
            { x: 0, y: 26 },
            { x: 24, y: 0 },
            { x: -24, y: 0 },
            { x: 0, y: -28 },
            { x: 28, y: -18 },
            { x: -28, y: -18 }
        ];
        nodeScreenData.forEach(({ nodeIndex, x: nodeX, y: nodeY }) => {
            drawCircleNumberLabel(ctx, String(nodeIndex + 1), nodeX, nodeY, labelObstacles, {
                offsets: nodeLabelOffsets,
                font: 'bold 13px Arial'
            });
        });

        memberScreenData.forEach(({ memberIndex, midX, midY, tangent, normal }) => {
            const dynamicOffsets = [
                { x: normal.x * 26, y: normal.y * 26 },
                { x: -normal.x * 26, y: -normal.y * 26 },
                { x: tangent.x * 32, y: tangent.y * 32 },
                { x: -tangent.x * 32, y: -tangent.y * 32 },
                { x: normal.x * 40, y: normal.y * 40 },
                { x: -normal.x * 40, y: -normal.y * 40 }
            ];
            drawSquareNumberLabel(ctx, String(memberIndex + 1), midX, midY, labelObstacles, {
                offsets: dynamicOffsets,
                font: 'bold 13px Arial'
            });
        });

        ctx.restore();
    });
};
