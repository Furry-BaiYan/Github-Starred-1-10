import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(__dirname, "..", ".cache", "top10.json");

const GITHUB_SEARCH_API =
  "https://api.github.com/search/repositories?q=stars:>100000&sort=stars&order=desc&per_page=10";

const SEED_REPOS = [
  "codecrafters-io/build-your-own-x",
  "sindresorhus/awesome",
  "public-apis/public-apis",
  "freeCodeCamp/freeCodeCamp",
  "EbookFoundation/free-programming-books",
  "donnemartin/system-design-primer",
  "jwasham/coding-interview-university",
  "kamranahmedse/developer-roadmap",
  "996icu/996.ICU",
  "vinta/awesome-python",
  "Practical-Tutorials/project-based-learning",
  "torvalds/linux"
];

let latestSnapshot = null;
let inflightPromise = null;

function buildHeaders(accept = "application/vnd.github+json") {
  const headers = {
    Accept: accept,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GitHubStarredTop10/1.0",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  }
  return headers;
}

function normalizeApiItem(item, index) {
  return {
    rank: index + 1,
    id: item.id,
    name: item.name,
    fullName: item.full_name,
    owner: {
      login: item.owner?.login || item.full_name.split("/")[0],
      avatarUrl: item.owner?.avatar_url || "",
      url: item.owner?.html_url || `https://github.com/${item.full_name.split("/")[0]}`
    },
    url: item.html_url || `https://github.com/${item.full_name}`,
    homepage: item.homepage || "",
    description: item.description || "暂无项目简介",
    stars: Number(item.stargazers_count || 0),
    forks: Number(item.forks_count || 0),
    watchers: Number(item.watchers_count || item.stargazers_count || 0),
    openIssues: Number(item.open_issues_count || 0),
    language: item.language || "Multi / Docs",
    topics: Array.isArray(item.topics) ? item.topics.slice(0, 6) : [],
    license: item.license?.spdx_id && item.license.spdx_id !== "NOASSERTION"
      ? item.license.spdx_id
      : item.license?.name || "",
    createdAt: item.created_at || null,
    updatedAt: item.updated_at || null,
    pushedAt: item.pushed_at || null
  };
}

async function saveCache(snapshot) {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  } catch {
    // Ignore disk cache write errors
  }
}

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
      return parsed;
    }
  } catch {
    // Ignore missing/invalid cache
  }
  return null;
}

function parseCountText(raw) {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/,/g, "").trim().toLowerCase();
  if (cleaned.endsWith("k")) return Math.round(parseFloat(cleaned) * 1000);
  if (cleaned.endsWith("m")) return Math.round(parseFloat(cleaned) * 1_000_000);
  const num = parseInt(cleaned, 10);
  return Number.isFinite(num) ? num : 0;
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function scrapeRepoHtml(fullName, fallbackItem = null) {
  const url = `https://github.com/${fullName}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${fullName}`);
  }
  const html = await res.text();

  // Extract exact star count from counter title or aria-label
  const starTitleMatch =
    html.match(/id="repo-stars-counter-star"[^>]*title="([\d,]+)"/i) ||
    html.match(/id="repo-stars-counter-star"[^>]*aria-label="([\d,]+)\s+users/i) ||
    html.match(/href="\/[^"]+\/stargazers"[^>]*>[\s\S]{0,300}?title="([\d,]+)"/i);
  const forkTitleMatch =
    html.match(/id="repo-network-counter"[^>]*title="([\d,]+)"/i) ||
    html.match(/href="\/[^"]+\/forks"[^>]*>[\s\S]{0,300}?title="([\d,]+)"/i);
  const descMatch = html.match(
    /<meta\s+name="description"\s+content="([^"]*)"/i
  );

  const [owner, name] = fullName.split("/");
  let description = fallbackItem?.description || "暂无项目简介";
  if (descMatch?.[1]) {
    const rawDesc = decodeHtmlEntities(descMatch[1]);
    const suffix = ` - ${fullName}`;
    const contributePrefix = `Contribute to ${fullName}`;
    if (!rawDesc.startsWith(contributePrefix)) {
      description = rawDesc.endsWith(suffix)
        ? rawDesc.slice(0, -suffix.length).trim()
        : rawDesc;
    }
  }

  return {
    rank: 0,
    id: fallbackItem?.id || fullName,
    name,
    fullName,
    owner: {
      login: owner,
      avatarUrl:
        fallbackItem?.owner?.avatarUrl || `https://github.com/${owner}.png?size=96`,
      url: `https://github.com/${owner}`
    },
    url,
    homepage: fallbackItem?.homepage || "",
    description,
    stars: starTitleMatch ? parseCountText(starTitleMatch[1]) : fallbackItem?.stars || 0,
    forks: forkTitleMatch ? parseCountText(forkTitleMatch[1]) : fallbackItem?.forks || 0,
    watchers: fallbackItem?.watchers || 0,
    openIssues: fallbackItem?.openIssues || 0,
    language: fallbackItem?.language || "Open Source",
    topics: fallbackItem?.topics || [],
    license: fallbackItem?.license || "",
    createdAt: fallbackItem?.createdAt || null,
    updatedAt: new Date().toISOString(),
    pushedAt: fallbackItem?.pushedAt || null
  };
}

