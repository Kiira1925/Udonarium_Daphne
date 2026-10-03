# 汎用バフアイコン素材

バフ／デバフや自由記述の効果に割り当てるための個別PNG素材です。効果との対応は固定せず、用途は参考例として扱います。アイコンの選択・表示機能はまだ実装していません。

- 保存先: `src/assets/images/buff-icons/`
- 一覧: `http://127.0.0.1:4200/assets/images/buff-icons/preview.html`
- 解像度: 1254×1254px（全12種類共通）
- 形式: PNG（角丸の枠の外側は透過、枠の内側は暗い背景）
- 生成方法: 組み込み `image_gen`。画像ごとに個別生成。
- 生成プロンプト: [buff-icons-prompts.json](buff-icons-prompts.json)
- 素材一覧: [index.json](../src/assets/images/buff-icons/index.json)

| ファイル | 表示名 | 用途例 |
| --- | --- | --- |
| attack.png | 攻撃 | 攻撃強化・与ダメージ増加 |
| defense.png | 防御 | 防御強化・被ダメージ軽減 |
| magic.png | 魔力 | 魔力強化・魔法効果 |
| speed.png | 速度 | 加速・移動力・回避 |
| healing.png | 回復 | 回復・再生・生命力 |
| barrier.png | 障壁 | 障壁・一時的な保護 |
| accuracy.png | 命中 | 命中強化・集中 |
| luck.png | 幸運 | 幸運・祝福・有利 |
| poison.png | 毒 | 毒・継続ダメージ |
| burn.png | 炎上 | 炎上・火属性効果 |
| sleep.png | 睡眠 | 睡眠・休息 |
| paralysis.png | 麻痺 | 麻痺・感電・行動阻害 |

## デザイン方針

暗い角丸の枠と銀色の縁を共通にし、中央のシンボルの色・形で区別します。文字を含めず、32px・48pxでの確認例を一覧ページに用意しています。名称や効果に縛られず、別の用途にも割り当てられます。

生成された原寸PNGを保持しています。表示機能へ組み込む際は、原寸素材を保持したまま小サイズの配信用画像を用意すると読み込み量を抑えられます。
