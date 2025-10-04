// model_viewer_3d.js - モデル図の3D表示機能

if (typeof THREE === 'undefined') {
    console.warn('Three.js not loaded - 3D model view will not be available');
}

// モデル図3Dビューア用のグローバル変数
let modelScene, modelCamera, modelRenderer, modelControls, modelAnimationFrameId;
let modelLabelRenderer; // CSS2DRenderer for labels
let modelNodeLabelsGroup, modelMemberLabelsGroup;
let modelRaycaster, modelMouse;
let modelNodeMeshes = [];  // 節点メッシュの配列
let modelMemberMeshes = []; // 部材メッシュの配列
let modelSelectedNode = null;
let modelSelectedMember = null;
let modelFirstMemberNode = null;
let modelGridHelper = null;
let modelContainerResizeObserver = null; // コンテナのリサイズ監視用
let modelLastKnownSize = { width: 0, height: 0 }; // 最後に認識したコンテナサイズ

/**
 * モデル図3Dシーンの初期化
 */
function initModel3DView() {
    if (typeof THREE === 'undefined') {
        console.error('Three.js is not loaded');
        return false;
    }

    const container = document.getElementById('model-3d-container');
    if (!container) {
        console.error('Model 3D container not found');
        return false;
    }

    // 既存のシーンをクリア
    if (modelRenderer) {
        container.removeChild(modelRenderer.domElement);
        modelRenderer.dispose();
    }
    if (modelLabelRenderer) {
        // CSS2DRendererのDOM要素内のすべてのラベルを削除
        while (modelLabelRenderer.domElement.firstChild) {
            modelLabelRenderer.domElement.removeChild(modelLabelRenderer.domElement.firstChild);
        }
        container.removeChild(modelLabelRenderer.domElement);
    }
    if (modelAnimationFrameId) {
        cancelAnimationFrame(modelAnimationFrameId);
    }
    if (modelContainerResizeObserver) {
        modelContainerResizeObserver.disconnect();
        modelContainerResizeObserver = null;
    }
    modelLastKnownSize = { width: 0, height: 0 };

    // シーン作成
    modelScene = new THREE.Scene();
    modelScene.background = new THREE.Color(0xf5f5f5);

    // カメラ作成（親コンテナのサイズを使用）
    const parentContainer = container.parentElement;
    const containerWidth = parentContainer ? parentContainer.clientWidth : container.clientWidth;
    const containerHeight = parentContainer ? parentContainer.clientHeight : container.clientHeight;
    const actualWidth = Math.max(1, containerWidth - 20); // パディング考慮
    const actualHeight = Math.max(1, containerHeight - 20);
    
    const aspect = actualWidth / actualHeight;
    modelCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
    modelCamera.position.set(10, 10, 10);

    // レンダラー作成（高品質設定）
    modelRenderer = new THREE.WebGLRenderer({ 
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        precision: 'highp',
        stencil: false,
        depth: true
    });
    modelRenderer.setSize(actualWidth, actualHeight);
    
    // ピクセル比率を設定（高解像度ディスプレイ対応、最大2倍まで）
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    modelRenderer.setPixelRatio(pixelRatio);
    
    // 出力エンコーディングを設定（色の正確性向上）
    if (modelRenderer.outputEncoding !== undefined) {
        modelRenderer.outputEncoding = THREE.sRGBEncoding;
    }
    
    // シャドウとトーンマッピングの設定
    modelRenderer.shadowMap.enabled = false; // シャドウは不要なのでパフォーマンス向上
    modelRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    modelRenderer.toneMappingExposure = 1.0;
    
    container.appendChild(modelRenderer.domElement);

    // CSS2DRendererを作成（ラベル用）
    if (typeof THREE.CSS2DRenderer !== 'undefined') {
        modelLabelRenderer = new THREE.CSS2DRenderer();
        modelLabelRenderer.setSize(actualWidth, actualHeight);
        modelLabelRenderer.domElement.style.position = 'absolute';
        modelLabelRenderer.domElement.style.top = '0';
        modelLabelRenderer.domElement.style.pointerEvents = 'none';
        container.appendChild(modelLabelRenderer.domElement);
    }

    // コントロール作成
    modelControls = new THREE.OrbitControls(modelCamera, modelRenderer.domElement);
    modelControls.enableDamping = true;
    modelControls.dampingFactor = 0.05;

    // Raycaster初期化
    modelRaycaster = new THREE.Raycaster();
    modelMouse = new THREE.Vector2();

    // グリッド追加
    const gridSize = 50;
    const gridDivisions = 50;
    modelGridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x888888, 0xcccccc);
    modelScene.add(modelGridHelper);

    // ライト追加（改善版：より鮮明な表示）
    // 環境光を少し強めに
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    modelScene.add(ambientLight);
    
    // メインのディレクショナルライト（上から）
    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight1.position.set(50, 50, 50);
    modelScene.add(directionalLight1);
    
    // サブのディレクショナルライト（反対側から）
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight2.position.set(-50, 30, -50);
    modelScene.add(directionalLight2);
    
    // 補助ライト（横から）
    const directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.2);
    directionalLight3.position.set(0, 20, 50);
    modelScene.add(directionalLight3);

    // マウスイベント追加
    modelRenderer.domElement.addEventListener('click', onModel3DClick);
    modelRenderer.domElement.addEventListener('dblclick', onModel3DDoubleClick);
    modelRenderer.domElement.addEventListener('contextmenu', onModel3DContextMenu);
    modelRenderer.domElement.addEventListener('mousemove', onModel3DMouseMove);

    // アニメーションループ開始
    animateModel3D();

    // リサイズ対応
    window.addEventListener('resize', onModel3DResize);
    
    // コンテナ自体のリサイズを監視（ユーザーがハンドルで伸縮した場合）
    if (typeof ResizeObserver !== 'undefined') {
        const canvasContainer = container.parentElement;
        if (canvasContainer && canvasContainer.classList.contains('canvas-container')) {
            // 初期サイズを記録
            const rect = canvasContainer.getBoundingClientRect();
            modelLastKnownSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
            
            modelContainerResizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const { width, height } = entry.contentRect;
                    const currentSize = { width: Math.round(width), height: Math.round(height) };
                    
                    // サイズが実際に変更された場合のみ処理
                    if (currentSize.width !== modelLastKnownSize.width || 
                        currentSize.height !== modelLastKnownSize.height) {
                        modelLastKnownSize = currentSize;
                        onModel3DResize();
                    }
                }
            });
            modelContainerResizeObserver.observe(canvasContainer);
        }
    }

    return true;
}

