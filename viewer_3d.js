// viewer_3d.js

if (typeof THREE === 'undefined') {
    alert('3D描画ライブラリ(Three.js)が読み込まれていません。');
    throw new Error('Three.js not found');
}

// 3Dシーン用のグローバル変数
let scene, camera, renderer, controls, labelRenderer, animationFrameId;
const canvasContainer = document.getElementById('canvas-3d-container');
const infoPanel = document.getElementById('info-panel');

// ラベルグループ（表示/非表示制御用）
let nodeLabelsGroup, memberLabelsGroup, sectionLabelsGroup;

// ラベル表示状態
let labelVisibility = {
    nodes: true,
    members: true,
    sections: true
};

/**
 * 3Dシーンの初期化
 */
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
    camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    camera.position.set(0, 5, 20);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    canvasContainer.appendChild(renderer.domElement);

    labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    canvasContainer.appendChild(labelRenderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(50, 50, 50).normalize();
    scene.add(directionalLight);

    animate();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('message', receiveModelData);

    // チェックボックスのイベントリスナー設定
    setupLabelControls();
}

/**
 * メインウィンドウからのデータ受信と3Dモデル更新
 */
function receiveModelData(event) {
    if (event.data && event.data.type === 'updateModel') {
        if (infoPanel) {
            const p = infoPanel.querySelector('p:last-child');
            if(p) p.textContent = `最終更新: ${new Date().toLocaleTimeString()}`;
        }
        update3DModel(event.data.data);
    }
}

/**
 * 3Dモデルの再描画
 */
function update3DModel(data) {
    if (!data || !data.nodes || !data.members) return;

    // シーン内の全オブジェクトを完全に削除する再帰関数
    function disposeObject(obj) {
        if (obj.geometry) {
            obj.geometry.dispose();
        }
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => m.dispose());
            } else {
                obj.material.dispose();
            }
        }
        // 子要素を再帰的に削除
        while (obj.children.length > 0) {
            const child = obj.children[0];
            disposeObject(child);
            obj.remove(child);
        }
    }

    // シーン内の全オブジェクトを削除（ライトは除く）
    const objectsToRemove = [];
    scene.children.forEach(child => {
        if (!child.isLight) {
            objectsToRemove.push(child);
        }
    });
    objectsToRemove.forEach(obj => {
        disposeObject(obj);
        scene.remove(obj);
    });

    // 新しいモデルを構築
    build3DModel(scene, data.nodes, data.members);
}

