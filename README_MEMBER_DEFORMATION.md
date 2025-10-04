# 3Dフレーム解析プログラム - 部材途中変形表示機能

## 概要
2D参考プログラムと同様に、部材を細かく分割して途中の変形と応力を計算・表示する機能を実装しました。

## 主な実装内容

### 1. 新規追加関数（`new_displacement_diagram.js`）

#### `calculateMemberDeformation(member, nodes, D_global, memberForces, xi, dispScale)`
部材途中の変形を計算する関数
- **入力**:
  - `member`: 部材オブジェクト
  - `nodes`: 節点配列
  - `D_global`: 全体変位ベクトル
  - `memberForces`: 部材力配列
  - `xi`: 部材長さ方向の無次元座標 (0.0 ~ 1.0)
  - `dispScale`: 変位の拡大倍率
- **出力**: 変形後の3D座標 `{x, y, z}`
- **特徴**: エルミート補間を使用して曲げ変形を精密に計算

#### `calculateMemberMoment(memberForce, L, xi, axis)`
部材途中の曲げモーメントを計算する関数
- **入力**:
  - `memberForce`: 部材力オブジェクト
  - `L`: 部材長さ (m)
  - `xi`: 部材長さ方向の無次元座標 (0.0 ~ 1.0)
  - `axis`: モーメント軸 ('y' or 'z')
- **出力**: 位置xiでの曲げモーメント値 (kN・m)

#### `calculateMemberShear(memberForce, L, xi, axis)`
部材途中のせん断力を計算する関数
- **入力**:
  - `memberForce`: 部材力オブジェクト
  - `L`: 部材長さ (m)
  - `xi`: 部材長さ方向の無次元座標 (0.0 ~ 1.0)
  - `axis`: せん断力方向 ('y' or 'z')
- **出力**: 位置xiでのせん断力値 (kN)

### 2. 改良された描画関数

#### 変形図描画（`drawDisplacementDiagram`）
- **分割数**: 10分割 → **20分割**に増加
- **曲げ変形の考慮**: `calculateMemberDeformation`関数を使用
- **滑らかな曲線**: エルミート補間により、より正確な変形形状を表示

#### 応力図描画（`drawStressDiagram`）
- **分割数**: **20分割**で部材途中の応力を計算
- **最大応力位置の表示**: 部材端以外での最大値もマーカー表示
- **投影面対応**: XY, XZ, YZ各投影面に適切な応力成分を表示
  - XY平面: Mz（Z軸周りモーメント）、Qz
  - XZ平面: My（Y軸周りモーメント）、Qz
  - YZ平面: Mx（X軸周りモーメント）、Qy

### 3. パラメータ統一
- `frame_analyzer.js`から呼び出す際のパラメータを統一
- `memberLoads`（部材荷重）→ `forces`（部材力）に修正
- 変形図表示には部材力が必要なため

## 技術的特徴

### エルミート補間の採用
```javascript
// エルミート基底関数
const H1 = 1 - 3*x*x + 2*x*x*x;
const H2 = x - 2*x*x + x*x*x;
const H3 = 3*x*x - 2*x*x*x;
const H4 = -x*x + x*x*x;

// Y方向の曲げ（Z軸周り回転による）
const bend_y = H1 * 0 + H2 * L * d_i.rz + H3 * 0 + H4 * L * d_j.rz;

// Z方向の曲げ（Y軸周り回転による）
const bend_z = H1 * 0 + H2 * L * (-d_i.ry) + H3 * 0 + H4 * L * (-d_j.ry);
```

### 応力図の部材途中計算
```javascript
// 部材を20分割
const numDivisions = 20;
for (let k = 0; k <= numDivisions; k++) {
    const xi = k / numDivisions;
    
    // 曲げモーメント
    if (stressType === 'moment') {
        stressValue = calculateMemberMoment(forces, L, xi, axis);
    }
    // せん断力
    else if (stressType === 'shear') {
        stressValue = calculateMemberShear(forces, L, xi, axis);
    }
    // 軸力（一定）
    else if (stressType === 'axial') {
        stressValue = forces.N_i || 0;
    }
    
    stressPoints.push({x, y, value, offset});
}
```

## 使用方法

1. **構造モデルの作成**
   - 節点と部材を定義
   - 荷重条件、境界条件を設定

2. **解析の実行**
   - 「構造解析実行」ボタンをクリック

3. **結果の確認**
   - 変形図: 滑らかな曲線で変形形状を表示
   - 応力図: 部材途中の最大値も含めて表示
   - 各構面（XY, XZ, YZ）ごとに横スクロールで表示

4. **変位倍率の調整**
   - スライダーで変形の拡大率を調整可能
   - 部材の曲げ変形も倍率に応じて拡大

## 2D参考プログラムとの違い

| 項目 | 2Dプログラム | 3Dプログラム（本実装） |
|------|------------|---------------------|
| 自由度/節点 | 3 (dx, dy, rz) | 6 (dx, dy, dz, rx, ry, rz) |
| 投影面 | 1つ | 3つ (XY, XZ, YZ) |
| 曲げモーメント | 1成分 (M) | 3成分 (Mx, My, Mz) |
| せん断力 | 1成分 (Q) | 2成分 (Qy, Qz) |
| 部材分割数 | 10 | 20 |

## ファイル構成

```
3D構造解析/
├── frame_analyzer.js          # メイン解析プログラム（修正）
├── new_displacement_diagram.js # 変形・応力図描画（大幅更新）
├── IMPLEMENTATION_NOTES.md    # 実装詳細ノート
└── README_MEMBER_DEFORMATION.md # 本ファイル
```

## 今後の改善予定

- [ ] 等分布荷重を考慮した二次曲線的な応力分布
- [ ] より高精度な曲げ変形計算（梁理論に基づく）
- [ ] ねじりモーメントの可視化
- [ ] 断面力の合成表示
- [ ] 変形アニメーション機能

## 動作確認推奨項目

1. **単純梁**
   - 中央集中荷重: 中央で最大たわみ、両端で最大モーメント
   - 等分布荷重: 中央で最大たわみとモーメント

2. **片持ち梁**
   - 先端集中荷重: 先端で最大たわみ、固定端で最大モーメント

3. **ラーメン構造**
   - 複雑な変形形状の表現確認
   - 複数投影面での正しい表示

4. **3D構造**
   - 各投影面で適切な応力成分が表示されているか
   - 変形の連続性が保たれているか

## 更新履歴

- **2025年10月4日**: 初版リリース
  - 部材途中変形計算機能の実装
  - 応力図の部材途中値表示機能の実装
  - エルミート補間による精密な変形計算

---
**開発**: アルキテック株式会社
**バージョン**: 1.0.0