/**
 * モデル図3Dのアニメーションループ
 */
function animateModel3D() {
    modelAnimationFrameId = requestAnimationFrame(animateModel3D);
    if (modelControls) modelControls.update();
    if (modelRenderer && modelScene && modelCamera) {
        modelRenderer.render(modelScene, modelCamera);
    }
    if (modelLabelRenderer && modelScene && modelCamera) {
        modelLabelRenderer.render(modelScene, modelCamera);
    }
}

/**
 * モデル図3Dのリサイズ処理
 */
function onModel3DResize() {
    const container = document.getElementById('model-3d-container');
    if (!container || !modelCamera || !modelRenderer) return;

    // 親コンテナ（.canvas-container）のサイズを取得
    const parentContainer = container.parentElement;
    const width = parentContainer ? parentContainer.clientWidth : container.clientWidth;
    const height = parentContainer ? parentContainer.clientHeight : container.clientHeight;

    // パディングを考慮（.canvas-containerには10pxのパディングがある）
    const actualWidth = Math.max(1, width - 20);
    const actualHeight = Math.max(1, height - 20);

    modelCamera.aspect = actualWidth / actualHeight;
    modelCamera.updateProjectionMatrix();
    modelRenderer.setSize(actualWidth, actualHeight);
    if (modelLabelRenderer) {
        modelLabelRenderer.setSize(actualWidth, actualHeight);
    }
}

/**
 * モデル図3Dの更新
 */