function animate() {
    animationFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

// --- 以下、frame_analyzer.jsから移植した3Dモデル構築ロジック ---

function build3DModel(scene, nodes, members) {
    const memberGroup = new THREE.Group();
    const nodeMaterial = new THREE.MeshLambertMaterial({ color: 0x1565C0 });
    const nodeGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);

    // ラベルグループを初期化
    nodeLabelsGroup = new THREE.Group();
    memberLabelsGroup = new THREE.Group();
    sectionLabelsGroup = new THREE.Group();

    nodes.forEach((node, i) => {
        const nodeMesh = new THREE.Mesh(nodeGeometry, nodeMaterial);
        const nodeY = node.y !== undefined ? node.y : 0;  // 入力Y座標(水平)
        const nodeZ = node.z !== undefined ? node.z : 0;  // 入力Z座標(鉛直)
        nodeMesh.position.set(node.x, nodeZ, nodeY);  // Three.js: (X水平, Y鉛直上向き, Z水平)
        memberGroup.add(nodeMesh);

        // ピン支持の場合は赤い球体を追加
        if (node.support === 'pinned' || node.support === 'pin') {
            const supportMaterial = new THREE.MeshLambertMaterial({ color: 0xFF0000 });
            const supportSphere = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 32), supportMaterial);
            supportSphere.position.set(node.x, nodeZ, nodeY);
            memberGroup.add(supportSphere);
        }

        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'label';
        nodeDiv.textContent = `N${i + 1}`;
        const nodeLabel = new THREE.CSS2DObject(nodeDiv);
        nodeLabel.position.set(node.x, nodeZ + 0.5, nodeY);
        nodeLabelsGroup.add(nodeLabel);
    });

    members.forEach((member, index) => {
        try {
            const memberMesh = createMemberMesh(member, nodes);
            if (memberMesh) {
                memberGroup.add(memberMesh);

                const p1 = nodes[member.i];
                const p2 = nodes[member.j];
                const centerX = (p1.x + p2.x) / 2;
                const y1 = p1.y !== undefined ? p1.y : 0;  // 入力Y座標(実際はZ方向)
                const y2 = p2.y !== undefined ? p2.y : 0;
                const z1 = p1.z !== undefined ? p1.z : 0;  // 入力Z座標(実際はY方向)
                const z2 = p2.z !== undefined ? p2.z : 0;
                const centerY = (y1 + y2) / 2;
                const centerZ = (z1 + z2) / 2;

                // 部材番号ラベル(Three.js座標系)
                const memberDiv = document.createElement('div');
                memberDiv.className = 'label';
                memberDiv.textContent = `M${index + 1}`;
                const memberLabel = new THREE.CSS2DObject(memberDiv);
                memberLabel.position.set(centerX, centerZ, centerY);
                memberLabelsGroup.add(memberLabel);

                // 断面名称ラベル（部材ラベルの少し下に配置）
                const sectionName = getSectionName(member);
                if (sectionName) {
                    const sectionDiv = document.createElement('div');
                    sectionDiv.className = 'label-section';
                    sectionDiv.textContent = sectionName;
                    const sectionLabel = new THREE.CSS2DObject(sectionDiv);
                    sectionLabel.position.set(centerX, centerZ - 0.3, centerY);
                    sectionLabelsGroup.add(sectionLabel);
                }
            }
        } catch(e) {
            console.warn(`部材 ${member.i+1}-${member.j+1} の3Dメッシュ作成に失敗しました:`, e);
        }
    });

    scene.add(memberGroup);
    scene.add(nodeLabelsGroup);
    scene.add(memberLabelsGroup);
    scene.add(sectionLabelsGroup);

    // 現在の表示状態を適用
    setGroupVisibility(nodeLabelsGroup, labelVisibility.nodes);
    setGroupVisibility(memberLabelsGroup, labelVisibility.members);
    setGroupVisibility(sectionLabelsGroup, labelVisibility.sections);

    const box = new THREE.Box3().setFromObject(memberGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (!isFinite(maxDim) || maxDim === 0) {
        camera.position.set(0, 0, 50);
        controls.target.set(0, 0, 0);
    } else {
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;

        camera.position.set(center.x, center.y, center.z + cameraZ);
        controls.target.copy(center);
    }
    controls.update();
}

