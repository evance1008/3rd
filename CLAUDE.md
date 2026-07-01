# 3D地球儀・世界の国図鑑アプリ

3D地球儀を回して国をタップすると、その国の概要が日本語で表示されるWebアプリ。
GitHub Pagesで公開し、スマホ(iPhone Safari)での利用がメイン。

## 対象と表示要素

- 対象: 国連加盟国193カ国のみ(REST Countries v3.1 の `unMember=true` でフィルタ)
- 表示は日本語(国名は `translations.jpn.common` を使用)
- 表示要素:
  - 首都 / 人口 / 面積 / 公用語 / 国旗 / 通貨
  - 国歌(再生)
  - 代表的な料理1品
  - 有名な観光地(画像1枚)
  - 挨拶の言葉(音声再生)
  - 簡単な歴史(3〜4文)

## 技術構成(この構成で固定)

- フロント: HTML / CSS / JS + [globe.gl](https://globe.gl/)(CDN読み込み、ビルド不要)
- 国境データ: Natural Earth由来のGeoJSON(110m)。国コード `cca3`(ISO 3166-1 alpha-3)で紐付け
- データ戦略:
  - **静的**: `scripts/build-data.js`(Node)で `data/countries.json` を事前生成
    (REST Countries基本情報 + 料理 + 挨拶 + 国歌音源URL + 観光地画像URL)
  - **動的**: 歴史要約のみ `ja.wikipedia.org` の REST API summary
    (`/api/rest_v1/page/summary/{title}`)を実行時取得し、localStorage にキャッシュ
- 画像/音源: Wikimedia Commons(APIキー不要のものだけ使う。**Unsplashは使わない**)
- 挨拶音声: Web Speech API(`speechSynthesis`)。対応言語がない場合はテキストのみ表示
- 料理・挨拶データ: LLMの知識で193カ国分を生成してよい。
  ただし出典が不確かな国は「代表的な料理の一例」と注記する

## 制約

- **APIキーが必要なサービスは使わない**(GitHub Pages公開のため)
- 国歌・画像が取得できない国は項目を非表示にする。
  フォールバックを必ず実装(エラーで落とさない)
- スマホ縦画面ファースト。情報パネルは下からのボトムシート形式
- Wikipedia / Wikimedia / Natural Earth の出典・ライセンス表記をフッターに入れる
- ビルド工程なし(`index.html` を直接開ける構成。データ生成のみNodeスクリプト)

## ディレクトリ構成

```
/
├── index.html        # アプリ本体(エントリポイント)
├── assets/           # CSS・アイコンなど静的ファイル
│   └── style.css
├── data/             # 事前生成データ(countries.json、GeoJSONなど)
├── scripts/          # データ生成用Nodeスクリプト(build-data.js)
└── CLAUDE.md         # このファイル
```

## フェーズ計画

ユーザーが「フェーズNを進めて」と指示してから着手する。**先回りして実装しないこと。**

- **フェーズ0(完了)**: リポジトリ構成 + CLAUDE.md + globe.glで空の地球儀が表示・回転できる最小のindex.html
- **フェーズ1**: 国境GeoJSON(Natural Earth 110m)を地球儀に描画。国のタップ検出とハイライト
- **フェーズ2**: `scripts/build-data.js` で REST Countries から基本情報を取得し `data/countries.json` を生成。タップで国名(日本語)を表示
- **フェーズ3**: ボトムシートUIを実装し、基本情報(首都/人口/面積/公用語/国旗/通貨)を表示
- **フェーズ4**: 料理・挨拶データ(193カ国分)の生成と表示。Web Speech APIで挨拶の音声再生
- **フェーズ5**: 国歌音源・観光地画像をWikimedia CommonsのURLで追加(取得不可の国は非表示)
- **フェーズ6**: Wikipedia REST APIで歴史要約を実行時取得 + localStorageキャッシュ
- **フェーズ7**: 仕上げ(出典・ライセンス表記、パフォーマンス調整、GitHub Pages公開手順)

## 動作確認(ローカル)

ビルド不要。リポジトリ直下で簡易サーバーを起動してブラウザで開く:

```bash
# Python の場合
python3 -m http.server 8000
# または Node の場合
npx serve .
```

→ http://localhost:8000 を開く。
スマホ確認は Safari の開発者ツール、または同一Wi-Fi内から `http://<PCのIP>:8000` にアクセス。

## コーディング方針

- 初学者が読めるコードを心がける(過度な抽象化をしない、日本語コメントを適宜入れる)
- フレームワーク・バンドラーは導入しない
- エラー時は console.error + UI上のフォールバック表示(白画面にしない)
