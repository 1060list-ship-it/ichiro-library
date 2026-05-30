"""
entities テーブル初期データ投入スクリプト
データ源: docs/ichiro-reference.md の6表（行144〜224）

使い方:
  cd /Users/ikkiair/Projects/AI_work/03_personal_projects/ichiro-library
  packages/pipeline/.venv/bin/python packages/pipeline/seed_entities.py [--dry-run]

オプション:
  --dry-run   DBへの書き込みを行わず、投入内容をログに出力するだけ
"""

import argparse
import logging
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent.parent.parent / ".env.local")

from supabase import create_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("seed_entities")

# ============================================================
# エンティティデータ（reference.md の6表から手動整理）
# match_names: 自動リンク照合用の表記ゆれ全部（3文字以上のみ有効）
# 長い表記から順にソートするのは extract_entities.py 側で行う
# ============================================================

ENTITIES: list[dict] = [

    # ─────────────────────────────────────────
    # カテゴリ: family（家族・親族・地元コミュニティ）
    # ─────────────────────────────────────────
    {
        "slug": "yamaguchi-tamotsu",
        "name": "山口 保（たもつ）",
        "match_names": ["山口保", "山口 保"],
        "category": "family",
        "role": "実父・木彫職人・元小樽市議会議員",
        "description": "岐阜出身、京都での大学期に学生運動を経験後、欧州放浪を経て小樽へ移住。「小樽運河を守る会」幹事として運河埋め立て阻止運動に参画し、2015年まで小樽市議会議員を務めた社会活動家・木彫職人。一郎の「表現と社会との関わり」に関する思想に決定的な影響を与えた。",
        "related_work": None,
        "external_url": None,
        "sort_order": 10,
    },
    {
        "slug": "yamaguchi-jo",
        "name": "山口 穣（じょう）",
        "match_names": ["山口穣", "山口 穣"],
        "category": "family",
        "role": "いとこ・プライベートの釣り仲間",
        "description": "クライミングジムで遭遇。山口一郎と共に定職を置かない放浪時期を共有し、現在も釣り仲間である。",
        "related_work": None,
        "external_url": None,
        "sort_order": 11,
    },
    {
        "slug": "shikama-yoko",
        "name": "色摩 洋子",
        "match_names": ["色摩洋子", "色摩 洋子", "寿司和食しかま"],
        "category": "family",
        "role": "中学同級生・老舗「寿司和食しかま」代表",
        "description": "老舗「寿司和食しかま」の代表取締役。山口が一方的に好意を寄せていたとラジオで語る、地域コミュニティを背景にした人間関係の象徴。",
        "related_work": None,
        "external_url": None,
        "sort_order": 12,
    },
    {
        "slug": "merry-go-round",
        "name": "メリーゴーランド",
        "match_names": ["メリーゴーランド"],
        "category": "family",
        "role": "山口一郎の実家・セレクトショップ・木彫工房",
        "description": "北海道小樽市富岡。山口一郎の実家であり初期楽曲「ライトダンス」等を生む原風景となった高台の洋風建築。母親が振る舞うアイスハーブティーはコミュニティの象徴。",
        "related_work": None,
        "external_url": None,
        "sort_order": 13,
    },

    # ─────────────────────────────────────────
    # カテゴリ: celebrity（芸能・音楽界の交友・影響元）
    # ─────────────────────────────────────────
    {
        "slug": "hanaregumi",
        "name": "ハナレグミ（永積 崇）",
        "match_names": ["ハナレグミ", "永積崇", "永積 崇"],
        "category": "celebrity",
        "role": "シンガーソングライター",
        "description": "山口一郎が「歌の師匠」として深く敬愛するボーカリスト。Coldplayのクリス・マーティンと並んで「自分の音楽表現の絶対的な師匠」と呼ぶ。ダッチマン期、小樽〜札幌往復の車中でハナレグミを喉が枯れるまで歌い込んで表現力を磨いた。ピッチをあえてわずかにフラットさせる引き算の美学が山口のボーカルスタイルの基礎となっている。",
        "related_work": "「家族の風景」「Jamaica Song」「サヨナラCOLOR」",
        "external_url": None,
        "sort_order": 20,
    },
    {
        "slug": "cornelius",
        "name": "コーネリアス（小山田 圭吾）",
        "match_names": ["コーネリアス", "Cornelius", "小山田圭吾", "小山田 圭吾"],
        "category": "celebrity",
        "role": "音楽プロデューサー・アーティスト",
        "description": "山口一郎が「日本の最重要クリエイター」としてリスペクトを捧げ続ける存在。「ミュージック」「フレンドリー」のリミックスを担当。『懐かしい月は新しい月 Vol. 2』にも参加。2024年BSフジ特番『CORNELIUS 30th Anniversary Special』で岡村靖幸・青葉市子らと共にメインゲスト対談。",
        "related_work": "「ミュージック」「フレンドリー」Cornelius Remix",
        "external_url": None,
        "sort_order": 21,
    },
    {
        "slug": "rei-harakami",
        "name": "レイ・ハラカミ",
        "match_names": ["レイ・ハラカミ", "レイハラカミ", "Rei Harakami"],
        "category": "celebrity",
        "role": "エレクトロニカ・アーティスト",
        "description": "山口が「音源を常に持ち歩き敬愛する」と語る音楽的ルーツ。名曲「Owari no Kisetsu」を常に愛聴。サカナクション2ndシングル『アルクアラウンド』B面に「ネイティブダンサー (rei harakami へっぽこre-arrange)」を提供。浮遊感漂う緻密な音響構築は現在のサカナクションの「ダンスミュージックとフォークの融合」の血肉となっている。",
        "related_work": "「ネイティブダンサー (rei harakami へっぽこre-arrange)」",
        "external_url": None,
        "sort_order": 22,
    },
    {
        "slug": "kato-koji",
        "name": "加藤 浩次（極楽とんぼ）",
        "match_names": ["加藤浩次", "加藤 浩次", "極楽とんぼ"],
        "category": "celebrity",
        "role": "タレント・STVラジオ共演者",
        "description": "同郷小樽出身。2019年『スッキリ』共演を機に意気投合。故郷小樽を語り合う深夜ドライブやSTVラジオ『加藤さんと山口くん』のレギュラー放送へと発展。",
        "related_work": "STVラジオ『加藤さんと山口くん』",
        "external_url": None,
        "sort_order": 23,
    },
    {
        "slug": "hoshino-gen",
        "name": "星野 源（SAKEROCK）",
        "match_names": ["星野源", "星野 源", "SAKEROCK"],
        "category": "celebrity",
        "role": "シンガーソングライター・俳優",
        "description": "2011年東日本大震災後より共同生放送Ustream番組『サケノサカナ』『夜のテレビジョン』を企画。多くのクリエイターを交えた知的雑談の場を創出。",
        "related_work": "Ustream『サケノサカナ』『夜のテレビジョン』",
        "external_url": None,
        "sort_order": 24,
    },
    {
        "slug": "fujiwara-hiroshi",
        "name": "藤原 ヒロシ",
        "match_names": ["藤原ヒロシ", "藤原 ヒロシ", "NFRGMT"],
        "category": "celebrity",
        "role": "音楽プロデューサー・デザイナー",
        "description": "プロジェクト「NFRGMT」で協働。プライベートでも「孤独な時間の質」を互いに尊重・共有する仲。山口が絶望的な休養期にあった際、最もシンプルなビートにリアレンジし「歌の本質」を際立たせる優しいリミックスを提供した。",
        "related_work": "「新宝島 (hf remix)」「フクロウ (hf remix)」",
        "external_url": None,
        "sort_order": 25,
    },
    {
        "slug": "kato-konatsu",
        "name": "加藤 小夏",
        "match_names": ["加藤小夏", "加藤 小夏"],
        "category": "celebrity",
        "role": "女優・タレント",
        "description": "山口の熱烈な「推し」。ゲーム実況配信でのスーパーチャットから親交が開始。2026年ロッテ『THE DAY』ビデオポッドキャスト番組で共演。「夜の踊り子」ミームのダンボール船動画を共同再現。",
        "related_work": "ロッテ『THE DAY ROOM』共演",
        "external_url": None,
        "sort_order": 26,
    },
    {
        "slug": "chika-hana",
        "name": "CHIKA（ちかちゃん / HANA）",
        "match_names": ["CHIKA", "ちかちゃん", "HANA"],
        "category": "celebrity",
        "role": "アーティスト（ガールズグループ HANA）",
        "description": "ちゃんみなプロデュースの「No No Girls」から誕生したHANAのメインボーカル。J-POPで唯一サカナクションの大ファンを公言。オーディションの苦しい局面でサカナクション「アイデンティティ」に救われたと語り、雑誌『SWITCH』で山口と対談。サマーソニックでも共演。",
        "related_work": "雑誌『SWITCH』対談・サマーソニック共演",
        "external_url": None,
        "sort_order": 27,
    },
    {
        "slug": "kawatani-enon",
        "name": "川谷 絵音",
        "match_names": ["川谷絵音", "川谷 絵音"],
        "category": "celebrity",
        "role": "ミュージシャン",
        "description": "サカナクションの熱狂的ファン。フェス最前列での体験がindigo la End等の結成のトリガーとなったと語る。",
        "related_work": None,
        "external_url": None,
        "sort_order": 28,
    },
    {
        "slug": "hirate-yurina",
        "name": "平手 友梨奈",
        "match_names": ["平手友梨奈", "平手 友梨奈"],
        "category": "celebrity",
        "role": "アーティスト・女優",
        "description": "NHK Eテレ『シュガー＆シュガー』初回レギュラーゲスト。山口との高い共鳴を示すトークを展開。",
        "related_work": "NHK Eテレ『シュガー＆シュガー』",
        "external_url": None,
        "sort_order": 29,
    },
    {
        "slug": "perfume",
        "name": "Perfume",
        "match_names": ["Perfume", "パフューム"],
        "category": "celebrity",
        "role": "テクノポップユニット",
        "description": "『シュガー＆シュガー』第2シリーズ初回ゲスト。ダンスや音楽をめぐる長年の葛藤を語り合った。",
        "related_work": "NHK Eテレ『シュガー＆シュガー』第2シリーズ",
        "external_url": None,
        "sort_order": 30,
    },
    {
        "slug": "kimura-takuya",
        "name": "木村 拓哉",
        "match_names": ["木村拓哉", "木村 拓哉", "キムタク"],
        "category": "celebrity",
        "role": "俳優・歌手",
        "description": "SMAPへの楽曲提供（「Magic Time」「Moment」）を通じて山口のメロディラインを広く国民に浸透させた。",
        "related_work": "SMAP「Magic Time」「Moment」楽曲提供",
        "external_url": None,
        "sort_order": 31,
    },

    # ─────────────────────────────────────────
    # カテゴリ: remixer（DJ・リミキサー陣）
    # ─────────────────────────────────────────
    {
        "slug": "agraph",
        "name": "agraph（牛尾 憲輔）",
        "match_names": ["agraph", "牛尾憲輔", "牛尾 憲輔"],
        "category": "remixer",
        "role": "サウンドアーティスト・映画音楽家",
        "description": "「NF」初期メンバーであり山口と強い信頼で結ばれている。映画『聲の形』やアニメ『チェンソーマン』の劇伴でも知られる。オリジナルの美しさを最大化するアンビエント調リミックスを提供。",
        "related_work": "「夜の踊り子 (agraph Remix)」「目が明く藍色 (agraph remix)」",
        "external_url": None,
        "sort_order": 40,
    },
    {
        "slug": "aoki-takamasa",
        "name": "AOKI takamasa（青木 孝允）",
        "match_names": ["AOKI takamasa", "青木孝允", "青木 孝允"],
        "category": "remixer",
        "role": "エレクトロニカ・アーティスト",
        "description": "国内外で活動する日本トップクラスのエレクトロニカ・アーティスト。山口の最重要音楽朋友。サカナクションが休養期にラップトップセットを行う際にも支援した。『懐かしい月は新しい月 Vol. 1』で最多楽曲を手がけた。",
        "related_work": "「グッドバイ (NEXT WORLD REMIX)」「YES NO」「映画」各リミックス",
        "external_url": None,
        "sort_order": 41,
    },
    {
        "slug": "kuniyuki-takahashi",
        "name": "Kuniyuki Takahashi（高橋 邦之）",
        "match_names": ["Kuniyuki Takahashi", "高橋邦之", "高橋 邦之"],
        "category": "remixer",
        "role": "ハウス・アンビエント・プロデューサー",
        "description": "札幌を拠点とし、ハウス、アンビエント、ジャズを横断して世界を魅了する音楽職人。深夜「NF Records」イベント等でも幾度となく山口と共演。",
        "related_work": "「サンプル (cosmic version)」「ナイロンの糸 (Kuniyuki Takahashi Long Dub Version)」",
        "external_url": None,
        "sort_order": 42,
    },
    {
        "slug": "floating-points",
        "name": "Floating Points",
        "match_names": ["Floating Points", "フローティングポインツ"],
        "category": "remixer",
        "role": "DJ・電子音楽家（イギリス）",
        "description": "イギリスの世界的DJ・電子音楽家。山口が手がけるリミックス企画『懐かしい月は新しい月』の国際的キュレーションの象徴。",
        "related_work": "「years (Floating Points Remix)」",
        "external_url": None,
        "sort_order": 43,
    },
    {
        "slug": "yonyon",
        "name": "YonYon",
        "match_names": ["YonYon", "ヨンヨン"],
        "category": "remixer",
        "role": "マルチDJ・シンガー",
        "description": "ソウル生まれ東京育ちのマルチDJ・シンガー。草刈愛美らとも楽曲制作等で交流し、洗練されたフロアユースなリミックスを提供。",
        "related_work": "「エンドレス (YonYon Remix)」",
        "external_url": None,
        "sort_order": 44,
    },
    {
        "slug": "ishino-takkyu",
        "name": "石野 卓球",
        "match_names": ["石野卓球", "石野 卓球", "Takkyu Ishino"],
        "category": "remixer",
        "role": "テクノDJ・電気グルーヴメンバー",
        "description": "電気グルーヴのメンバーにして、日本のテクノシーンの首領。サカナクション初期のダンスミュージックとしての純度を底上げした立役者。",
        "related_work": "「ルーキー (Takkyu Ishino Remix)」",
        "external_url": None,
        "sort_order": 45,
    },
    {
        "slug": "sunaga-yoshinori",
        "name": "砂原 良徳",
        "match_names": ["砂原良徳", "砂原 良徳", "まりん", "METAFIVE"],
        "category": "remixer",
        "role": "METAFIVEメンバー・エレクトロニカ",
        "description": "METAFIVEのメンバーでありサニー（佐々木氏）とも親しい音響の巨匠。山口のポップスを極めて解像度の高いテクノサウンドへ再定義した。",
        "related_work": "「ライトダンス YSST Remix 2015」",
        "external_url": None,
        "sort_order": 46,
    },

    # ─────────────────────────────────────────
    # カテゴリ: team（チームサカナクション・前身バンド）
    # ─────────────────────────────────────────
    {
        "slug": "sasaki-yukio",
        "name": "佐々木 幸生（サニーさん）",
        "match_names": ["佐々木幸生", "佐々木 幸生", "サニーさん", "サニー"],
        "category": "team",
        "role": "PA・ライブサウンドエンジニア（アコースティック社）",
        "description": "サカナクションのライブサウンドに絶対的な魔法をかける音響エンジニア。採算度外視でスピーカーを大量配置する「音響の怪物」。6.1chサラウンドやd&b Soundscapeなどの最先端音響空間をオペレート。2026年3月に『サウンド＆レコーディング・マガジン』の表紙を山口と共に飾った。",
        "related_work": "SAKANAQUARIUM ライブ音響",
        "external_url": None,
        "sort_order": 50,
    },
    {
        "slug": "uramoto-masafumi",
        "name": "浦本 雅史",
        "match_names": ["浦本雅史", "浦本 雅史", "KURANGE"],
        "category": "team",
        "role": "レコーディング・エンジニア（青葉台スタジオ）",
        "description": "青葉台スタジオのチーフエンジニア。日本人初のApple「Apple Mastered for iTunes」公式ライセンス取得者。デジタルとアナログレコードの特性を知り尽くす音作りの右腕。2025年からは江島啓一とユニット「KURANGE」でも協働。",
        "related_work": "サカナクション全音源のレコーディング",
        "external_url": None,
        "sort_order": 51,
    },
    {
        "slug": "hirayama-kazuhiro",
        "name": "平山 和裕",
        "match_names": ["平山和裕", "平山 和裕"],
        "category": "team",
        "role": "照明デザイナー",
        "description": "1990年代からFISHMANS、EGO-WRAPPIN'、クラムボン、King Gnuなどのライブを支えてきた照明の伝説的人物。サカナクションのライブで何百本ものLEDバーとレーザーを音と完全シンクロさせ、空間を光で繋ぎ止める。",
        "related_work": "SAKANAQUARIUM 照明デザイン",
        "external_url": None,
        "sort_order": 52,
    },
    {
        "slug": "masuda-takashi",
        "name": "増田 崇",
        "match_names": ["増田崇", "増田 崇"],
        "category": "team",
        "role": "舞台監督",
        "description": "サカナクションの幾何学的かつ複雑を極めるライブステージを統率する舞台監督。田中裕介監督や山口の提示する一見実現不可能な演出プランを安全・確実に物理空間へ落とし込む大黒柱。",
        "related_work": "SAKANAQUARIUM 舞台監督",
        "external_url": None,
        "sort_order": 53,
    },
    {
        "slug": "nomura-tatsuya",
        "name": "野村 達矢",
        "match_names": ["野村達矢", "野村 達矢", "ヒップランドミュージック"],
        "category": "team",
        "role": "事務所代表（ヒップランドミュージック）・音制連理事長",
        "description": "所属事務所の代表取締役社長であり、音楽制作者連盟（音制連）理事長。サカナクションの共同作業者として山口と対話的関係を築く。",
        "related_work": None,
        "external_url": None,
        "sort_order": 54,
    },
    {
        "slug": "aoyama-shotaro",
        "name": "青山 翔太郎",
        "match_names": ["青山翔太郎", "青山 翔太郎"],
        "category": "team",
        "role": "DJ・アーティスト（NF所属）",
        "description": "プロジェクト「NF」所属のDJ・クリエイター。サカナクションのレコーディング参加、アンリアレイジのショー音楽協働、加藤浩次監督ドラマの劇伴制作を担当。",
        "related_work": None,
        "external_url": None,
        "sort_order": 55,
    },
    {
        "slug": "sabachan",
        "name": "サバちゃん（関口さん）",
        "match_names": ["サバちゃん", "関口さん"],
        "category": "team",
        "role": "チーフマネージャー",
        "description": "本名は関口。山口が「関口＝関サバ＝サバちゃん」と命名。山口と他のメンバー、ビジネスのバランスを繋ぐ現場の立役者。",
        "related_work": None,
        "external_url": None,
        "sort_order": 56,
    },
    {
        "slug": "saito-tomoki",
        "name": "斎藤 友樹（トモキ）",
        "match_names": ["斎藤友樹", "斎藤 友樹", "トモキ"],
        "category": "team",
        "role": "元ベース（ダッチマン）",
        "description": "山口一郎、岩寺基晴と共に「ダッチマンtheサンコンズ」を結成した初期メンバー。",
        "related_work": "前身バンド「ダッチマン」",
        "external_url": None,
        "sort_order": 57,
    },

    # ─────────────────────────────────────────
    # カテゴリ: craftsman（工芸・アートディレクター・デザイナー）
    # ─────────────────────────────────────────
    {
        "slug": "yagi-takahiro",
        "name": "八木 隆裕（開化堂六代目）",
        "match_names": ["八木隆裕", "八木 隆裕", "開化堂"],
        "category": "craftsman",
        "role": "京都・手作り茶筒の老舗「開化堂」六代目",
        "description": "明治8年創業の日本最古の手作り茶筒の老舗「開化堂」の六代目。山口と「変わらないまま変わる」というものづくり思想で強く共鳴。茶筒チェア・ジュエリーケース・Ploom AURAコラボなどを共創。",
        "related_work": "開化堂茶筒チェア・YI開化堂ジュエリーケース・Ploom AURAスティックケース",
        "external_url": None,
        "sort_order": 60,
    },
    {
        "slug": "tendo-mokko",
        "name": "天童木工",
        "match_names": ["天童木工"],
        "category": "craftsman",
        "role": "高級家具メーカー（山形県天童市）",
        "description": "1940年創業。成形合板の伝統技術「コマ入れ」を活用。山口の「YI」ロゴが宿るYIスツール（ブラック含む）や、剣持勇デザインのリバイバルデスクを山口の想いを契機に共同制作。",
        "related_work": "YIスツール・リバイバルデスク（剣持勇デザイン復刻）",
        "external_url": None,
        "sort_order": 61,
    },
    {
        "slug": "kamide-keigo",
        "name": "上出 惠悟（上出長右衛門窯）",
        "match_names": ["上出惠悟", "上出 惠悟", "上出長右衛門窯"],
        "category": "craftsman",
        "role": "九谷焼・六代目職人",
        "description": "九谷焼の窯元「上出長右衛門窯」の六代目であり画家・工芸家。「笛吹」のサカナクションver.共創、磁器バナナオブジェ「甘蕉」、スカジャンの「ナマズ」刺繍グラフィック、Ploom AURAの九谷焼パネル・トレイを手がける。",
        "related_work": "上出長右衛門窯×YIコラボ・Ploom AURAパネル",
        "external_url": None,
        "sort_order": 62,
    },
    {
        "slug": "cul-de-sac",
        "name": "Cul de Sac - JAPON（カルデサック ジャポン）",
        "match_names": ["Cul de Sac", "カルデサック ジャポン", "カルデサック", "黒川紗恵子"],
        "category": "craftsman",
        "role": "青森ヒバプロダクト・黒川紗恵子主宰",
        "description": "クラリネット奏者の黒川紗恵子が立ち上げた青森ヒバブランド。4度のコラボを重ね、山口愛用TシャツをモックネックパターンでYIバックネック別注。抗菌作用のあるヒバチップ入り圧縮バッグが付属。",
        "related_work": "YI別注モックネックTシャツ（¥17,600）",
        "external_url": None,
        "sort_order": 63,
    },
    {
        "slug": "taguchi-speaker",
        "name": "田口 和典（Taguchiスピーカー）",
        "match_names": ["田口和典", "田口 和典", "Taguchiスピーカー", "Taguchi"],
        "category": "craftsman",
        "role": "スピーカー職人（故人）",
        "description": "独自の「アルミハニカム平面振動板」を開発したスピーカーづくりの職人・故人。山口が「音の気配と佇まい」に衝撃を受け、ライブやPANORAMAでのTaguchiスピーカー導入へとつながった。",
        "related_work": "PANORAMA・ライブ会場でのTaguchiスピーカー導入",
        "external_url": None,
        "sort_order": 64,
    },
    {
        "slug": "sudo-reiko",
        "name": "須藤 玲子（株式会社「布」）",
        "match_names": ["須藤玲子", "須藤 玲子"],
        "category": "craftsman",
        "role": "テキスタイルデザイナー",
        "description": "日本の伝統技術と現代デザインを融合する布の職人。詩集『ことば２』のために特注布「蜃気楼（ミラージュ）」を織り上げ装幀を飾った。",
        "related_work": "詩集『ことば２』装幀布「蜃気楼（ミラージュ）」",
        "external_url": None,
        "sort_order": 65,
    },
    {
        "slug": "katayama-masamichi",
        "name": "片山 正通（ワンダーウォール）",
        "match_names": ["片山正通", "片山 正通", "ワンダーウォール"],
        "category": "craftsman",
        "role": "インテリアデザイナー・武蔵野美術大学教授",
        "description": "山口が14歳年上と慕う親友。伝統工芸開発で「物作りにおける歴史やコンテクストの咀嚼の重要性」を山口に教え込んだ恩師。",
        "related_work": None,
        "external_url": None,
        "sort_order": 66,
    },
    {
        "slug": "hirabayashi-naomi",
        "name": "平林 奈緒美",
        "match_names": ["平林奈緒美", "平林 奈緒美"],
        "category": "craftsman",
        "role": "アートディレクター",
        "description": "サカナクションのあらゆるビジュアルデザインを手がける。「サンテFX」の波形ボトルや、Shokz「OpenFit 2+」における「0106」のミニマルなタイポグラフィによる「余白の美学」を設計。",
        "related_work": "サカナクションビジュアル全般・Shokz OpenFit 2+ 山口一郎モデルデザイン",
        "external_url": None,
        "sort_order": 67,
    },
    {
        "slug": "kasai-kaoru",
        "name": "葛西 薫",
        "match_names": ["葛西薫", "葛西 薫"],
        "category": "craftsman",
        "role": "アートディレクター",
        "description": "「yamaichi」のシンボルロゴデザインを担当。詩集『ことば』シリーズの装幀を手がけ、山口と「浅川マキ」をはじめとするフォークソングのルーツを互いに持ち合うことで深く意気投合。",
        "related_work": "yamaichi ロゴ・詩集『ことば』シリーズ装幀",
        "external_url": None,
        "sort_order": 68,
    },
    {
        "slug": "maruwaka-hirotoshi",
        "name": "丸若 裕俊（GEN GEN AN）",
        "match_names": ["丸若裕俊", "丸若 裕俊", "GEN GEN AN", "MABOROSHI"],
        "category": "craftsman",
        "role": "香り・茶プロデューサー",
        "description": "「MABOROSHI」やお茶ブランド「GEN GEN AN」を主宰。山口もプロジェクトメンバーに名を連ね、生活世界の「香り」と「お茶」にまつわるカルチャーを共創している。",
        "related_work": None,
        "external_url": None,
        "sort_order": 69,
    },

    # ─────────────────────────────────────────
    # カテゴリ: product（コラボ製品・愛用ブランド）
    # ─────────────────────────────────────────
    {
        "slug": "cdg-yi",
        "name": "CDG YI（コム デ ギャルソン × yamaichi）",
        "match_names": ["CDG YI", "コム デ ギャルソン", "COMME des GARÇONS"],
        "category": "product",
        "role": "コラボカプセルコレクション",
        "description": "COMME des GARÇONSと山口一郎主宰「yamaichi」のコラボ。葛西薫によるYIロゴを配したオーバーサイズジャケット（¥85,800）・パンツ・シャツ・Tシャツなど全9型のブラックベースカプセルコレクション。",
        "related_work": "オーバーサイズジャケット¥85,800・パンツ¥44,000 他",
        "external_url": None,
        "sort_order": 70,
    },
    {
        "slug": "ploom-aura-yi",
        "name": "Ploom AURA × YI（JT コラボ）",
        "match_names": ["Ploom AURA", "Ploom X", "JTコラボ", "yamaichi"],
        "category": "product",
        "role": "コラボ喫煙具・限定フロントパネル",
        "description": "JTとyamaichiのコラボ。Ploom X：鼈甲職人・桂剥き職人の伝統技術転写パネル。Ploom AURA：開化堂「真鍮・緑青」・上出長右衛門窯「九谷焼・金継」・ローズウッド等のパネルに加え、真鍮製スティックケースや九谷焼スティックトレイを共創。",
        "related_work": "Ploom AURA 限定フロントパネル・スティックケース・スティックトレイ",
        "external_url": None,
        "sort_order": 71,
    },
    {
        "slug": "shokz-openfit2-yi",
        "name": "Shokz OpenFit 2+ 山口一郎モデル",
        "match_names": ["Shokz", "OpenFit 2+", "山口一郎モデル"],
        "category": "product",
        "role": "コラボイヤフォン（300個限定）",
        "description": "平林奈緒美による「0106」コードを盛り込んだミニマルデザイン。定価¥27,880。300個限定「山口一郎 限定スペシャルボックス」の抽選も実施。",
        "related_work": "Shokz OpenFit 2+ ¥27,880・限定スペシャルボックス抽選",
        "external_url": None,
        "sort_order": 72,
    },
    {
        "slug": "loopwheeler-nf",
        "name": "NF × Fragment × LW フーディー（Loopwheeler）",
        "match_names": ["Loopwheeler", "NF×Fragment", "NFRGMTフーディー"],
        "category": "product",
        "role": "コラボパーカー",
        "description": "「罰ゲーム・ご褒美フーディ」として開発。LWライト吊り裏毛使用、カンガルーポケットを排除した山口一郎専用パターン。定価¥24,200。",
        "related_work": "NF × Fragment Design × Loopwheeler フーディー ¥24,200",
        "external_url": None,
        "sort_order": 73,
    },
    {
        "slug": "naturalcosmo-yi",
        "name": "NATURALCOSMO × YI シャンプー",
        "match_names": ["NATURALCOSMO", "風流トリートメントシャンプー"],
        "category": "product",
        "role": "コラボシャンプー",
        "description": "恐竜時代の地層から抽出した古代ミネラルやハーブを配合したトリートメントシャンプー（¥6,300 / 300mL）。厚手0.6mmマットブラック紙にシルバー特色インクで活版印刷した特別限定化粧箱を採用。",
        "related_work": "風流トリートメントシャンプー ¥6,300・活版印刷化粧箱",
        "external_url": None,
        "sort_order": 74,
    },
    {
        "slug": "i-need-you-baby-yi",
        "name": "I NEED YOU BABY × YI スカジャン",
        "match_names": ["I NEED YOU BABY", "アイニーヂューベイべー", "スカジャン"],
        "category": "product",
        "role": "コラボスカジャン",
        "description": "リバーシブルスカジャン（¥69,960）。アセテートとベロアの二重仕様、ブラック単色。上出惠悟デザインの「ナマズ」細密刺繍グラフィックが施されている。",
        "related_work": "I NEED YOU BABY×YI スカジャン ¥69,960",
        "external_url": None,
        "sort_order": 75,
    },
    {
        "slug": "jins-yi",
        "name": "JINS × 山口一郎 アイウエア",
        "match_names": ["JINS", "山口一郎 眼鏡", "ジンズ"],
        "category": "product",
        "role": "コラボアイウエア",
        "description": "つや消し黒縁ウェリントン。光の反射を徹底して抑えるマット加工。耳にかかるテンプルを可動式に設計。定価¥19,900（度付きレンズ込）。",
        "related_work": "JINS×山口一郎 ウェリントン ¥19,900",
        "external_url": None,
        "sort_order": 76,
    },

    # ─────────────────────────────────────────
    # カテゴリ: project（山口一郎主宰プロジェクト）
    # ─────────────────────────────────────────
    {
        "slug": "nf-project",
        "name": "NF（プロジェクト）",
        "match_names": ["NFプロジェクト", "NF Records", "SAKANAQUARIUM"],
        "category": "project",
        "role": "山口一郎主宰のダンス・クラブミュージックプロジェクト",
        "description": "山口一郎が主宰するダンスミュージックとロックの融合を企図したプロジェクト。「NF Records」イベントやコラボアルバム『懐かしい月は新しい月』シリーズを展開。agraph（牛尾憲輔）が初期メンバー。",
        "related_work": "『懐かしい月は新しい月』Vol.1・Vol.2",
        "external_url": None,
        "sort_order": 80,
    },
    {
        "slug": "yamaichi-project",
        "name": "yamaichi（ヤマイチ）",
        "match_names": ["yamaichi", "ヤマイチ", "YI"],
        "category": "project",
        "role": "山口一郎主宰のクラフト・プロダクトプロジェクト",
        "description": "山口一郎が主宰する「物作りの背景や職人の技術に光を当てる」コンセプトのプロジェクト。開化堂・天童木工・上出長右衛門窯・各ブランドとのコラボを展開。ロゴは葛西薫デザイン。",
        "related_work": "各種職人コラボ・CDG YI・Ploom AURAなど",
        "external_url": None,
        "sort_order": 81,
    },
    {
        "slug": "sakanaction",
        "name": "サカナクション",
        "match_names": ["サカナクション", "SAKANACTION"],
        "category": "project",
        "role": "山口一郎が率いる日本のロックバンド",
        "description": "2005年に前身バンド「ダッチマン」から改名して結成。山口一郎（Vo.Gt）・岩寺基晴（Gt）・草刈愛美（Ba）・岡崎英美（Key）・江島啓一（Dr）の5人組。ダンスミュージックとフォークロックを融合させた独自のサウンドで知られる。",
        "related_work": "「新宝島」「アイデンティティ」「ミュージック」他",
        "external_url": "https://www.sakanaction.jp",
        "sort_order": 1,
    },
    {
        "slug": "dutchman",
        "name": "ダッチマン（旧名：ダッチマンtheサンコンズ）",
        "match_names": ["ダッチマン", "ダッチマンtheサンコンズ"],
        "category": "project",
        "role": "サカナクションの前身バンド",
        "description": "1998年に札幌で結成された前身バンド。山口一郎（Vo.Gt）・岩寺基晴（Gt）・斎藤友樹（Ba）・原康之（Dr）の4ピース。インディーズで「三日月サンセット」等を発売。2004年に3名が脱退し、2005年に「サカナクション」として再出発。",
        "related_work": "インディーズアルバム「demonstration」・「三日月サンセット」",
        "external_url": None,
        "sort_order": 2,
    },
]