function createMemberMesh(member, nodes) {
    const nodeI = nodes[member.i];
    const nodeJ = nodes[member.j];

    if (!nodeI || !nodeJ) return null;

    // 3D対応: 入力(X,Y,Z) → Three.js(X,Z,Y)でZ=鉛直
    const y1 = nodeI.y !== undefined ? nodeI.y : 0;
    const y2 = nodeJ.y !== undefined ? nodeJ.y : 0;
    const z1 = nodeI.z !== undefined ? nodeI.z : 0;
    const z2 = nodeJ.z !== undefined ? nodeJ.z : 0;
    const p1 = new THREE.Vector3(nodeI.x, z1, y1);  // Three.js: (X水平, Y鉛直, Z水平)
    const p2 = new THREE.Vector3(nodeJ.x, z2, y2);
    const memberLength = p1.distanceTo(p2);
    if (memberLength <= 0) return null;

    if (!member.sectionInfo || !member.sectionInfo.rawDims) {
        // 推定断面は円形で計算
        // member.Aはm²単位なので、cm²に変換
        const A_m2 = member.A || 1e-3; // m²
        const A_cm2 = A_m2 * 1e4; // m² → cm²

        // A = π * r^2 より r = sqrt(A / π)
        const radius_cm = Math.sqrt(A_cm2 / Math.PI); // cm
        const diameter_cm = radius_cm * 2; // cm
        const diameter_mm = diameter_cm * 10; // mm に変換

        member.sectionInfo = {
            rawDims: {
                D: diameter_mm,  // 実際の直径（mm）を保存
                D_scaled: diameter_mm  // 3D表示用の直径（スケーリングなし）
            },
            typeKey: 'estimated',
            label: '推定断面（円形）'
        };
    }

    const shape = createSectionShape(member.sectionInfo, member);
    if (!shape) return null;

    const extrudeSettings = { depth: memberLength, bevelEnabled: false };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    const isEstimated = member.sectionInfo.typeKey === 'estimated';

    // より見やすいマテリアル設定
    const material = new THREE.MeshStandardMaterial({
        color: isEstimated ? 0xFF8C00 : 0x8B9DC3,  // 推定断面:オレンジ / 通常:ライトブルー
        metalness: 0.3,
        roughness: 0.7,
        flatShading: false
    });

    const mesh = new THREE.Mesh(geometry, material);

    // エッジラインを追加（断面形状を強調）
    const edgesGeometry = new THREE.EdgesGeometry(geometry, 15); // 15度以上の角度のエッジのみ
    const edgesMaterial = new THREE.LineBasicMaterial({
        color: 0x000000,
        linewidth: 1,
        transparent: true,
        opacity: 0.5,
        depthTest: false // 正面からも見えるように
    });
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    mesh.add(edges);

    const direction = new THREE.Vector3().subVectors(p2, p1).normalize();
    const isVertical = Math.abs(direction.y) > 0.95;

    mesh.position.copy(p1);
    mesh.up.set(isVertical ? 1 : 0, isVertical ? 0 : 1, 0);
    mesh.lookAt(p2);

    if (member.sectionAxis && member.sectionAxis.key === 'y') {
        mesh.rotateZ(Math.PI / 2);
    }

    const hingeGroup = new THREE.Group();
    const redMaterial = new THREE.MeshLambertMaterial({ color: 0xFF0000 });
    const whiteMaterial = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });

    const createHinge = () => {
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 32), redMaterial);
        const group = new THREE.Group();
        group.add(sphere);
        return group;
    };

    if (member.i_conn === 'pinned') {
        const hingeI = createHinge();
        hingeI.position.copy(p1).addScaledVector(direction, 0.35);
        hingeGroup.add(hingeI);
    }

    if (member.j_conn === 'pinned') {
        const hingeJ = createHinge();
        hingeJ.position.copy(p2).addScaledVector(direction, -0.35);
        hingeGroup.add(hingeJ);
    }

    if (hingeGroup.children.length > 0) {
        const combinedGroup = new THREE.Group();
        combinedGroup.add(mesh, hingeGroup);
        return combinedGroup;
    }

    return mesh;
}

