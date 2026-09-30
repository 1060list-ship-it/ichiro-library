# ichiro-library 公開サイト redesign — グラフィック強化・差分仕様

> 作成日: 2026-10-01  
> 対象: `apps/web/src` の公開トップ（第1ラウンド実装への差分のみ）  
> 実装担当: paz  
> 前提: [redesign-brief-20260930.md](./redesign-brief-20260930.md) の gateway 哲学、既存導線、トークン、110字要約カード、CTA構成を維持する。

## 0. この差分で変える体験

第1ラウンドは「探しやすい」。それでいい。ただ、最初の一画面が静かすぎて、今夜の配信を探す高揚が立ち上がらない。ここは黒い夜のなかにオレンジとティールの光が漂い、検索欄が入口として浮かぶ画面に変える。

ユーザーに見せる順番は **光景 → FIND TONIGHT'S ICHIRO. → 検索 → 実績**。検索条件や配信一覧を変える話ではない。主CTAは今までどおりカード上の `YouTubeで開く ↗`（`--signal`）で、サイト内視聴を主役にしない。

## 1. ファイル別差分

| ファイル | 第1ラウンドからの変更だけ |
|---|---|
| `apps/web/src/app/globals.css` | 既存トークンは残したまま、黒寄りの `--canvas` と、ヒーロー専用の `--hero-*` 色を追加する。`.hero-aurora` に多層 `radial-gradient` を定義し、カード用に低コストの半透明面・境界ハイライト用ユーティリティを追加する。ページ全体の背景グラデーションは弱め、オーロラはトップヒーローだけに閉じ込める。 |
| `apps/web/src/app/HomePageClient.tsx` | 既存の最上部ヒーローを `hero-aurora` 化する。`LIVE ARCHIVE` は小さなeyebrowに残し、`h1` を英語メインへ差し替える。検索ブロックを見出し直下の発光フレームへ入れ、固定値の実績3件をヒーロー下端に配置する。検索state、URL同期、データ取得、カテゴリ・年・詳細フィルタと一覧以降の順序は変えない。`resultCount` と最終更新は、ヒーローの実績枠に混ぜず、従来どおり結果見出し/補助情報として扱う。 |
| `apps/web/src/components/SearchBar.tsx` | 機能・props・400ms debounce・サンプルクエリはそのまま。入力をヒーローの発光フレームの中で最も明るい面にし、フォーカス時だけティールのリングを強める。サンプルチップとあいまい検索トグルはガラス面の下段に置く。 |
| `apps/web/src/components/StreamCard.tsx` | 110文字制限、情報順、YouTube主CTA、詳細への二次CTA、タグフィルタ、会員操作は変更しない。`article` とサムネイル上のYouTube補助CTAだけを半透明面・内側の境界ハイライトを持つガラス質感に寄せる。CTAの `--signal` 塗りは維持し、カード全文や詳細CTAをオレンジにしない。 |

`layout.tsx`、検索ロジック、URLパラメータ、データ取得、公開ルート構造には差分を入れない。ヘッダー、詳細、マガジンは第1ラウンドのままとする。今回の「前と大差ない」を解く場所はトップの最初の画面とカードの質感だ。範囲を広げるな。

## 2. ヒーローの構成・配置

```text
┌──────────────────── hero-aurora / 黒地のオーロラ ────────────────────┐
│ LIVE ARCHIVE                                                           │
│ FIND TONIGHT'S                                                         │
│ ICHIRO.                          （右上に淡いティールの光）            │
│ 一郎の配信から、今夜観たい一回を探す。                                  │
│                                                                         │
│ ┌─ 発光フレーム ───────────────────────────────────────────────────┐ │
│ │  ⌕  人物名・話題・日付で探す                                      │ │
│ │  [2024年3月] [ハマダ] [ハマダ -ゲーム]       [あいまい検索 ○]     │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ 321 ARCHIVES             58M VIEWS                 671 HOURS          │
└─────────────────────────────────────────────────────────────────────────┘
```

