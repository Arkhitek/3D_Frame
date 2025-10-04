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
const calculateMemberMoment = (memberForce, L, xi, axis = 'y', w = 0) => {
    if (!memberForce) return 0;
    
    // 部材端の曲げモーメントとせん断力
    let M_i = 0, M_j = 0, Q_i = 0;
    
    if (axis === 'y') {
        // Y軸周りモーメント（XZ平面内の曲げ）
        M_i = memberForce.My_i || memberForce.M_i || 0;
        M_j = memberForce.My_j || memberForce.M_j || 0;
        Q_i = memberForce.Qz_i || memberForce.Q_i || 0;
    } else if (axis === 'z') {
        // Z軸周りモーメント（XY平面内の曲げ）
        M_i = memberForce.Mz_i || memberForce.M_i || 0;
        M_j = memberForce.Mz_j || memberForce.M_j || 0;
        Q_i = memberForce.Qy_i || memberForce.Q_i || 0;
    }
    
    // 位置xiでのモーメントを計算
    // M(x) = M_i + Q_i * x * L - w * x^2 * L^2 / 2
    // ここで、x = xi（無次元座標）
    const x_m = xi * L; // 実際の距離（m）
    
    // 等分布荷重がない場合（w = 0）：線形補間
    // 等分布荷重がある場合：二次曲線
    const M = M_i + Q_i * x_m - (w * x_m * x_m) / 2;
    
    // デバッグ: 等分布荷重がある場合の計算を確認
    if (w !== 0) {
        console.log(`📊 モーメント計算 (xi=${xi.toFixed(2)}): M_i=${M_i.toFixed(2)}, Q_i=${Q_i.toFixed(2)}, w=${w}, x_m=${x_m.toFixed(2)}, M=${M.toFixed(2)}`);
    }
    
    return M;
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
const calculateMemberShear = (memberForce, L, xi, axis = 'y', w = 0) => {
    if (!memberForce) return 0;
    
    // 部材端のせん断力
    let Q_i = 0;
    
    if (axis === 'y') {
        // Y方向せん断力
        Q_i = memberForce.Qy_i || memberForce.Q_i || 0;
    } else if (axis === 'z') {
        // Z方向せん断力
        Q_i = memberForce.Qz_i || memberForce.Q_i || 0;
    }
    
    // せん断力の計算
    // 等分布荷重がない場合：一定
    // 等分布荷重がある場合：Q(x) = Q_i - w * x * L
    const x_m = xi * L; // 実際の距離（m）
    const Q = Q_i - w * x_m;
    
    return Q;
};

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

    // 全体の変位スケールを計算
    let dispScale = 0;
    if (D_global.length > 0) {
        if (manualScale !== null) {
            dispScale = manualScale;
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
                dispScale = (structureSize * 0.05) / max_disp;
                // 適切な範囲に制限（最小10、最大100000）
                dispScale = Math.max(10, Math.min(dispScale, 100000));
            } else if (max_disp > 1e-12) {
                // 構造サイズが取得できない場合のフォールバック
                dispScale = 1000;
            }

            lastDisplacementScale = dispScale;
            if (elements.dispScaleInput) {
                elements.dispScaleInput.value = dispScale.toFixed(2);
            }
        }
    }

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

        // セル内座標変換関数
        const transform = (px, py) => {
            return {
                x: offsetX + (px - centerX) * scale,
                y: offsetY - (py - centerY) * scale
            };
        };

        // 元の構造を描画（グレー）
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        visibleMembers.forEach(m => {
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
        });

        // 変形後の構造を描画（赤、太線）- 曲げ変形を考慮
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2.5;
        visibleMembers.forEach(m => {
            const ni = nodes[m.i];
            const nj = nodes[m.j];
            
            // 部材の対応するインデックスを取得
            const memberIndex = members.findIndex(mem => mem.i === m.i && mem.j === m.j);

            if (is3D) {
                ctx.beginPath();
                // 部材を20分割して滑らかな曲線を描画（10→20に増やして精度向上）
                const numDivisions = 20;
                for (let k = 0; k <= numDivisions; k++) {
                    const xi = k / numDivisions;
                    
                    // 新しい変形計算関数を使用（曲げを考慮）
                    const deformed = calculateMemberDeformation(
                        m, nodes, D_global, 
                        memberForces && memberForces[memberIndex] ? memberForces[memberIndex] : null,
                        xi, dispScale
                    );
                    
                    if (deformed) {
                        const projected = project3DTo2D(deformed, frame.mode);
                        const p = transform(projected.x, projected.y);
                        
                        if (k === 0) ctx.moveTo(p.x, p.y);
                        else ctx.lineTo(p.x, p.y);
                    }
                }
                ctx.stroke();
            } else {
                // 2Dの場合も同様に変形計算関数を使用
                ctx.beginPath();
                const numDivisions = 20;
                for (let k = 0; k <= numDivisions; k++) {
                    const xi = k / numDivisions;
                    
                    const deformed = calculateMemberDeformation(
                        m, nodes, D_global,
                        memberForces && memberForces[memberIndex] ? memberForces[memberIndex] : null,
                        xi, dispScale
                    );
                    
                    if (deformed) {
                        const projected = project3DTo2D(deformed, frame.mode);
                        const p = transform(projected.x, projected.y);
                        
                        if (k === 0) ctx.moveTo(p.x, p.y);
                        else ctx.lineTo(p.x, p.y);
                    }
                }
                ctx.stroke();
            }
        });

        // 節点の変位量を表示
        ctx.fillStyle = 'blue';
        ctx.font = 'bold 18px Arial';  // フォントサイズを11px→18pxに拡大
        ctx.textAlign = 'center';
        Array.from(visibleNodes).forEach(nodeIdx => {
            const node = nodes[nodeIdx];
            const projected = project3DTo2D(node, frame.mode);
            const p = transform(projected.x, projected.y);

            // 節点を円で描画（サイズを拡大）
            ctx.fillStyle = 'blue';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);  // 半径を4→6に拡大
            ctx.fill();

            // 変位量を表示（mm単位）- より見やすく
            if (is3D && D_global.length > nodeIdx * 6 + 2) {
                const dx = D_global[nodeIdx * 6][0] * 1000;
                const dy = D_global[nodeIdx * 6 + 1][0] * 1000;
                const dz = D_global[nodeIdx * 6 + 2][0] * 1000;
                const totalDisp = Math.sqrt(dx*dx + dy*dy + dz*dz);
                if (totalDisp > 0.1) { // 0.1mm以上の変位のみ表示
                    // 白い縁取りを太くして視認性向上
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 5;  // 3→5に拡大
                    ctx.strokeText(`${totalDisp.toFixed(1)}mm`, p.x, p.y - 15);  // 単位を追加、位置を調整
                    ctx.fillStyle = 'darkblue';
                    ctx.fillText(`${totalDisp.toFixed(1)}mm`, p.x, p.y - 15);
                }
            }
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
                            let stress = 0;
                            
                            if (stressType === 'moment') {
                                stress = Math.max(Math.abs(forces.M_i || 0), Math.abs(forces.M_j || 0));
                            } else if (stressType === 'axial') {
                                stress = Math.abs(forces.N_i || 0);
                            } else if (stressType === 'shear') {
                                stress = Math.max(Math.abs(forces.Q_i || 0), Math.abs(forces.Q_j || 0));
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
    let maxStress = 0;
    members.forEach((m, idx) => {
        if (!memberForces[idx]) return;
        const forces = memberForces[idx];
        
        // 部材座標系の応力値を取得
        let stress = 0;
        if (stressType === 'moment') {
            // 曲げモーメント
            stress = Math.max(Math.abs(forces.M_i || 0), Math.abs(forces.M_j || 0));
        } else if (stressType === 'axial') {
            // 軸力
            stress = Math.abs(forces.N_i || 0);
        } else if (stressType === 'shear') {
            // せん断力
            stress = Math.max(Math.abs(forces.Q_i || 0), Math.abs(forces.Q_j || 0));
        }
        maxStress = Math.max(maxStress, stress);
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
        // 最大応力が描画領域の8%程度のピクセル数になるようにスケーリング
        const maxStressPixels = Math.min(drawWidth, drawHeight) * 0.08;
        const stressScale = maxStress > 0 ? maxStressPixels / maxStress : 1;

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

        // 元の構造を描画（グレー）
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        visibleMembers.forEach(m => {
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

            // 部材の等分布荷重を取得（存在する場合）
            const w = m.w || 0; // kN/m
            
            // デバッグ: 等分布荷重の値を確認
            console.log(`📊 応力図描画: 部材 ${m.i+1}-${m.j+1}, w=${w}, m.w=${m.w}, stressType=${stressType}`);

            // 部材を分割して応力値を計算
            const numDivisions = 20; // 部材を20分割
            const stressPoints = [];
            
            for (let k = 0; k <= numDivisions; k++) {
                const xi = k / numDivisions;
                let stressValue = 0;
                
                // 投影面と応力タイプに応じて適切な軸を選択
                let axis = 'y';
                if (frame.mode === 'xy') axis = 'z';
                else if (frame.mode === 'xz') axis = 'y';
                else if (frame.mode === 'yz') axis = 'x';
                
                if (stressType === 'moment') {
                    // 曲げモーメント（等分布荷重を考慮）
                    stressValue = calculateMemberMoment(forces, L, xi, axis, w);
                } else if (stressType === 'axial') {
                    // 軸力（一定）
                    stressValue = forces.N_i || 0;
                } else if (stressType === 'shear') {
                    // せん断力（等分布荷重を考慮）
                    stressValue = calculateMemberShear(forces, L, xi, axis, w);
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
                // 白い縁取り
                ctx.strokeStyle = 'white';
                ctx.strokeText(p1.value.toFixed(2), p1.x + perpX * p1.offset, p1.y - perpY * p1.offset - 8);
                // 黒いテキスト
                ctx.fillStyle = '#000';
                ctx.fillText(p1.value.toFixed(2), p1.x + perpX * p1.offset, p1.y - perpY * p1.offset - 8);
            }
            
            if (Math.abs(pN.value) > 0.01) {
                // 白い縁取り
                ctx.strokeStyle = 'white';
                ctx.strokeText(pN.value.toFixed(2), pN.x + perpX * pN.offset, pN.y - perpY * pN.offset - 8);
                // 黒いテキスト
                ctx.fillStyle = '#000';
                ctx.fillText(pN.value.toFixed(2), pN.x + perpX * pN.offset, pN.y - perpY * pN.offset - 8);
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
                ctx.strokeText(`Max: ${pMax.value.toFixed(2)}`, maxX, maxY - 12);
                ctx.fillStyle = pMax.value >= 0 ? '#cc0000' : '#0000cc';
                ctx.fillText(`Max: ${pMax.value.toFixed(2)}`, maxX, maxY - 12);
            }
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
            ctx.strokeText(maxRatio.toFixed(3), maxX, maxY - 12);
            // カラーテキスト
            ctx.fillStyle = textColor;
            ctx.fillText(maxRatio.toFixed(3), maxX, maxY - 12);
        });

        ctx.restore();
    });
};
