import { getLatestSnapshot } from "./github.js";

const CN_NUM_MAP = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
};

function formatNumber(num) {
  return Number(num || 0).toLocaleString("en-US");
}

function detectRankQuery(text) {
  const numMatch =
    text.match(/(?:第\s*|#\s*|top\s*|rank\s*|no\.?\s*)(\d{1,2})/i) ||
    text.match(/^(\d{1,2})号?$/);
  if (numMatch) {
    const n = Number(numMatch[1]);
    if (n >= 1 && n <= 10) return n;
  }
  const cnMatch = text.match(/第\s*([一二三四五六七八九十])/);
  if (cnMatch && CN_NUM_MAP[cnMatch[1]]) {
    return CN_NUM_MAP[cnMatch[1]];
  }
  if (/榜首|冠军|最多star|star最多/i.test(text)) {
    return 1;
  }
  return null;
}

export function createChatSession({ onWebMessage } = {}) {
  const history = [];

  function generateReply(rawText) {
    const text = rawText.trim();
    const lower = text.toLowerCase();
    const snap = getLatestSnapshot();
    const items = snap?.items || [];

    if (!items.length) {
      return "当前尚未加载到 GitHub Top 10 数据，请先输入 /refresh 重新抓取，或输入 /start 启动网页查看。";
    }

    if (/^(你好|嗨|hi|hello|hey|在吗)/i.test(text)) {
      const top1 = items[0];
      return `你好！我是常驻终端助手。当前 GitHub 全站 Starred 榜首是 ${top1.fullName}（★ ${formatNumber(top1.stars)}）。你可以直接问我榜单里的任意项目（如“第1名是什么”、“有哪些 Python 项目”、“Fork 最多的是哪个”），或输入 /start 打开本地网页！`;
    }

    if (/帮助|怎么用|指令|功能/.test(text)) {
      return "可用指令：/start（打开本地前10展示网站）、/refresh（重新实时抓取）、/list（终端重印前10）、/open 1~10（直达某项目）、/clear（清屏）、/exit（退出）。也可以直接输入文字向我提问榜单详情！";
    }

    // Fork comparison query
    if (/fork\s*最多|最多\s*fork|分支最多/i.test(text)) {
      const topFork = [...items].sort((a, b) => b.forks - a.forks)[0];
      return `前 10 项目里 Fork 最多的是 #${topFork.rank} ${topFork.fullName}，共有 ${formatNumber(topFork.forks)} Forks（★ ${formatNumber(topFork.stars)} Stars），链接：${topFork.url}`;
    }

    // Total / summary stats query
    if (/总共|总和|合计|平均|统计|概况/.test(text)) {
      const totalStars = items.reduce((acc, it) => acc + it.stars, 0);
      const totalForks = items.reduce((acc, it) => acc + it.forks, 0);
      const langs = [...new Set(items.map((it) => it.language).filter(Boolean))];
      return `当前 GitHub Top 10 累计收获 ★ ${formatNumber(totalStars)} Stars、⑂ ${formatNumber(totalForks)} Forks；涵盖语言/分类：${langs.join("、")}。输入 /start 可在浏览器中查看可视化看板。`;
    }

    // Specific rank query (#1 .. #10)
    const rank = detectRankQuery(text);
    if (rank) {
      const repo = items.find((it) => it.rank === rank);
      if (repo) {
        const topics = repo.topics?.length ? ` | 标签: ${repo.topics.join(", ")}` : "";
        return `#${repo.rank} ${repo.fullName} — ★ ${formatNumber(repo.stars)} | ⑂ ${formatNumber(repo.forks)} | 语言: ${repo.language}${topics}\n   简介: ${repo.description}\n   直达: ${repo.url}`;
      }
    }

    // Language filter query
    const matchedByLang = items.filter(
      (it) =>
        it.language &&
        lower.includes(it.language.toLowerCase()) &&
        it.language.toLowerCase() !== "multi / docs"
    );
    if (matchedByLang.length > 0) {
      const summary = matchedByLang
        .map((it) => `#${it.rank} ${it.fullName} (★ ${formatNumber(it.stars)})`)
        .join("；");
      return `榜单中语言为 ${matchedByLang[0].language} 的项目共 ${matchedByLang.length} 个：${summary}。`;
    }

    // Keyword match against repo name, description, topics
    const tokens = lower
      .split(/[\s,，。？！?!、/]+/)
      .filter((tok) => tok.length >= 2);
    const matchedRepos = items.filter((it) => {
      const hay = `${it.fullName} ${it.description} ${(it.topics || []).join(" ")} ${it.language}`.toLowerCase();
      return (
        hay.includes(lower) ||
        tokens.some((tok) => tok.length >= 3 && hay.includes(tok))
      );
    });

    if (matchedRepos.length === 1) {
      const r = matchedRepos[0];
      return `找到匹配项目 #${r.rank} ${r.fullName}（★ ${formatNumber(r.stars)}，⑂ ${formatNumber(r.forks)}）：${r.description} | 链接：${r.url}`;
    }
    if (matchedRepos.length > 1) {
      const list = matchedRepos
        .slice(0, 4)
        .map((r) => `#${r.rank} ${r.fullName} (★ ${formatNumber(r.stars)})`)
        .join("；");
      return `在 Top 10 中找到 ${matchedRepos.length} 个相关项目：${list}。输入“第N名”可查看单条详情，或输入 /start 在本地网页浏览。`;
    }

    return `已收到你的消息：「${text}」。你可以问我“第1名是什么”、“Python/TypeScript 项目有哪些”、“Fork 最多的是哪个”，或者随时输入 /start 启动本地可视化网页！`;
  }

  function handleUserMessage(text, { origin = "cmd" } = {}) {
    const now = new Date().toISOString();
    const userMsg = {
      id: `${Date.now()}-u`,
      role: "user",
      origin,
      text,
      createdAt: now
    };
    const replyText = generateReply(text);
    const botMsg = {
      id: `${Date.now()}-a`,
      role: "assistant",
      origin: "system",
      text: replyText,
      createdAt: new Date().toISOString()
    };
    history.push(userMsg, botMsg);
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
    if (origin === "web") {
      onWebMessage?.({ userMsg, botMsg });
    }
    return { userMsg, botMsg, reply: replyText };
  }

  return {
    handleUserMessage,
    getHistory: () => [...history]
  };
}