async function fetchViaApi() {
  const response = await fetch(GITHUB_SEARCH_API, {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(15000)
  });

  const remaining = response.headers.get("x-ratelimit-remaining");
  const limit = response.headers.get("x-ratelimit-limit");
  const resetEpoch = response.headers.get("x-ratelimit-reset");

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const err = new Error(
      `GitHub API 响应 ${response.status}${bodyText ? `: ${bodyText.slice(0, 140)}` : ""}`
    );
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("GitHub 返回的项目列表为空");
  }

  const sorted = [...data.items]
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 10)
    .map(normalizeApiItem);

  return {
    ok: true,
    source: "github-live",
    sourceLabel: "GitHub.com 实时数据",
    fetchedAt: new Date().toISOString(),
    rateLimit: {
      remaining: remaining !== null ? Number(remaining) : null,
      limit: limit !== null ? Number(limit) : null,
      resetAt: resetEpoch
        ? new Date(Number(resetEpoch) * 1000).toISOString()
        : null
    },
    items: sorted
  };
}

async function fetchViaHtmlFallback(previousSnapshot) {
  const baseItems = previousSnapshot?.items?.length
    ? previousSnapshot.items
    : SEED_REPOS.map((slug) => ({ fullName: slug }));

  const settled = await Promise.allSettled(
    baseItems.map((item) => scrapeRepoHtml(item.fullName, item))
  );

  const scraped = settled
    .filter((r) => r.status === "fulfilled" && r.value.stars > 0)
    .map((r) => r.value)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 10)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));

  if (scraped.length < 5) {
    throw new Error("GitHub 网页直连兜底抓取数量不足");
  }

  return {
    ok: true,
    source: "github-html-live",
    sourceLabel: "GitHub.com 网页实时直抓",
    fetchedAt: new Date().toISOString(),
    rateLimit: null,
    items: scraped
  };
}

export async function fetchTop10Starred({ force = false } = {}) {
  if (
    !force &&
    latestSnapshot &&
    Date.now() - new Date(latestSnapshot.fetchedAt).getTime() < 15_000
  ) {
    return latestSnapshot;
  }

  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = (async () => {
    try {
      const liveSnapshot = await fetchViaApi();
      latestSnapshot = liveSnapshot;
      await saveCache(liveSnapshot);
      return liveSnapshot;
    } catch (apiErr) {
      const diskCache = latestSnapshot || (await loadCache());
      try {
        const htmlLive = await fetchViaHtmlFallback(diskCache);
        latestSnapshot = htmlLive;
        await saveCache(htmlLive);
        return htmlLive;
      } catch {
        if (diskCache) {
          const fallback = {
            ...diskCache,
            source: "cache-fallback",
            sourceLabel: "本地缓存兜底（GitHub 限流中）",
            warning: apiErr.message
          };
          latestSnapshot = fallback;
          return fallback;
        }
        throw apiErr;
      }
    } finally {
      inflightPromise = null;
    }
  })();

  return inflightPromise;
}

export function getLatestSnapshot() {
  return latestSnapshot;
}