- ヒーローは `max-w-6xl` のコンテンツ幅を保ち、外側はfull-bleedの黒背景にする。上下paddingは `56px` / `96px`（`sm`以上）。モバイルは `40px` / `56px`。横paddingは既存どおり `16px` / `24px`。
- 見出しと検索フレームは `max-width: 760px`。実績はヒーローの最下部に置き、検索から `32px`（`sm`以上は`40px`）空ける。画面右に置いていた動的アーカイブ件数は消す。固定実績と同じ場所に二重で数字を置くと、何が重要か分からなくなる。
- 実績はモバイルで3列を維持する。各セルの境界は `border-left: 1px solid rgba(232,238,245,.18)`、先頭だけ境界なし。数値ではなく指定どおりの文字列をそのまま表示する: `321 ARCHIVES` / `58,044,318 VIEWS` / `671 HOURS`。APIから再計算しない。
- 実績の数値は `font-mono`、`font-weight: 600`、`font-size: 16px`（`sm`以上20px）、`letter-spacing: .02em`。単語は`10px`（`sm`以上11px）、`letter-spacing: .12em`、`--muted`。一塊の数字として読ませ、装飾アイコンは付けない。

## 3. オーロラ背景 — CSS指定

### トークン

既存の `--surface`、`--line`、`--ink`、`--muted`、`--aqua`、`--signal` は第1ラウンドの値を維持する。以下だけ追加または変更する。

```css
:root {
  --canvas: #05070A;
  --hero-orange: 255, 105, 73;  /* #FF6949 */
  --hero-teal: 67, 224, 204;    /* #43E0CC */
  --hero-violet: 112, 93, 214;  /* #705DD6: 黒への沈み込みを作る補助色 */
  --glass: rgba(16, 30, 45, 0.62);
  --glass-strong: rgba(8, 17, 29, 0.78);
  --glass-line: rgba(232, 238, 245, 0.18);
}
```

### 多層背景

`background-image` の先頭が最前面。以下の順で `.hero-aurora` に指定する。画像アセット、SVG、canvas、疑似的なノイズ画像は作らない。

```css
.hero-aurora {
  isolation: isolate;
  overflow: clip;
  background-color: var(--canvas);
  background-image:
    /* 1. 前景: 左下から検索へ寄るオレンジの光。最も明るい層 */
    radial-gradient(ellipse 54% 46% at 12% 104%, rgba(var(--hero-orange), 0.38) 0%, rgba(var(--hero-orange), 0.19) 31%, rgba(var(--hero-orange), 0) 71%),
    /* 2. 前景: 右上のティール。見出しの右側を空けて光だけを置く */
    radial-gradient(ellipse 50% 57% at 94% 4%, rgba(var(--hero-teal), 0.31) 0%, rgba(var(--hero-teal), 0.13) 38%, rgba(var(--hero-teal), 0) 73%),
    /* 3. 中景: 左上の小さなオレンジ。文字を読める濃度で止める */
    radial-gradient(ellipse 43% 42% at 2% -12%, rgba(var(--hero-orange), 0.23) 0%, rgba(var(--hero-orange), 0.09) 39%, rgba(var(--hero-orange), 0) 72%),
    /* 4. 中景: 右下のティール。実績の背後をわずかに持ち上げる */
    radial-gradient(ellipse 48% 42% at 78% 96%, rgba(var(--hero-teal), 0.20) 0%, rgba(var(--hero-teal), 0.07) 43%, rgba(var(--hero-teal), 0) 76%),
    /* 5. 後景: 青紫を黒へ溶かす。色が二色だけで分離して見えるのを防ぐ */
    radial-gradient(ellipse 68% 78% at 52% 48%, rgba(var(--hero-violet), 0.12) 0%, rgba(var(--hero-violet), 0.035) 46%, rgba(var(--hero-violet), 0) 78%),
    /* 6. 最後: 上は少しだけ明るく、下は黒へ落とす読みやすさの土台 */
    linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(5,7,10,0.08) 47%, rgba(5,7,10,0.54) 100%);
}
```

