#!/usr/bin/env node
import readline from "node:readline";
import process from "node:process";
import { fetchTop10Starred, getLatestSnapshot } from "./github.js";
import { createChatSession } from "./chat.js";
import { createWebServerController, openInBrowser } from "./server.js";

// Ensure UTF-8 I/O on Windows terminals
if (process.stdout.setDefaultEncoding) {
  process.stdout.setDefaultEncoding("utf8");
}
if (process.stdin.setEncoding) {
  process.stdin.setEncoding("utf8");
}
process.title = "GitHub Starred Top 10 - 实时抓取与常驻聊天终端";

const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const c = {
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  dim: useColor ? "\x1b[2m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  brightCyan: useColor ? "\x1b[96m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  brightYellow: useColor ? "\x1b[93m" : "",
  green: useColor ? "\x1b[32m" : "",
  brightGreen: useColor ? "\x1b[92m" : "",
  magenta: useColor ? "\x1b[35m" : "",
  blue: useColor ? "\x1b[34m" : "",
  gray: useColor ? "\x1b[90m" : "",
  red: useColor ? "\x1b[31m" : ""
};

function formatNum(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function formatTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
}

function truncateText(str, maxLen = 74) {
  const clean = String(str || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1) + "…";
}

function rankBadge(rank) {
  const numStr = String(rank).padStart(2, "0");
  if (rank === 1) return `${c.brightYellow}${c.bold}🥇 #${numStr}${c.reset}`;
  if (rank === 2) return `${c.brightCyan}${c.bold}🥈 #${numStr}${c.reset}`;
  if (rank === 3) return `${c.magenta}${c.bold}🥉 #${numStr}${c.reset}`;
  return `${c.cyan}${c.bold}   #${numStr}${c.reset}`;
}

function renderTop10ToCmd(snapshot) {
  const items = snapshot?.items || [];
  const divider = `${c.gray}${"─".repeat(78)}${c.reset}`;

  console.log("");
  console.log(
    `${c.brightCyan}${c.bold}╔════════════════════════════════════════════════════════════════════════════╗${c.reset}`
  );
  console.log(
    `${c.brightCyan}${c.bold}║         GitHub.com 实时全站 Starred 前 10 开源项目排行榜 (LIVE)            ║${c.reset}`
  );
  console.log(
    `${c.brightCyan}${c.bold}╚════════════════════════════════════════════════════════════════════════════╝${c.reset}`
  );
  console.log(
    `  ${c.gray}数据源:${c.reset} ${c.green}${snapshot.sourceLabel || snapshot.source}${c.reset}   ${c.gray}抓取时间:${c.reset} ${formatTime(snapshot.fetchedAt)}`
  );
  if (snapshot.warning) {
    console.log(`  ${c.yellow}提示: ${snapshot.warning}${c.reset}`);
  }
  console.log(divider);

  for (const item of items) {
    const stars = `${c.brightYellow}★ ${formatNum(item.stars).padStart(7, " ")}${c.reset}`;
    const forks = `${c.gray}⑂ ${formatNum(item.forks)}${c.reset}`;
    const lang = `${c.blue}[${item.language || "Docs"}]${c.reset}`;

    console.log(
      `${rankBadge(item.rank)}  ${c.bold}${c.brightGreen}${item.fullName}${c.reset}  ${stars}  ${forks}  ${lang}`
    );
    console.log(`        ${c.dim}${truncateText(item.description, 70)}${c.reset}`);
    console.log(`        ${c.cyan}${item.url}${c.reset}`);
  }

  const totalStars = items.reduce((sum, it) => sum + (it.stars || 0), 0);
  console.log(divider);
  console.log(
    `  ${c.bold}Top 10 总计 Star:${c.reset} ${c.brightYellow}★ ${formatNum(totalStars)}${c.reset}   ${c.gray}| 输入 ${c.brightGreen}/start${c.gray} 启动并打开本地可视化网页${c.reset}`
  );
  console.log("");
}

function printChatBanner() {
  console.log(
    `${c.cyan}${c.bold}┌────────────────────────── 常驻交互聊天终端已就绪 ──────────────────────────┐${c.reset}`
  );
  console.log(
    `${c.cyan}│${c.reset}  • 输入 ${c.brightGreen}${c.bold}/start${c.reset}    启动本地网站并在浏览器打开（点击项目名新开标签页直达）   ${c.cyan}│${c.reset}`
  );
  console.log(
    `${c.cyan}│${c.reset}  • 输入 ${c.brightCyan}/refresh${c.reset}  立即重新从 GitHub.com 实时抓取最新前 10 数据            ${c.cyan}│${c.reset}`
  );
  console.log(
    `${c.cyan}│${c.reset}  • 输入 ${c.brightCyan}/list${c.reset}     在 CMD 重新打印前 10 排行榜   | ${c.brightCyan}/open 1~10${c.reset} 打开指定仓库  ${c.cyan}│${c.reset}`
  );
  console.log(
    `${c.cyan}│${c.reset}  • 输入 ${c.brightCyan}/help${c.reset}     查看全部指令                  | ${c.brightCyan}/exit${c.reset} 退出程序           ${c.cyan}│${c.reset}`
  );
  console.log(
    `${c.cyan}│${c.reset}  • 直接输入任意文字即可在下方常驻聊天框对话或查询榜单项目详情              ${c.cyan}│${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bold}└────────────────────────────────────────────────────────────────────────────┘${c.reset}`
  );
}

function printHelp(webStatus) {
  console.log(`\n${c.bold}可用指令列表：${c.reset}`);
  console.log(`  ${c.brightGreen}/start${c.reset}         启动本地展示网站并自动打开浏览器（点击项目名称新标签页打开链接）`);
  console.log(`  ${c.brightCyan}/refresh${c.reset}       重新实时抓取 GitHub.com Starred 前 10 项目并刷新终端与网页`);
  console.log(`  ${c.brightCyan}/list${c.reset}          在终端重新输出当前 GitHub Starred 前 10 榜单`);
  console.log(`  ${c.brightCyan}/open <1-10>${c.reset}   直接在浏览器打开第 N 名 GitHub 项目主页`);
  console.log(`  ${c.brightCyan}/status${c.reset}        查看当前本地网页服务与数据抓取状态`);
  console.log(`  ${c.brightCyan}/clear${c.reset}         清空终端屏幕并保留常驻聊天框`);
  console.log(`  ${c.brightCyan}/exit${c.reset}          关闭本地服务并退出程序`);
  if (webStatus.running) {
    console.log(`  ${c.green}当前本地网站运行中: ${webStatus.url}${c.reset}`);
  }
  console.log("");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const onceMode = args.has("--once");
  const serveOnlyMode = args.has("--serve");
  const autoStartWeb = args.has("--autostart") || serveOnlyMode;

  let rl = null;
  const reprompt = () => {
    if (rl) rl.prompt(true);
  };

  const chatSession = createChatSession({
    onWebMessage: ({ userMsg, botMsg }) => {
      process.stdout.write("\r\x1b[K");
      console.log(`${c.magenta}[网页消息]${c.reset} ${userMsg.text}`);
      console.log(`${c.brightCyan}🤖 助手 >${c.reset} ${botMsg.text}\n`);
      reprompt();
    }
  });

  const webController = createWebServerController({
    chatSession,
    onSnapshotUpdate: (snap) => {
      process.stdout.write("\r\x1b[K");
      console.log(
        `${c.green}↻ 网页端触发了 GitHub 实时刷新（抓取时间: ${formatTime(snap.fetchedAt)}）${c.reset}`
      );
      reprompt();
    }
  });

  console.log(`${c.cyan}⏳ 正在从 GitHub.com 实时抓取 Starred 前 10 项目数据...${c.reset}`);

  try {
    const initialSnapshot = await fetchTop10Starred({ force: true });
    renderTop10ToCmd(initialSnapshot);
  } catch (err) {
    console.error(`${c.red}✖ 初始实时抓取失败: ${err.message}${c.reset}`);
    console.log(`${c.yellow}提示: 稍后可在聊天框输入 /refresh 重试。${c.reset}\n`);
  }

  if (onceMode) {
    return;
  }

  if (autoStartWeb) {
    const info = await webController.start({ autoOpen: !serveOnlyMode });
    console.log(`${c.brightGreen}🚀 本地网站已启动: ${info.url}${c.reset}\n`);
  }

  if (serveOnlyMode) {
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await webController.stop();
    return;
  }

  printChatBanner();

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.brightGreen}${c.bold}💬 聊天/指令 > ${c.reset}`,
    terminal: Boolean(process.stdin.isTTY)
  });

  let shuttingDown = false;
  async function gracefulShutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${c.gray}正在关闭服务并退出...${c.reset}`);
    rl?.close();
    process.stdin.pause();
    await webController.stop();
  }

  rl.on("SIGINT", () => {
    gracefulShutdown();
  });

  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) {
      rl.prompt();
      continue;
    }

    if (line.startsWith("/")) {
      const [cmdRaw, ...rest] = line.split(/\s+/);
      const cmd = cmdRaw.toLowerCase();

      if (cmd === "/start") {
        try {
          if (!getLatestSnapshot()) {
            console.log(`${c.cyan}⏳ 正在同步 GitHub 实时榜单数据...${c.reset}`);
            await fetchTop10Starred({ force: true });
          }
          const info = await webController.start({ autoOpen: true });
          if (info.alreadyRunning) {
            console.log(
              `${c.brightGreen}🌐 本地网站已在运行，已为你重新在浏览器打开: ${c.bold}${info.url}${c.reset}`
            );
          } else {
            console.log(
              `${c.brightGreen}🚀 本地网站启动成功并已在浏览器打开: ${c.bold}${info.url}${c.reset}`
            );
            console.log(
              `${c.gray}   说明: 页面展示实时 GitHub Starred 前 10 项目，点击项目名字将在新标签页直达仓库链接。${c.reset}`
            );
          }
        } catch (err) {
          console.error(`${c.red}✖ 启动本地网站失败: ${err.message}${c.reset}`);
        }
        console.log("");
        rl.prompt();
        continue;
      }

      if (cmd === "/refresh" || cmd === "/r") {
        console.log(`${c.cyan}⏳ 正在从 GitHub.com 重新实时抓取 Starred 前 10 项目...${c.reset}`);
        try {
          const snap = await fetchTop10Starred({ force: true });
          renderTop10ToCmd(snap);
          webController.broadcastEvent("top10", snap);
        } catch (err) {
          console.error(`${c.red}✖ 刷新失败: ${err.message}${c.reset}\n`);
        }
        rl.prompt();
        continue;
      }

      if (cmd === "/list" || cmd === "/top" || cmd === "/top10") {
        const snap = getLatestSnapshot();
        if (snap) {
          renderTop10ToCmd(snap);
        } else {
          console.log(`${c.yellow}暂无缓存数据，正在为你实时抓取...${c.reset}`);
          const fresh = await fetchTop10Starred({ force: true });
          renderTop10ToCmd(fresh);
        }
        rl.prompt();
        continue;
      }

      if (cmd === "/open") {
        const idx = Number(rest[0]);
        const snap = getLatestSnapshot();
        if (!Number.isInteger(idx) || idx < 1 || idx > 10) {
          console.log(`${c.yellow}用法: /open <1-10>，例如 /open 1 打开第 1 名项目${c.reset}\n`);
        } else if (!snap?.items?.[idx - 1]) {
          console.log(`${c.yellow}当前尚未获取到第 ${idx} 名数据，请先 /refresh${c.reset}\n`);
        } else {
          const target = snap.items[idx - 1];
          await openInBrowser(target.url);
          console.log(`${c.brightGreen}↗ 已在浏览器打开 #${idx} ${target.fullName}: ${target.url}${c.reset}\n`);
        }
        rl.prompt();
        continue;
      }

      if (cmd === "/status") {
        const st = webController.getStatus();
        const snap = getLatestSnapshot();
        console.log(
          `\n${c.bold}系统状态:${c.reset}\n` +
            `  本地网站: ${st.running ? `${c.brightGreen}运行中 (${st.url})${c.reset}` : `${c.gray}未启动（输入 /start 启动）${c.reset}`}\n` +
            `  榜单缓存: ${snap ? `${snap.items.length} 条（抓取于 ${formatTime(snap.fetchedAt)}，源: ${snap.source}）` : "未抓取"}\n` +
            `  聊天记录: ${chatSession.getHistory().length} 条消息\n`
        );
        rl.prompt();
        continue;
      }

      if (cmd === "/clear" || cmd === "/cls") {
        console.clear();
        printChatBanner();
        rl.prompt();
        continue;
      }

      if (cmd === "/help" || cmd === "/h" || cmd === "/?") {
        printHelp(webController.getStatus());
        rl.prompt();
        continue;
      }

      if (cmd === "/exit" || cmd === "/quit" || cmd === "/q") {
        await gracefulShutdown();
        break;
      }

      console.log(
        `${c.yellow}未知指令 "${cmdRaw}"。可用指令: /start, /refresh, /list, /open <1-10>, /status, /clear, /help, /exit${c.reset}\n`
      );
      rl.prompt();
      continue;
    }

    // Persistent interactive chat message handling
    const entry = chatSession.handleUserMessage(line, { origin: "cmd" });
    const { botMsg } = entry;
    webController.broadcastEvent("chat", { ...entry, messages: chatSession.getHistory() });
    console.log(`${c.brightCyan}🤖 助手 >${c.reset} ${botMsg.text}\n`);
    rl.prompt();
  }

  // Keep server alive Only if interactive session wasn't closed; if stdin EOF reached, clean up
  await webController.stop();
}

main().catch((err) => {
  console.error("程序发生异常:", err);
  process.exit(1);
});