function createSectionShape(sectionInfo, member) {
    const dims = sectionInfo.rawDims;
    const typeKey = sectionInfo.typeKey;
    if (!dims || !typeKey) return null;
    const shape = new THREE.Shape();
    const MM_TO_M = 0.001;

    switch (typeKey) {
        case 'hkatakou_hiro':
        case 'hkatakou_naka':
        case 'hkatakou_hoso':
        case 'ikatakou':
        case 'keiryouhkatakou':
        case 'keiryourippuhkatakou': {
            const { H, B, t1, t2 } = dims;
            if (!H || !B || !t1 || !t2) return null;
            const halfH = (H * MM_TO_M) / 2;
            const halfB = (B * MM_TO_M) / 2;
            const halfT1 = (t1 * MM_TO_M) / 2;
            const t2m = t2 * MM_TO_M;
            shape.moveTo(-halfB, halfH);
            shape.lineTo(halfB, halfH);
            shape.lineTo(halfB, halfH - t2m);
            shape.lineTo(halfT1, halfH - t2m);
            shape.lineTo(halfT1, -halfH + t2m);
            shape.lineTo(halfB, -halfH + t2m);
            shape.lineTo(halfB, -halfH);
            shape.lineTo(-halfB, -halfH);
            shape.lineTo(-halfB, -halfH + t2m);
            shape.lineTo(-halfT1, -halfH + t2m);
            shape.lineTo(-halfT1, halfH - t2m);
            shape.lineTo(-halfB, halfH - t2m);
            shape.lineTo(-halfB, halfH);
            break;
        }
        case 'seihoukei':
        case 'tyouhoukei': {
            const A = dims.A, B = dims.B || A, t = dims.t;
            if (!A || !B || !t) return null;
            const halfA = (A * MM_TO_M) / 2;
            const halfB = (B * MM_TO_M) / 2;
            const tm = t * MM_TO_M;
            shape.moveTo(-halfB, -halfA);
            shape.lineTo(halfB, -halfA);
            shape.lineTo(halfB, halfA);
            shape.lineTo(-halfB, halfA);
            shape.lineTo(-halfB, -halfA);
            const hole = new THREE.Path();
            hole.moveTo(-halfB + tm, -halfA + tm);
            hole.lineTo(-halfB + tm, halfA - tm);
            hole.lineTo(halfB - tm, halfA - tm);
            hole.lineTo(halfB - tm, -halfA + tm);
            hole.lineTo(-halfB + tm, -halfA + tm);
            shape.holes.push(hole);
            break;
        }
        case 'koukan': {
            const { D, t } = dims;
            if (!D || !t) return null;
            const Dm = D * MM_TO_M;
            const tm = t * MM_TO_M;
            const outerRadius = Dm / 2;
            const innerRadius = outerRadius - tm;
            shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
            const hole = new THREE.Path();
            hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
            shape.holes.push(hole);
            break;
        }
        case 'mizogatakou':
        case 'keimizogatakou': {
            const { H, B, t1, t2, A, t } = dims;
            const height = H * MM_TO_M;
            const flangeWidth = (B || A) * MM_TO_M;
            const webThick = (t1 || t) * MM_TO_M;
            const flangeThick = (t2 || t) * MM_TO_M;
            if(!height || !flangeWidth || !webThick || !flangeThick) return null;
            const halfH = height / 2;
            shape.moveTo(0, halfH);
            shape.lineTo(flangeWidth, halfH);
            shape.lineTo(flangeWidth, halfH - flangeThick);
            shape.lineTo(webThick, halfH - flangeThick);
            shape.lineTo(webThick, -halfH + flangeThick);
            shape.lineTo(flangeWidth, -halfH + flangeThick);
            shape.lineTo(flangeWidth, -halfH);
            shape.lineTo(0, -halfH);
            shape.lineTo(0, halfH);
            break;
        }
        case 'rippumizokatakou': {
            const { H, A, C, t } = dims;
            if (!H || !A || !C || !t) return null;
            const height = H * MM_TO_M;
            const flangeWidth = A * MM_TO_M;
            const lip = C * MM_TO_M;
            const thick = t * MM_TO_M;
            const halfH = height / 2;
            shape.moveTo(0, halfH);
            shape.lineTo(flangeWidth, halfH);
            shape.lineTo(flangeWidth, halfH - lip);
            shape.lineTo(flangeWidth - thick, halfH - lip);
            shape.lineTo(flangeWidth - thick, halfH - thick);
            shape.lineTo(thick, halfH - thick);
            shape.lineTo(thick, -halfH + thick);
            shape.lineTo(flangeWidth-thick, -halfH+thick);
            shape.lineTo(flangeWidth-thick, -halfH+lip);
            shape.lineTo(flangeWidth,-halfH+lip);
            shape.lineTo(flangeWidth,-halfH);
            shape.lineTo(0,-halfH);
            shape.lineTo(0,halfH);
            break;
        }
        case 'touhenyamakatakou':
        case 'futouhenyamagata': {
            const { A, B, t } = dims;
            const a = (A || 0) * MM_TO_M;
            const b = (B || A || 0) * MM_TO_M;
            const thick = (t || 0) * MM_TO_M;
            if (!a || !b || !thick) return null;
            shape.moveTo(0, a);
            shape.lineTo(thick, a);
            shape.lineTo(thick, thick);
            shape.lineTo(b, thick);
            shape.lineTo(b, 0);
            shape.lineTo(0, 0);
            shape.lineTo(0, a);
            break;
        }
        case '矩形':
        case 'rectangular': {
            const { H, B } = dims;
            if (!H || !B) return null;
            const height = H * MM_TO_M;
            const width = B * MM_TO_M;
            const halfH = height / 2;
            const halfB = width / 2;
            shape.moveTo(-halfB, -halfH);
            shape.lineTo(halfB, -halfH);
            shape.lineTo(halfB, halfH);
            shape.lineTo(-halfB, halfH);
            shape.lineTo(-halfB, -halfH);
            break;
        }
        case '円形':
        case 'circular': {
            const { D } = dims;
            if (!D) return null;
            const radius = (D * MM_TO_M) / 2;
            shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
            break;
        }
        case 'estimated':
        default: {
            // 推定断面は円形で表示
            // 3D表示用のスケール済み直径を使用
            if (dims.D_scaled) {
                const radius = (dims.D_scaled * MM_TO_M) / 2;
                shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
            } else if (dims.D) {
                // D_scaledがない場合はDを使用（スケーリングなし）
                const radius = (dims.D * MM_TO_M) / 2;
                shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
            } else {
                // 旧データ対応: memberから直接計算
                const A_m2 = member.A || 1e-3; // m²
                const A_cm2 = A_m2 * 1e4; // m² → cm²
                const radius_cm = Math.sqrt(A_cm2 / Math.PI);
                const diameter_mm = radius_cm * 2 * 10; // cm → mm（スケーリングなし）
                const radius = (diameter_mm * MM_TO_M) / 2;
                shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
            }
            break;
        }
    }
    return shape;
}