- 上の背景の下には必ず `background-color: #05070A` を置く。グラデーションが効かない環境でも真っ黒に近い夜として成立させる。
- グラデーションはヒーローだけ。`body` の現行の左上ラジアルは削除して `var(--canvas)` の単色にする。全画面に光を敷くと検索後も気が散る。
- 初回は**静止画として実装する**。これでグラフィックの要求は満たせる。実装者が低コストの漂いを足す必要がある場合だけ、`.hero-aurora::before` を1枚追加して `transform: translate3d()` と `opacity` のみを18秒で往復させる。`background-position`、filter、blurのアニメーションは禁止する。

```css
@media (prefers-reduced-motion: reduce) {
  .hero-aurora::before { animation: none; }
}
```

すでにある全体の reduced-motion 規則は維持する。この一文を足して、個別のオーロラ演出が例外にならないようにする。

## 4. ヒーローのタイポグラフィ

| 要素 | 360px〜 | 640px〜 | 1024px〜 | 指定 |
|---|---:|---:|---:|---|
| eyebrow `LIVE ARCHIVE` | 11px | 11px | 12px | `font-weight: 600; letter-spacing: .18em; color: var(--aqua)` |
| 英語 `h1` | clamp(44px, 13vw, 64px) | clamp(64px, 9vw, 96px) | 104px | `font-weight: 700; line-height: .88; letter-spacing: -.065em; text-transform: uppercase` |
| 日本語副文 | 15px / 1.75 | 16px / 1.75 | 18px / 1.7 | `font-weight: 500; letter-spacing: .01em; color: var(--ink)` |
| 検索入力 | 16px | 16px | 16px | 見た目より入力性を優先。iOS拡大を起こす15px以下にしない。 |

- `h1` の文言は厳密に `FIND TONIGHT'S ICHIRO.`。デスクトップでは改行位置を固定し、`FIND TONIGHT'S` と `ICHIRO.` を別のblock `span` にする。`h1` に `title="一郎の配信から、今夜観たい一回を探す。"` を付け、ホバーで意味が分かるようにする。モバイルも同じ2行を基本にするが、幅320px未満でだけ `letter-spacing: -.075em` まで詰めて横切れを防ぐ。3行にはしない。
- `FIND TONIGHT'S` は白寄りの `--ink`、`ICHIRO.` はオレンジからティールへ横に移る `linear-gradient(90deg, #FF8B5E 0%, #FFD18A 42%, #64E4D3 100%)` を `background-clip: text` で適用する。グラデーションが非対応の場合の文字色は `#FF9A70`。影・縁取り・発光する文字にはしない。読めなくなる。
- 日本語副文はこの一文だけ残す: **「山口一郎の配信から、今夜観たい一回を探す。」**（フルネーム表記）。第1ラウンドの補足文「人物・話題・日付から、あの配信へ戻れる。」は、検索の使い方の中にすでに機能としてあるためヒーローから外す。
- 英語はディスプレイ、日本語は説明。両方を同じ太さ・サイズにすると、どこを見ればいいか消える。

## 5. 検索フレームとカードの質感

### 検索フレーム

- 検索ブロックを `border-radius: 20px`、縁取り2px相当（`padding: 2px`）のシャープな外枠に入れる。外枠は `background: linear-gradient(135deg, rgba(255,105,73,.38), rgba(67,224,204,.30))`。もっさりした太縁にしない。
- 外枠の内側は `background: var(--glass-strong)`、`border: 1px solid rgba(255,255,255,.14)`。`box-shadow: 0 0 0 1px rgba(255,255,255,.05) inset, 0 18px 50px rgba(0,0,0,.30)`。これはヒーローに一つだけ許す大きな影だ。
- `input` は `min-height: 56px`（現在48pxから増量）、`background: rgba(232,238,245,.07)`、`border: 1px solid rgba(232,238,245,.16)`、角丸16px。focus時のみ `border-color: var(--aqua)` と `box-shadow: 0 0 0 3px rgba(126,227,208,.22), 0 0 28px rgba(67,224,204,.16)` を使う。
- サンプルチップ、あいまい検索は入力の下。モバイルでは左揃えの縦フローでよい。トグルを右端に押し出して切らせない。外枠全体への `backdrop-filter` は使わない。

