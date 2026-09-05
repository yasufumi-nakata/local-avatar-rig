# Default Navigator v1 設計記録

最終更新: 2026-09-05（Asia/Tokyo）

Default NavigatorはLocal Avatar Rigの既定アバターです。銀青の髪、琥珀色の瞳、
深紺・ティール・金の研究服、四芒星の髪飾りを使ったAI生成のデザインです。
Neutral / Blink / Mouth-openの3枚を独自のWebGLメッシュで変形します。
専用SDKのモデル形式や階層化された制作データは含みません。

## 確定画像

| 状態 | ファイル | SHA-256 |
| --- | --- | --- |
| Neutral | `public/assets/vtuber-rig-default-neutral-v1.png` | `48629bb48a253325e599b9356fa13782c0f1b5a4f148c107756e42360e86c74f` |
| Blink | `public/assets/vtuber-rig-default-blink-v1.png` | `9ebb6b2488a1ee537dbe9bf58be125496d44d251b773799da2bb8b714a2c117b` |
| Mouth-open | `public/assets/vtuber-rig-default-mouth-open-v1.png` | `56cd42e688fb6b4f82855875b0738ab745c176f5ae24a9628b3e9d543cd42de6` |

3枚とも1672×941、8-bit RGBA PNGです。Manifestに記録したNeutralの可視アルファ境界は
`x=363..1313, y=13..940`、アルファ値250未満の画素率は約66.31%です。
下端は上半身表示のためのクロップです。

## 生成と位置合わせ

生成記録では、外部キャラクターや実在人物の参照画像を使わずにNeutralを作り、
採用Neutralを基準として閉眼と開口の状態を生成しています。
`scripts/compose-expression-states.mjs`は目または口の局所領域にだけ差分のRGBを
なじませて合成し、すべてのアルファ値をNeutralからコピーします。

確定ファイルの値と生成経路の記録は
[`default-navigator-v1.manifest.json`](../../public/assets/default-navigator-v1.manifest.json)にあります。
掲載ブリーフは公開用に再構成した内容で、過去に入力した文章の逐語記録ではありません。
生成画像の完全な再現手順を保証するものではなく、確定画像はハッシュで識別します。

NeutralにはC2PAメタデータがあり、AI生成を示す内容が含まれています。署名はローカルで
検証していません。Canvas合成した派生状態では元のC2PAが保持されないことがあるため、
生成元と確定画像のSHA-256を別々に記録しています。C2PAの存在やハッシュは
著作権や第三者の権利についての許諾を証明しません。

## 描画の基準

- 左目の中心: `uv(0.4455, 0.3745)`
- 右目の中心: `uv(0.5615, 0.3745)`
- 口の中心: `uv(0.4995, 0.4890)`

目と口以外の輪郭が状態の切替で変化しないこと、両目が完全に閉じること、開口時に
口が二重にならないことを確認します。左右Yawと発話状態は[固定状態の比較](../motion-comparison.md)、
テストの実行結果は[検証記録](../validation.md)で管理します。

組込みの背景画像はありません。シーン背景はグラデーションで描きます。
利用者の背景PNGを取り込んだ場合は、その画像と組み合わせて表示できます。

## 利用条件

組込みアートと画面画像はコードのMITライセンスに含めません。
公開フォークとリポジトリのデモ等の許可範囲は[ASSET_LICENSE.md](../../ASSET_LICENSE.md)、
第三者資料の帰属表示は[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)をご確認ください。
