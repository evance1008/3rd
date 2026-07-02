#!/usr/bin/env node
'use strict';

/**
 * data/countries.json を生成するビルドスクリプト。
 *
 * 【重要】データソースについて
 * 本来はCLAUDE.md記載どおり REST Countries API (restcountries.com) と
 * Wikidata SPARQL (query.wikidata.org) を直接叩く設計だが、このスクリプトを
 * 実行するネットワーク環境によっては両ホストにアクセスできない場合がある。
 * そのため下記のように「直接APIを叩く関数」を用意しつつ、失敗した場合は
 * 例外を投げずに null を返し、該当フィールドを欠損のまま出力する
 * (アプリ側でフォールバック表示する前提)。
 *
 * 国の基本情報・人口については、restcountries.com 自体に到達できない環境向けに
 * GitHubミラー(raw.githubusercontent.com)をフォールバックソースとして使用する。
 *   - 基本情報: https://github.com/mledoze/countries (REST Countriesの一次データ源)
 *   - 人口:     https://github.com/samayo/country-json
 * REST Countries API に到達できる環境で実行する場合は fetchCountriesBase() の
 * 冒頭にある USE_REST_COUNTRIES_API を true にすること。
 */

const fs = require('fs');
const path = require('path');

const USER_AGENT = '3rd-globe-app-build/1.0 (https://github.com/evance1008/3rd; data foundation phase)';
const REQUEST_INTERVAL_MS = 100;
const DATA_DIR = path.join(__dirname, '..', 'data');

const cuisineGreetings = require('./data/cuisine-greetings.js');
const touristSpots = require('./data/tourist-spots.js');

// ────────────────────────────────────────────
// 共通ユーティリティ
// ────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** JSON取得。失敗時はnullを返し、エラーで落とさない */
async function fetchJson(url, { timeoutMs = 30000 } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[warn] GET ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[warn] GET ${url} failed: ${err.message}`);
    return null;
  }
}

/** URLがHTTPステータス的に有効(200)かどうかを確認する。失敗時はfalse */
async function isUrlReachable(url, { timeoutMs = 15000 } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // HEADに対応しないサーバーもあるためGETで確認する(bodyは読み捨てる)
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch (err) {
    return false;
  }
}

// ────────────────────────────────────────────
// 1. 基本情報(REST Countries / GitHubミラー)
// ────────────────────────────────────────────

// true にすると restcountries.com API を直接叩く(到達可能な環境向け)
const USE_REST_COUNTRIES_API = false;

const REST_COUNTRIES_FIELDS =
  'name,translations,cca2,cca3,capital,population,area,languages,currencies,flags,latlng,unMember';

async function fetchCountriesBaseFromApi() {
  const url = `https://restcountries.com/v3.1/all?fields=${REST_COUNTRIES_FIELDS}`;
  const data = await fetchJson(url);
  return data;
}

/**
 * GitHubミラー(mledoze/countries)から基本情報を取得し、
 * REST Countries v3.1 の該当フィールドに近い形へ整形する。
 * 人口(population)フィールドはこのリポジトリに無いため別途取得して補完する。
 */
async function fetchCountriesBaseFromMirror() {
  const url = 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';
  const data = await fetchJson(url);
  if (!data) return null;
  return data.map((c) => ({
    name: c.name,
    translations: c.translations,
    cca2: c.cca2,
    cca3: c.cca3,
    capital: c.capital,
    population: null, // 別途 fetchPopulationMap() で補完
    area: c.area,
    languages: c.languages,
    currencies: c.currencies,
    latlng: c.latlng,
    unMember: c.unMember,
  }));
}

/**
 * mledoze/countries の unMember フラグには既知の誤り(バチカン市国 VAT を
 * unMember:true としてしまっている)があるため手動で補正する。
 * バチカン市国(聖座)は国連総会オブザーバーであり、正式な国連加盟国ではない。
 */
const UN_MEMBER_CORRECTIONS = {
  VAT: false, // 国連加盟国ではない(常任オブザーバー)
};

// mledoze/countries データの欠損補正: ミクロネシア連邦の通貨情報が空になっているため補完
// (公式通貨は米ドル)
const CURRENCY_CORRECTIONS = {
  FSM: { USD: { name: 'United States dollar', symbol: '$' } },
};

function applyCurrencyCorrections(countries) {
  return countries.map((c) => ({
    ...c,
    currencies:
      c.currencies && Object.keys(c.currencies).length > 0
        ? c.currencies
        : CURRENCY_CORRECTIONS[c.cca3] || c.currencies,
  }));
}

function applyUnMemberCorrections(countries) {
  return countries.map((c) => ({
    ...c,
    unMember: Object.prototype.hasOwnProperty.call(UN_MEMBER_CORRECTIONS, c.cca3)
      ? UN_MEMBER_CORRECTIONS[c.cca3]
      : c.unMember,
  }));
}