### StreamCard

- `article` のベースは `background: linear-gradient(145deg, rgba(255,255,255,.075), rgba(255,255,255,.025)), rgba(16,30,45,.72)`。境界は `1px solid rgba(232,238,245,.15)`、内側に `box-shadow: inset 0 1px 0 rgba(255,255,255,.11)` を一本だけ入れる。
- hover/focus-within は第1ラウンドのティール境界を維持しつつ、`transform: translateY(-2px)` と `box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 16px 34px rgba(0,0,0,.22)`。`transition: border-color 180ms, transform 180ms, box-shadow 180ms`。reduced-motionでは transform/transitionを無効化する。
- サムネイル上の小CTAは `background: rgba(5,7,10,.62)` と `border: 1px solid rgba(255,255,255,.20)` に替える。ここだけ `backdrop-filter: blur(6px)` を許可する。カード全体、ヘッダー、フィルタパネルには blur を増やさない。
- カードの本文、タグ、二次CTAは第1ラウンドの色の役割を守る。光らせるのは境界と検索だけで、情報の全行をネオン化しない。

## 5.5 フッターのまとまり

- フッター上端に `.footer-glow`（オーロラ3色の1pxグラデーション境界線）を入れ、ヘッダー〜ヒーローの光と呼応させる。本文・リンク色は `--muted` のまま変えない。

## 6. 実装しないこと

- 新規の画像、動画、SVG、ロゴ、イラスト、canvas、WebGL、Lottie、生成アセットの作成・読み込み
- DB、Supabase、API、検索処理、検索URLクエリ、データ型、集計ロジックの変更。実績3件をAPI取得や動的集計に置換することも含む
- `/admin`、ログイン、member、プレイリスト編集、エンティティ管理、配信詳細、マガジン、共通ヘッダーの redesign
- 110字要約の定数、カードの情報順、YouTube主CTA（`--signal`）、詳細への二次CTA、外部リンク属性、gateway哲学の変更
- autoplay、サイト内キュー、連続再生、再生履歴、動画ダウンロードなど、サイト内で視聴を完結させる機能
- `backdrop-filter` の全体適用、複数カードへの常時blur、filter/blur/background-positionを使うアニメーション。低性能端末の操作性をグラフィックのために落とさない
- 新規npm依存、フォントファイル、アイコンライブラリの追加

## 7. paz / togusa 確認項目（差分）

- [ ] 360px、768px、1280pxで、`FIND TONIGHT'S / ICHIRO.` が指定どおり2行で切れず、日本語副文・検索・実績3件の順に読める。
- [ ] 実績は正確に `321 ARCHIVES`、`58,044,318 VIEWS`、`671 HOURS` と表示され、検索結果件数と混同しない。
- [ ] ヒーロー背景が画像リクエストなしのCSS多層radial-gradientだけで描画され、本文と検索入力のコントラストが確保されている。
- [ ] 検索、あいまい検索、サンプルクエリ、カテゴリ、年、タグ/コーナー、ブラウザ戻る/進むは第1ラウンドと同じURL契約・挙動で動く。
- [ ] カードの要約は110字、YouTube CTAは `--signal`、詳細CTAは二次操作のまま。ガラス表現によってCTAの優先順位が反転していない。
- [ ] `prefers-reduced-motion: reduce` で追加オーロラ演出とカード移動が停止し、blurはサムネイルの小CTA一箇所だけである。