function updateModel3DView(nodes, members, memberLoads = []) {
    if (!modelScene) return;

    // 既存のオブジェクトを削除（グリッドとライトは保持）
    const objectsToRemove = [];
    modelScene.children.forEach(child => {
        if (!child.isLight && child !== modelGridHelper) {
            objectsToRemove.push(child);
        }
    });
    objectsToRemove.forEach(obj => {
        // CSS2DObjectの場合、DOM要素も削除
        if (obj.isCSS2DObject && obj.element && obj.element.parentNode) {
            obj.element.parentNode.removeChild(obj.element);
        }
        // ジオメトリとマテリアルのクリーンアップ
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => m.dispose());
            } else {
                obj.material.dispose();
            }
        }
        // グループの場合、子要素も再帰的に処理
        if (obj.children && obj.children.length > 0) {
            obj.children.forEach(child => {
                if (child.isCSS2DObject && child.element && child.element.parentNode) {
                    child.element.parentNode.removeChild(child.element);
                }
            });
        }
        modelScene.remove(obj);
    });

    // 配列をクリア
    modelNodeMeshes = [];
    modelMemberMeshes = [];

    if (!nodes || nodes.length === 0) return;

    const modelGroup = new THREE.Group();

    // 節点を描画（高品質マテリアルを使用）
    const nodeGeometry = new THREE.SphereGeometry(0.15, 32, 32); // セグメント数を増やして滑らかに
    const nodeMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x1565C0,
        metalness: 0.3,
        roughness: 0.4,
        emissive: 0x1565C0,
        emissiveIntensity: 0.1
    });
    const selectedNodeMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF6600,
        metalness: 0.3,
        roughness: 0.4,
        emissive: 0xFF6600,
        emissiveIntensity: 0.2
    });

    nodes.forEach((node, i) => {
        const material = (modelSelectedNode === i) ? selectedNodeMaterial : nodeMaterial;
        const nodeMesh = new THREE.Mesh(nodeGeometry, material.clone());
        const nodeY = node.y !== undefined ? node.y : 0;
        const nodeZ = node.z !== undefined ? node.z : 0;
        nodeMesh.position.set(node.x, nodeZ, nodeY);
        nodeMesh.userData = { type: 'node', index: i };
        modelGroup.add(nodeMesh);
        modelNodeMeshes.push(nodeMesh);

        // 節点ラベルを追加（CSS2DObject）
        if (typeof THREE.CSS2DObject !== 'undefined') {
            const nodeLabel = document.createElement('div');
            nodeLabel.className = 'node-label-3d';
            nodeLabel.textContent = i + 1;
            nodeLabel.style.color = '#1565C0';
            nodeLabel.style.fontSize = '14px';
            nodeLabel.style.fontWeight = 'bold';
            nodeLabel.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
            nodeLabel.style.padding = '2px 4px';
            nodeLabel.style.borderRadius = '3px';
            nodeLabel.style.border = '1px solid #1565C0';
            nodeLabel.style.pointerEvents = 'none';
            nodeLabel.style.userSelect = 'none';
            
            const labelObject = new THREE.CSS2DObject(nodeLabel);
            labelObject.position.set(node.x, nodeZ + 0.3, nodeY); // 節点の少し上に配置
            modelGroup.add(labelObject);
        }

        // ピン支持の場合は赤い球体を追加
        if (node.support === 'pinned' || node.support === 'pin') {
            const supportMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xFF0000,
                metalness: 0.4,
                roughness: 0.3,
                emissive: 0xFF0000,
                emissiveIntensity: 0.15
            });
            const supportSphere = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 32), supportMaterial);
            supportSphere.position.set(node.x, nodeZ, nodeY);
            modelGroup.add(supportSphere);
        }

        // 固定支持の場合は緑の立方体を追加
        if (node.support === 'fixed' || node.support === 'x') {
            const supportMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x00AA00,
                metalness: 0.4,
                roughness: 0.3,
                emissive: 0x00AA00,
                emissiveIntensity: 0.15
            });
            const supportBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), supportMaterial);
            supportBox.position.set(node.x, nodeZ, nodeY);
            modelGroup.add(supportBox);
        }
    });

    // 部材を描画（高品質マテリアルを使用）
    const memberMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x888888,
        metalness: 0.6,
        roughness: 0.4,
        emissive: 0x444444,
        emissiveIntensity: 0.05
    });
    const selectedMemberMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF6600,
        metalness: 0.5,
        roughness: 0.3,
        emissive: 0xFF6600,
        emissiveIntensity: 0.2
    });

    members.forEach((member, index) => {
        const nodeI = nodes[member.i];
        const nodeJ = nodes[member.j];
        if (!nodeI || !nodeJ) return;

        const y1 = nodeI.y !== undefined ? nodeI.y : 0;
        const y2 = nodeJ.y !== undefined ? nodeJ.y : 0;
        const z1 = nodeI.z !== undefined ? nodeI.z : 0;
        const z2 = nodeJ.z !== undefined ? nodeJ.z : 0;

        const p1 = new THREE.Vector3(nodeI.x, z1, y1);
        const p2 = new THREE.Vector3(nodeJ.x, z2, y2);

        const direction = new THREE.Vector3().subVectors(p2, p1);
        const length = direction.length();

        // 部材を円筒で描画（セグメント数を増やして滑らかに）
        const radius = 0.05;
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 16, 1); // 8→16に増やす
        const material = (modelSelectedMember === index) ? selectedMemberMaterial.clone() : memberMaterial.clone();
        const cylinder = new THREE.Mesh(geometry, material);

        // 部材の中心位置
        const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        cylinder.position.copy(midpoint);

        // 部材の向きを設定
        const axis = new THREE.Vector3(0, 1, 0);
        cylinder.quaternion.setFromUnitVectors(axis, direction.clone().normalize());

        cylinder.userData = { type: 'member', index: index };
        modelGroup.add(cylinder);
        modelMemberMeshes.push(cylinder);

        // 部材ラベルを追加（CSS2DObject）
        if (typeof THREE.CSS2DObject !== 'undefined') {
            const memberLabel = document.createElement('div');
            memberLabel.className = 'member-label-3d';
            memberLabel.textContent = index + 1;
            memberLabel.style.color = '#666666';
            memberLabel.style.fontSize = '12px';
            memberLabel.style.fontWeight = 'normal';
            memberLabel.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
            memberLabel.style.padding = '1px 3px';
            memberLabel.style.borderRadius = '2px';
            memberLabel.style.border = '1px solid #888888';
            memberLabel.style.pointerEvents = 'none';
            memberLabel.style.userSelect = 'none';
            
            const labelObject = new THREE.CSS2DObject(memberLabel);
            // 部材の中点に配置（少しオフセット）
            const offset = new THREE.Vector3(0, 0.2, 0);
            labelObject.position.copy(midpoint).add(offset);
            modelGroup.add(labelObject);
        }

        // ピン接合の表示（高品質マテリアル）
        const redMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFF0000,
            metalness: 0.5,
            roughness: 0.3,
            emissive: 0xFF0000,
            emissiveIntensity: 0.2
        });

        if (member.i_conn === 'pinned') {
            const hingeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), redMaterial);
            hingeSphere.position.copy(p1).addScaledVector(direction.normalize(), 0.3);
            modelGroup.add(hingeSphere);
        }

        if (member.j_conn === 'pinned') {
            const hingeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), redMaterial);
            hingeSphere.position.copy(p2).addScaledVector(direction.normalize(), -0.3);
            modelGroup.add(hingeSphere);
        }
    });

    // 部材荷重の描画（等分布荷重の矢印）
    if (memberLoads && memberLoads.length > 0) {
        memberLoads.forEach(load => {
            const member = members[load.memberIndex];
            if (!member) return;

            const wy = load.wy || load.w || 0;  // Y方向荷重（下向き）
            const wz = load.wz || 0;  // Z方向荷重

            // 荷重が0の場合はスキップ
            if (wy === 0 && wz === 0) return;

            const nodeI = nodes[member.i];
            const nodeJ = nodes[member.j];
            if (!nodeI || !nodeJ) return;

            const y1 = nodeI.y !== undefined ? nodeI.y : 0;
            const y2 = nodeJ.y !== undefined ? nodeJ.y : 0;
            const z1 = nodeI.z !== undefined ? nodeI.z : 0;
            const z2 = nodeJ.z !== undefined ? nodeJ.z : 0;

            const p1 = new THREE.Vector3(nodeI.x, z1, y1);
            const p2 = new THREE.Vector3(nodeJ.x, z2, y2);
            const direction = new THREE.Vector3().subVectors(p2, p1);
            const length = direction.length();

            // 等分布荷重の矢印を複数描画
            const numArrows = 5;
            const arrowColor = load.isFromSelfWeight ? 0x00aa00 : 0xff4500;
            const arrowLength = 0.8;  // 矢印の長さ

            for (let i = 0; i <= numArrows; i++) {
                const t = i / numArrows;
                const position = new THREE.Vector3().lerpVectors(p1, p2, t);

                // Y方向荷重（重力方向）
                if (wy !== 0) {
                    const arrowDir = new THREE.Vector3(0, 0, Math.sign(wy));  // Z軸方向（画面上下）
                    const arrowOrigin = position.clone().sub(arrowDir.clone().multiplyScalar(arrowLength));
                    const arrow = new THREE.ArrowHelper(
                        arrowDir,
                        arrowOrigin,
                        arrowLength,
                        arrowColor,
                        arrowLength * 0.2,  // ヘッドの長さ
                        arrowLength * 0.15  // ヘッドの幅
                    );
                    modelGroup.add(arrow);
                }

                // Z方向荷重
                if (wz !== 0) {
                    const arrowDir = new THREE.Vector3(0, Math.sign(wz), 0);  // Y軸方向
                    const arrowOrigin = position.clone().sub(arrowDir.clone().multiplyScalar(arrowLength));
                    const arrow = new THREE.ArrowHelper(
                        arrowDir,
                        arrowOrigin,
                        arrowLength,
                        arrowColor,
                        arrowLength * 0.2,
                        arrowLength * 0.15
                    );
                    modelGroup.add(arrow);
                }
            }

            // 荷重値のラベルを部材中央に表示
            if (typeof THREE.CSS2DObject !== 'undefined') {
                const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
                const loadLabel = document.createElement('div');
                loadLabel.className = 'load-label-3d';

                let loadText = '';
                if (wy !== 0 && wz !== 0) {
                    loadText = `wy=${Math.abs(wy).toFixed(2)} wz=${Math.abs(wz).toFixed(2)}kN/m`;
                } else if (wy !== 0) {
                    loadText = `${Math.abs(wy).toFixed(2)}kN/m`;
                } else {
                    loadText = `wz=${Math.abs(wz).toFixed(2)}kN/m`;
                }

                loadLabel.textContent = loadText;
                loadLabel.style.color = load.isFromSelfWeight ? '#00aa00' : '#ff4500';
                loadLabel.style.fontSize = '11px';
                loadLabel.style.fontWeight = 'bold';
                loadLabel.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
                loadLabel.style.padding = '2px 4px';
                loadLabel.style.borderRadius = '3px';
                loadLabel.style.border = `1px solid ${load.isFromSelfWeight ? '#00aa00' : '#ff4500'}`;
                loadLabel.style.pointerEvents = 'none';
                loadLabel.style.userSelect = 'none';

                const labelObject = new THREE.CSS2DObject(loadLabel);
                labelObject.position.copy(midpoint).add(new THREE.Vector3(0, 0.5, 0));
                modelGroup.add(labelObject);
            }
        });
    }

    // 部材追加モードで第一節点が選択されている場合
    if (modelFirstMemberNode !== null && nodes[modelFirstMemberNode]) {
        const node = nodes[modelFirstMemberNode];
        const nodeY = node.y !== undefined ? node.y : 0;
        const nodeZ = node.z !== undefined ? node.z : 0;
        const highlightMaterial = new THREE.MeshLambertMaterial({ color: 0xFFA500, opacity: 0.7, transparent: true });
        const highlightSphere = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), highlightMaterial);
        highlightSphere.position.set(node.x, nodeZ, nodeY);
        modelGroup.add(highlightSphere);
    }

    modelScene.add(modelGroup);

    // 初回のみカメラ位置を調整
    if (modelGroup.children.length > 0) {
        const box = new THREE.Box3().setFromObject(modelGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        if (isFinite(maxDim) && maxDim > 0 && !modelControls.target.length()) {
            const distance = maxDim * 2;
            modelCamera.position.set(center.x + distance, center.y + distance, center.z + distance);
            modelControls.target.copy(center);
            modelControls.update();
        }
    }
}