// samayo/country-json の国名表記が mledoze/countries と揺れているものの補正
const POPULATION_NAME_TO_CCA2 = {
  'Cabo Verde': 'CV', // mledoze側は "Cape Verde"
  'East Timor': 'TL', // mledoze側は "Timor-Leste"
};

async function fetchPopulationByCca2() {
  const popUrl = 'https://raw.githubusercontent.com/samayo/country-json/master/src/country-by-population.json';
  const abbrUrl = 'https://raw.githubusercontent.com/samayo/country-json/master/src/country-by-abbreviation.json';
  const [pop, abbr] = await Promise.all([fetchJson(popUrl), fetchJson(abbrUrl)]);
  const map = new Map();
  if (!pop || !abbr) return map;
  const nameToCca2 = new Map(abbr.map((a) => [a.country, a.abbreviation]));
  for (const [name, cca2] of Object.entries(POPULATION_NAME_TO_CCA2)) {
    nameToCca2.set(name, cca2);
  }
  for (const p of pop) {
    const cca2 = nameToCca2.get(p.country);
    if (cca2 && typeof p.population === 'number') {
      map.set(cca2, p.population);
    }
  }
  return map;
}

// ────────────────────────────────────────────
// 2. 国境ポリゴン(Natural Earth 110m)
// ────────────────────────────────────────────

async function fetchNaturalEarthGeoJson() {
  const url =
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
  return fetchJson(url);
}

/** cca3 -> GeoJSON Feature のマップを作る(ISO_A3が-99の場合はADM0_A3で代替) */
function buildIsoToFeatureMap(geojson) {
  const map = new Map();
  if (!geojson || !Array.isArray(geojson.features)) return map;
  for (const f of geojson.features) {
    const props = f.properties || {};
    let iso = props.ISO_A3;
    if (!iso || iso === '-99') iso = props.ADM0_A3;
    if (!iso || iso === '-99') continue;
    map.set(iso, f);
  }
  return map;
}

// ────────────────────────────────────────────
// 3. 国旗画像(GitHubミラー: hjnilsson/country-flags)
// ────────────────────────────────────────────

function buildFlagUrl(cca2) {
  return `https://raw.githubusercontent.com/hjnilsson/country-flags/master/svg/${cca2.toLowerCase()}.svg`;
}

// ────────────────────────────────────────────
// 4. 国歌音源(Wikidata SPARQL) ※ネットワーク遮断環境ではnullになる
// ────────────────────────────────────────────

async function fetchAnthemAudioMap() {
  const endpoint = 'https://query.wikidata.org/sparql';
  const query = `
    SELECT ?isoCode ?audio WHERE {
      ?country wdt:P298 ?isoCode .
      ?country wdt:P85 ?anthem .
      ?anthem wdt:P51 ?audio .
    }
  `.trim();
  const url = `${endpoint}?query=${encodeURIComponent(query)}&format=json`;
  const data = await fetchJson(url, { timeoutMs: 60000 });
  const map = new Map();
  if (!data || !data.results) return map;
  for (const row of data.results.bindings) {
    const iso3 = row.isoCode && row.isoCode.value;
    const audioUrl = row.audio && row.audio.value;
    if (iso3 && audioUrl) map.set(iso3, audioUrl);
  }
  return map;
}

// ────────────────────────────────────────────
// 5. 観光地(Wikipedia REST API) ※ネットワーク遮断環境ではnullになる
// ────────────────────────────────────────────