def seed(dry_run: bool = False) -> None:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL または NEXT_PUBLIC_SUPABASE_URL が未設定")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY が未設定")

    logger.info(f"対象 entity 件数: {len(ENTITIES)}")

    if dry_run:
        logger.info("[dry-run] DBへの書き込みをスキップします")
        for e in ENTITIES:
            logger.info(f"  slug={e['slug']} name={e['name']} category={e['category']} match_names={e['match_names']}")
        return

    sb = create_client(url, key)

    try:
        sb.table("entities").select("id").limit(1).execute()
    except Exception as e:
        raise RuntimeError("entities テーブルが見つかりません。先に supabase/migrations/007_entities.sql を適用してください") from e

    for entity in ENTITIES:
        # match_names は必ず 3文字以上のみに絞る（2文字以下は誤爆源）
        filtered_match_names = [n for n in entity["match_names"] if len(n) >= 3]

        row = {
            "slug": entity["slug"],
            "name": entity["name"],
            "match_names": filtered_match_names,
            "category": entity["category"],
            "role": entity.get("role"),
            "description": entity.get("description", ""),
            "related_work": entity.get("related_work"),
            "external_url": entity.get("external_url"),
            "sort_order": entity.get("sort_order", 0),
        }

        try:
            result = sb.table("entities").upsert(row, on_conflict="slug").execute()
            if result.data:
                logger.info(f"  upsert OK: {entity['slug']}")
            else:
                logger.warning(f"  upsert 空レスポンス: {entity['slug']}")
        except Exception as e:
            logger.error(f"  upsert 失敗: {entity['slug']} → {e}")

    logger.info("seed 完了")

    # 投入件数を確認
    count_res = sb.table("entities").select("id", count="exact").execute()
    logger.info(f"entities テーブル総件数: {count_res.count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="entities テーブルに初期データを投入する")
    parser.add_argument("--dry-run", action="store_true", help="DBへの書き込みを行わず内容を確認するだけ")
    args = parser.parse_args()
    seed(dry_run=args.dry_run)
