import { expect, test } from '@playwright/test'
import { TAG_LABELS } from '../src/lib/tag-labels'

const EXPECTED_TAG_LABELS: Record<string, string> = {
  gaming: 'ゲーム',
  mental_health: 'メンタルヘルス',
  depression: 'うつ病',
  ai_topic: 'AI',
  philosophy: '哲学',
  relationships: '人間関係',
  social_issues: '社会問題',
  fashion: 'ファッション',
  baseball: '野球',
  sauna: 'サウナ',
  merch: 'グッズ紹介',
  guest: 'ゲスト',
  collab: 'コラボ',
  new_song: '新曲発表',
  fan_interaction: 'ファン交流',
  life_advice: '人生相談',
  love_advice: '恋愛相談',
  casual_talk: '雑談',
  music_production: '音楽制作',
  making_story: '制作秘話',
  song_explanation: '楽曲解説',
  live_report: 'ライブレポート',
  live_staging: 'ライブ演出裏話',
  festival: 'フェス',
  tour: 'ツアー',
  music_industry: '音楽業界',
  radio: 'ラジオ',
  ann: 'オールナイトニッポン',
}

test('TAG_LABELS matches the current tag vocabulary snapshot', () => {
  expect(TAG_LABELS).toEqual(EXPECTED_TAG_LABELS)
})