async function fetchWikipediaSummary(title) {
  const url = `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  return fetchJson(url);
}

// ────────────────────────────────────────────
// メイン処理
// ────────────────────────────────────────────

async function main() {
  console.log('== フェーズ1: データ基盤ビルド開始 ==');

  console.log('[1/6] 基本情報を取得中...');
  const rawCountries = USE_REST_COUNTRIES_API
    ? await fetchCountriesBaseFromApi()
    : await fetchCountriesBaseFromMirror();

  if (!rawCountries) {
    console.error('致命的エラー: 基本情報の取得に失敗しました。処理を停止します。');
    process.exit(1);
  }

  const corrected = applyCurrencyCorrections(applyUnMemberCorrections(rawCountries));
  const unCountries = corrected.filter((c) => c.unMember === true);

  console.log(`国連加盟国として抽出された件数: ${unCountries.length}`);
  if (unCountries.length !== 193) {
    console.error(
      `致命的エラー: 国連加盟国数が193ではありません(実際: ${unCountries.length})。` +
        'データソースの不整合の可能性があるため処理を停止します。'
    );
    process.exit(1);
  }

  await sleep(REQUEST_INTERVAL_MS);

  console.log('[2/6] 人口データを取得中...');
  const populationMap = USE_REST_COUNTRIES_API ? null : await fetchPopulationByCca2();

  await sleep(REQUEST_INTERVAL_MS);

  console.log('[3/6] Natural Earth 110m GeoJSONを取得中...');
  const geojson = await fetchNaturalEarthGeoJson();
  const isoToFeature = buildIsoToFeatureMap(geojson);

  await sleep(REQUEST_INTERVAL_MS);

  console.log('[4/6] 国歌音源(Wikidata)を取得中...');
  const anthemMap = await fetchAnthemAudioMap();
  console.log(`  -> 取得できた国歌音源: ${anthemMap.size}件`);

  console.log('[5/6] 国旗画像URLの有効性を確認中...');
  const flagUrlCache = new Map();
  for (const c of unCountries) {
    const url = buildFlagUrl(c.cca2);
    const ok = await isUrlReachable(url);
    flagUrlCache.set(c.cca3, ok ? url : null);
    await sleep(REQUEST_INTERVAL_MS);
  }

  console.log('[6/6] 観光地情報(Wikipedia)を取得中...');
  const touristSpotCache = new Map();
  for (const c of unCountries) {
    const spot = touristSpots[c.cca3];
    if (!spot) {
      touristSpotCache.set(c.cca3, null);
      continue;
    }
    const summary = await fetchWikipediaSummary(spot.wikipediaTitle);
    const imageUrl = summary && summary.thumbnail ? summary.thumbnail.source : null;
    const articleUrl =
      summary && summary.content_urls && summary.content_urls.desktop
        ? summary.content_urls.desktop.page
        : null;
    touristSpotCache.set(c.cca3, {
      name: spot.name,
      imageUrl: imageUrl || null,
      wikipediaUrl: articleUrl || null,
    });
    await sleep(REQUEST_INTERVAL_MS);
  }

  console.log('出力データを組み立て中...');
  const output = unCountries
    .map((c) => buildCountryRecord(c, { populationMap, isoToFeature, anthemMap, flagUrlCache, touristSpotCache }))
    .sort((a, b) => a.cca3.localeCompare(b.cca3));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'countries.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(`data/countries.json を書き出しました(${output.length}件)`);

  // 国境ポリゴンは対象193カ国分のみ抽出し、不要なプロパティを削って軽量化する
  // (Natural Earthの元データは1国あたり100以上のプロパティを持ち、モバイル向けには過剰なため)
  const targetIso = new Set(unCountries.map((c) => c.cca3));
  const filteredFeatures = (geojson && geojson.features ? geojson.features : [])
    .filter((f) => {
      const props = f.properties || {};
      let iso = props.ISO_A3;
      if (!iso || iso === '-99') iso = props.ADM0_A3;
      return targetIso.has(iso);
    })
    .map((f) => {
      const props = f.properties || {};
      let iso = props.ISO_A3;
      if (!iso || iso === '-99') iso = props.ADM0_A3;
      return {
        type: 'Feature',
        properties: { cca3: iso, name: props.NAME },
        geometry: f.geometry,
      };
    });
  const borderGeoJson = { type: 'FeatureCollection', features: filteredFeatures };
  fs.writeFileSync(path.join(DATA_DIR, 'world-110m.geojson'), JSON.stringify(borderGeoJson), 'utf8');
  console.log(`data/world-110m.geojson を書き出しました(${filteredFeatures.length}件のポリゴン)`);

  console.log('== ビルド完了 ==');
}

function buildCountryRecord(c, { populationMap, isoToFeature, anthemMap, flagUrlCache, touristSpotCache }) {
  const cg = cuisineGreetings[c.cca3];
  const feature = isoToFeature.get(c.cca3);
  const population = populationMap && populationMap.has(c.cca2) ? populationMap.get(c.cca2) : c.population || null;

  return {
    cca2: c.cca2,
    cca3: c.cca3,
    name: {
      common: c.name.common,
      official: c.name.official,
      ja: (c.translations && c.translations.jpn && c.translations.jpn.common) || c.name.common,
    },
    capital: (c.capital && c.capital[0]) || null,
    population: population || null,
    area: typeof c.area === 'number' ? c.area : null,
    languages: c.languages ? Object.entries(c.languages).map(([code, name]) => ({ code, name })) : [],
    currencies: c.currencies
      ? Object.entries(c.currencies).map(([code, cur]) => ({ code, name: cur.name, symbol: cur.symbol || null }))
      : [],
    flagImageUrl: flagUrlCache.get(c.cca3) || null,
    latlng: c.latlng || null,
    geoType: feature ? 'polygon' : 'point',
    anthem: {
      audioUrl: anthemMap.get(c.cca3) || null,
    },
    touristSpot: touristSpotCache.get(c.cca3) || null,
    cuisine: cg ? cg.cuisine : null,
    greeting: cg ? cg.greeting : null,
  };
}

main().catch((err) => {
  console.error('予期しないエラーで停止しました:', err);
  process.exit(1);
});