/**
 * 部材の断面名称を取得（板厚まで含んだ完全な名称）
 */
function getSectionName(member) {
    if (!member.sectionInfo) return null;

    const typeKey = member.sectionInfo.typeKey;
    const dims = member.sectionInfo.rawDims;

    // typeKeyから推定の場合
    if (typeKey === 'estimated') {
        // 直径情報がある場合は表示（実際の直径をそのまま使用）
        if (dims && dims.D) {
            const diameter = dims.D.toFixed(1);
            return `推定断面 φ${diameter}`;
        }
        return '推定断面（円形）';
    }

    // rawDimsがない場合は既存のlabelを使用
    if (!dims) {
        return member.sectionInfo.label || null;
    }

    // 形状タイプに応じて板厚まで含んだ名称を生成
    switch (typeKey) {
        case 'hkatakou_hiro':
        case 'hkatakou_naka':
        case 'hkatakou_hoso':
            return `H-${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
        case 'ikatakou':
            return `I-${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
        case 'keiryouhkatakou':
            return `H-${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
        case 'keiryourippuhkatakou':
            return `H-${dims.H}×${dims.B}×${dims.t1}×${dims.t2}`;
        case 'seihoukei':
        case 'tyouhoukei':
            return `□-${dims.A}×${dims.B || dims.A}×${dims.t}`;
        case 'koukan':
            return `○-${dims.D}×${dims.t}`;
        case 'mizogatakou':
        case 'keimizogatakou':
            return `C-${dims.H}×${dims.B || dims.A}×${dims.t1 || dims.t}×${dims.t2 || dims.t}`;
        case 'rippumizokatakou':
            return `C-${dims.H}×${dims.A}×${dims.C}×${dims.t}`;
        case 'touhenyamakatakou':
            return `L-${dims.A}×${dims.A}×${dims.t}`;
        case 'futouhenyamagata':
            return `L-${dims.A}×${dims.B}×${dims.t}`;
        case '矩形':
        case 'rectangular':
            return `矩形-${dims.H}×${dims.B}`;
        case '円形':
        case 'circular':
            return `円形-φ${dims.D}`;
        default:
            // typeKeyがあるがswitchに該当しない場合、labelを使用
            return member.sectionInfo.label || null;
    }
}

/**
 * ラベルグループ内の全要素のvisibleを設定
 */
function setGroupVisibility(group, visible) {
    if (!group) return;
    group.visible = visible;
    group.children.forEach(child => {
        child.visible = visible;
    });
}

/**
 * ラベル表示制御のセットアップ
 */
function setupLabelControls() {
    const showNodeLabels = document.getElementById('show-node-labels');
    const showMemberLabels = document.getElementById('show-member-labels');
    const showSectionLabels = document.getElementById('show-section-labels');

    if (showNodeLabels) {
        showNodeLabels.addEventListener('change', (e) => {
            labelVisibility.nodes = e.target.checked;
            setGroupVisibility(nodeLabelsGroup, e.target.checked);
        });
    }

    if (showMemberLabels) {
        showMemberLabels.addEventListener('change', (e) => {
            labelVisibility.members = e.target.checked;
            setGroupVisibility(memberLabelsGroup, e.target.checked);
        });
    }

    if (showSectionLabels) {
        showSectionLabels.addEventListener('change', (e) => {
            labelVisibility.sections = e.target.checked;
            setGroupVisibility(sectionLabelsGroup, e.target.checked);
        });
    }
}

// アプリケーションを開始
init();