/**
 * 3Dビューの自動スケーリング（カメラ位置をモデル全体に合わせる）
 */
function autoScaleModel3DView() {
    if (!modelScene || !modelCamera || !modelControls) {
        console.warn('3D view not initialized');
        return;
    }

    // シーン内のすべてのメッシュからバウンディングボックスを計算
    const objectsToFit = [];
    modelScene.traverse((obj) => {
        if (obj.isMesh || obj.isGroup) {
            objectsToFit.push(obj);
        }
    });

    if (objectsToFit.length === 0) {
        console.warn('No objects to fit in 3D view');
        return;
    }

    // モデル全体のバウンディングボックスを計算
    const box = new THREE.Box3();
    objectsToFit.forEach(obj => {
        const objBox = new THREE.Box3().setFromObject(obj);
        box.union(objBox);
    });

    if (box.isEmpty()) {
        console.warn('Bounding box is empty');
        return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    if (!isFinite(size.x) || !isFinite(size.y) || !isFinite(size.z)) {
        console.warn('Invalid model dimensions');
        return;
    }

    // カメラの視野角とアスペクト比を取得
    const fov = modelCamera.fov * (Math.PI / 180);
    const aspect = modelCamera.aspect;
    
    // 現在のカメラの方向を保持（現在の向きを基準にする）
    const currentDirection = new THREE.Vector3();
    modelCamera.getWorldDirection(currentDirection);
    
    // モデルの対角線の長さを計算
    const diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
    
    // カメラの視野角とアスペクト比を考慮した距離を計算
    // 縦方向と横方向の両方を考慮し、大きい方を採用
    const fovVertical = fov;
    const fovHorizontal = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    
    // 表示枠一杯に収めるため、より厳密な計算を行う
    const distanceVertical = diagonal / (2 * Math.tan(fovVertical / 2));
    const distanceHorizontal = diagonal / (2 * Math.tan(fovHorizontal / 2));
    
    // 両方に収まる距離を採用（大きい方）+ わずかなマージン（5%）
    const distance = Math.max(distanceVertical, distanceHorizontal) * 1.05;

    // カメラ位置を更新（斜め上から見下ろす位置）
    const angle = Math.PI / 4; // 45度
    const elevation = Math.PI / 6; // 30度の仰角
    
    modelCamera.position.set(
        center.x + distance * Math.cos(angle) * Math.cos(elevation),
        center.y + distance * Math.sin(elevation),
        center.z + distance * Math.sin(angle) * Math.cos(elevation)
    );

    // コントロールのターゲットを中心に設定
    modelControls.target.copy(center);
    modelControls.update();

    console.log('3D view auto-scaled:', {
        center: center.toArray(),
        size: size.toArray(),
        diagonal: diagonal.toFixed(2),
        distance: distance.toFixed(2),
        cameraPosition: modelCamera.position.toArray().map(v => v.toFixed(2))
    });
}

/**
 * モデル図3Dビューの表示/非表示を切り替え
 */
function toggleModel3DView(show) {
    const canvas2D = document.getElementById('model-canvas');
    const container3D = document.getElementById('model-3d-container');
    const projectionLabel = document.getElementById('projection-mode-label');
    const projectionSelect = document.getElementById('projection-mode');
    const hiddenAxisLabel = document.getElementById('hidden-axis-label');
    const hiddenAxisSelect = document.getElementById('hidden-axis-coord');

    if (show) {
        // 3D表示
        window.is3DMode = true;

        if (!modelScene) {
            const success = initModel3DView();
            if (!success) {
                console.error('Failed to initialize 3D view');
                return;
            }
        }

        canvas2D.style.display = 'none';
        container3D.style.display = 'block';

        // 2D専用コントロールを非表示
        if (projectionLabel) projectionLabel.style.display = 'none';
        if (projectionSelect) projectionSelect.style.display = 'none';
        if (hiddenAxisLabel) hiddenAxisLabel.style.display = 'none';
        if (hiddenAxisSelect) hiddenAxisSelect.style.display = 'none';

        // 現在のモデルデータを描画
        try {
            const { nodes, members } = parseInputs();
            updateModel3DView(nodes, members);
            
            // 3D表示に切り替えた後、自動スケーリングを実行
            setTimeout(() => {
                autoScaleModel3DView();
            }, 150);
        } catch (e) {
            console.error('Error updating 3D view:', e);
        }

        // リサイズ処理
        setTimeout(() => {
            onModel3DResize();
        }, 100);
    } else {
        // 2D表示
        window.is3DMode = false;

        canvas2D.style.display = 'block';
        container3D.style.display = 'none';

        // 2D専用コントロールを表示
        if (projectionLabel) projectionLabel.style.display = '';
        if (projectionSelect) projectionSelect.style.display = '';
        if (hiddenAxisLabel) hiddenAxisLabel.style.display = '';
        if (hiddenAxisSelect) hiddenAxisSelect.style.display = '';

        // 2D描画を更新
        if (typeof drawOnCanvas === 'function') {
            drawOnCanvas();
        }
    }
}

/**
 * マウス座標を正規化してRayca sterに設定
 */
function updateMousePosition(event) {
    const rect = modelRenderer.domElement.getBoundingClientRect();
    modelMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    modelMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

/**
 * 3Dビューのクリックイベント
 */
function onModel3DClick(event) {
    event.preventDefault();

    // canvasModeを取得（グローバル変数）
    if (typeof canvasMode === 'undefined') return;

    updateMousePosition(event);
    modelRaycaster.setFromCamera(modelMouse, modelCamera);

    if (canvasMode === 'select') {
        // 選択モード：節点または部材を選択
        const nodeIntersects = modelRaycaster.intersectObjects(modelNodeMeshes);
        const memberIntersects = modelRaycaster.intersectObjects(modelMemberMeshes);

        if (nodeIntersects.length > 0) {
            const nodeIndex = nodeIntersects[0].object.userData.index;
            modelSelectedNode = nodeIndex;
            modelSelectedMember = null;

            // 2D側の選択状態も更新
            if (typeof window.selectNode === 'function') {
                window.selectNode(nodeIndex);
            }

            // 再描画
            try {
                const { nodes, members } = parseInputs();
                updateModel3DView(nodes, members);
            } catch (e) {
                console.error('Error updating view:', e);
            }
        } else if (memberIntersects.length > 0) {
            const memberIndex = memberIntersects[0].object.userData.index;
            modelSelectedMember = memberIndex;
            modelSelectedNode = null;

            // 2D側の選択状態も更新
            if (typeof window.selectMember === 'function') {
                window.selectMember(memberIndex);
            }

            // 再描画
            try {
                const { nodes, members } = parseInputs();
                updateModel3DView(nodes, members);
            } catch (e) {
                console.error('Error updating view:', e);
            }
        } else {
            // 何もクリックしなかった場合は選択解除
            modelSelectedNode = null;
            modelSelectedMember = null;

            try {
                const { nodes, members } = parseInputs();
                updateModel3DView(nodes, members);
            } catch (e) {
                console.error('Error updating view:', e);
            }
        }
    } else if (canvasMode === 'addNode') {
        // 節点追加モード：グリッド平面上に節点を配置
        const intersects = modelRaycaster.intersectObject(modelGridHelper);

        if (intersects.length > 0) {
            const point = intersects[0].point;
            // グリッドに吸着
            const gridSpacing = parseFloat(document.getElementById('grid-spacing')?.value || 1.0);
            const x = Math.round(point.x / gridSpacing) * gridSpacing;
            const y = Math.round(point.z / gridSpacing) * gridSpacing; // Three.jsのZ → 入力のY
            const z = Math.round(point.y / gridSpacing) * gridSpacing; // Three.jsのY → 入力のZ

            // 節点追加関数を呼び出し
            if (typeof window.addNodeProgrammatically === 'function') {
                window.addNodeProgrammatically(x, y, z);
            }
        }
    } else if (canvasMode === 'addMember') {
        // 部材追加モード：2つの節点を選択
        const nodeIntersects = modelRaycaster.intersectObjects(modelNodeMeshes);

        if (nodeIntersects.length > 0) {
            const nodeIndex = nodeIntersects[0].object.userData.index;

            if (modelFirstMemberNode === null) {
                // 第一節点を選択
                modelFirstMemberNode = nodeIndex;

                // 2D側の変数も更新
                if (typeof window.setFirstMemberNode === 'function') {
                    window.setFirstMemberNode(nodeIndex);
                }

                // 再描画
                try {
                    const { nodes, members } = parseInputs();
                    updateModel3DView(nodes, members);
                } catch (e) {
                    console.error('Error updating view:', e);
                }
            } else {
                // 第二節点を選択して部材を追加
                if (typeof window.addMemberProgrammatically === 'function') {
                    window.addMemberProgrammatically(modelFirstMemberNode, nodeIndex);
                }
                modelFirstMemberNode = null;

                // 2D側の変数も更新
                if (typeof window.setFirstMemberNode === 'function') {
                    window.setFirstMemberNode(null);
                }
            }
        }
    }
}

/**
 * 3Dビューのコンテキストメニューイベント
 */
function onModel3DContextMenu(event) {
    event.preventDefault();

    updateMousePosition(event);
    modelRaycaster.setFromCamera(modelMouse, modelCamera);

    // 節点を右クリック
    const nodeIntersects = modelRaycaster.intersectObjects(modelNodeMeshes);
    if (nodeIntersects.length > 0) {
        const nodeIndex = nodeIntersects[0].object.userData.index;

        // 節点編集ポップアップを直接表示
        if (typeof window.openNodeEditor === 'function') {
            window.openNodeEditor(nodeIndex);
        }
        return;
    }

    // 部材を右クリック
    const memberIntersects = modelRaycaster.intersectObjects(modelMemberMeshes);
    if (memberIntersects.length > 0) {
        const memberIndex = memberIntersects[0].object.userData.index;

        // 部材プロパティポップアップを表示
        if (typeof window.showMemberProperties === 'function') {
            window.showMemberProperties(memberIndex);
        }
    }
}

/**
 * 3Dビューのマウス移動イベント
 */
function onModel3DMouseMove(event) {
    // 現在はホバー表示などは未実装
    // 将来的にはツールチップ表示などを追加可能
}

/**
 * 3Dビューのダブルクリックイベント
 */
function onModel3DDoubleClick(event) {
    event.preventDefault();

    updateMousePosition(event);
    modelRaycaster.setFromCamera(modelMouse, modelCamera);

    // 節点をダブルクリック
    const nodeIntersects = modelRaycaster.intersectObjects(modelNodeMeshes);
    if (nodeIntersects.length > 0) {
        const nodeIndex = nodeIntersects[0].object.userData.index;

        // 節点編集ポップアップを直接表示
        if (typeof window.openNodeEditor === 'function') {
            window.openNodeEditor(nodeIndex);
        }
        return;
    }

    // 部材をダブルクリック
    const memberIntersects = modelRaycaster.intersectObjects(modelMemberMeshes);
    if (memberIntersects.length > 0) {
        const memberIndex = memberIntersects[0].object.userData.index;

        // 部材プロパティポップアップを表示
        if (typeof window.showMemberProperties === 'function') {
            window.showMemberProperties(memberIndex);
        }
    }
}

/**
 * モデル図3Dビューのクリーンアップ
 */
function disposeModel3DView() {
    if (modelAnimationFrameId) {
        cancelAnimationFrame(modelAnimationFrameId);
        modelAnimationFrameId = null;
    }

    if (modelRenderer) {
        // イベントリスナー削除
        modelRenderer.domElement.removeEventListener('click', onModel3DClick);
        modelRenderer.domElement.removeEventListener('dblclick', onModel3DDoubleClick);
        modelRenderer.domElement.removeEventListener('contextmenu', onModel3DContextMenu);
        modelRenderer.domElement.removeEventListener('mousemove', onModel3DMouseMove);

        const container = document.getElementById('model-3d-container');
        if (container && modelRenderer.domElement.parentNode === container) {
            container.removeChild(modelRenderer.domElement);
        }
        modelRenderer.dispose();
        modelRenderer = null;
    }

    if (modelLabelRenderer) {
        // CSS2DRendererのDOM要素内のすべてのラベルを削除
        while (modelLabelRenderer.domElement.firstChild) {
            modelLabelRenderer.domElement.removeChild(modelLabelRenderer.domElement.firstChild);
        }
        const container = document.getElementById('model-3d-container');
        if (container && modelLabelRenderer.domElement.parentNode === container) {
            container.removeChild(modelLabelRenderer.domElement);
        }
        modelLabelRenderer = null;
    }

    if (modelScene) {
        while (modelScene.children.length > 0) {
            const obj = modelScene.children[0];
            // CSS2DObjectの場合、DOM要素も削除
            if (obj.isCSS2DObject && obj.element && obj.element.parentNode) {
                obj.element.parentNode.removeChild(obj.element);
            }
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
            modelScene.remove(obj);
        }
        modelScene = null;
    }

    modelCamera = null;
    modelControls = null;
    modelNodeMeshes = [];
    modelMemberMeshes = [];
    modelSelectedNode = null;
    modelSelectedMember = null;
    modelFirstMemberNode = null;

    window.removeEventListener('resize', onModel3DResize);
    
    // ResizeObserverのクリーンアップ
    if (modelContainerResizeObserver) {
        modelContainerResizeObserver.disconnect();
        modelContainerResizeObserver = null;
    }
    modelLastKnownSize = { width: 0, height: 0 };
}
