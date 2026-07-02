#!/usr/bin/env node
'use strict';

/**
 * data/countries.json の検証スクリプト。
 * - 国数が193であること
 * - 必須項目(首都/人口/面積/公用語/通貨/国旗/料理/挨拶)の充足率が100%であること
 * - 準必須項目(国歌/観光地画像/ポリゴン)の充足率を集計して表示すること
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'countries.json');

const REQUIRED_FIELDS = [
  ['capital', (c) => Boolean(c.capital)],
  ['population', (c) => typeof c.population === 'number' && c.population > 0],
  ['area', (c) => typeof c.area === 'number' && c.area > 0],
  ['languages', (c) => Array.isArray(c.languages) && c.languages.length > 0],
  ['currencies', (c) => Array.isArray(c.currencies) && c.currencies.length > 0],
  ['flagImageUrl', (c) => Boolean(c.flagImageUrl)],
  ['cuisine', (c) => Boolean(c.cuisine && c.cuisine.name)],
  ['greeting', (c) => Boolean(c.greeting && c.greeting.native)],
];

const SEMI_REQUIRED_FIELDS = [
  ['anthem.audioUrl', (c) => Boolean(c.anthem && c.anthem.audioUrl)],
  ['touristSpot.imageUrl', (c) => Boolean(c.touristSpot && c.touristSpot.imageUrl)],
  ['geoType=polygon', (c) => c.geoType === 'polygon'],
];

function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`致命的エラー: ${DATA_PATH} が存在しません。先に build-data.js を実行してください。`);
    process.exit(1);
  }

  const countries = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  let hasError = false;

  console.log('== データ検証 ==');
  console.log(`国数: ${countries.length}`);
  if (countries.length !== 193) {
    console.error(`エラー: 国数が193ではありません(実際: ${countries.length})`);
    hasError = true;
  }

  console.log('\n-- 必須項目の充足率 --');
  for (const [label, pred] of REQUIRED_FIELDS) {
    const filled = countries.filter(pred);
    const rate = ((filled.length / countries.length) * 100).toFixed(1);
    console.log(`${label}: ${filled.length}/${countries.length} (${rate}%)`);
    if (filled.length !== countries.length) {
      hasError = true;
      const missing = countries.filter((c) => !pred(c)).map((c) => `${c.cca3}(${c.name.ja})`);
      console.log(`  欠損国: ${missing.join(', ')}`);
    }
  }

  console.log('\n-- 準必須項目の充足率 --');
  for (const [label, pred] of SEMI_REQUIRED_FIELDS) {
    const filled = countries.filter(pred);
    const rate = ((filled.length / countries.length) * 100).toFixed(1);
    console.log(`${label}: ${filled.length}/${countries.length} (${rate}%)`);
  }

  console.log('\n== 検証結果 ==');
  if (hasError) {
    console.error('必須項目に欠損があります。');
    process.exit(1);
  } else {
    console.log('必須項目はすべて充足しています。');
  }
}

main();
