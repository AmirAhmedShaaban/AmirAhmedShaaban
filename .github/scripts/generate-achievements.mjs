/**
 * Generate achievement badge SVGs and stats.json from GitHub profile data.
 *
 * Uses the real GitHub REST/GraphQL API (via GITHUB_TOKEN) to fetch:
 *  - followers, public repos, account age
 *  - PRs merged, issues closed, total contributions
 *  - profile views from komarev.com
 *
 * Outputs:
 *  - assets/achievements.svg   → visual achievement card sheet
 *  - assets/stats.json         → JSON for shields.io endpoint badges
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERNAME =
  process.env.GITHUB_REPOSITORY?.split("/")[0] || "AmirAhmedShaaban";
const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO_ROOT = path.resolve(__dirname, "../../");
const SVG_FILE = path.join(REPO_ROOT, "assets/achievements.svg");
const JSON_FILE = path.join(REPO_ROOT, "assets/stats.json");

// ── Helpers ────────────────────────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        "User-Agent": "achievement-bot/1.0",
        Accept: "application/vnd.github.v3+json",
      },
    };
    if (TOKEN) opts.headers.Authorization = `Bearer ${TOKEN}`;
    https
      .get(url, opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(res.statusCode >= 400 ? null : JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      })
      .on("error", reject);
  });
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const opts = {
      method: "POST",
      headers: {
        "User-Agent": "achievement-bot/1.0",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };
    if (TOKEN) opts.headers.Authorization = `Bearer ${TOKEN}`;
    const req = https.request(url, opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(res.statusCode >= 400 ? null : JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** Fetch text content from a URL (for scraping SVG numbers) */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "achievement-bot/1.0" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

// ── SVG rendering ──────────────────────────────────────────────

function cardSVG(x, y, ach) {
  const w = 164,
    h = 176;
  return `
  <g transform="translate(${x},${y})">
    <rect x="0" y="0" width="${w}" height="${h}" rx="14" fill="${ach.bg}" stroke="#30363d" stroke-width="1"/>
    <text x="${w / 2}" y="50" font-size="42" text-anchor="middle" dominant-baseline="central">${ach.emoji}</text>
    <text x="${w / 2}" y="100" font-size="13" font-weight="700" fill="${ach.color}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif">${ach.name}</text>
    <rect x="${(w - 60) / 2}" y="112" width="60" height="18" rx="9" fill="${ach.color}" opacity="0.15"/>
    <text x="${w / 2}" y="121" font-size="10" font-weight="600" fill="${ach.color}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif">${ach.tier}</text>
    <text x="${w / 2}" y="148" font-size="10" fill="#8b949e" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif">${ach.desc}</text>
  </g>`;
}

function generateSVG(cards) {
  const cols = Math.min(cards.length, 6);
  const rows = Math.ceil(cards.length / cols);
  const cw = 176,
    ch = 188,
    pw = 72,
    ph = 48;
  const W = cols * cw + pw * 2;
  const H = rows * ch + ph * 2 + 60;

  const cardsHTML = cards
    .map((ach, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return cardSVG(pw + col * cw, ph + 60 + row * ch, ach);
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
    <linearGradient id="title" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#22c55e"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="100%" height="100%" fill="url(#bg)" rx="20"/>
  <text x="${W / 2}" y="36" font-size="22" font-weight="700" fill="url(#title)" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif">🏆 GitHub Achievements</text>
  ${cardsHTML}
</svg>`;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  // 1. Fetch REST API profile data
  const profile = await fetchJSON(`https://api.github.com/users/${USERNAME}`);
  const repos = profile?.public_repos ?? 0;
  const followers = profile?.followers ?? 0;
  const created = profile?.created_at ?? null;
  const yearsActive = created
    ? Math.max(1, new Date().getFullYear() - new Date(created).getFullYear())
    : 1;

  // 2. Fetch GraphQL contribution data
  let totalCommits = 0;
  let prsMerged = 0;
  let issuesClosed = 0;

  if (TOKEN) {
    const query = JSON.stringify({
      query: `
        query {
          user(login: "${USERNAME}") {
            contributionsCollection {
              contributionCalendar { totalContributions }
            }
            pullRequests(states: MERGED) { totalCount }
            issues(states: CLOSED) { totalCount }
          }
        }`,
    });
    try {
      const gqlResp = await postJSON("https://api.github.com/graphql", query);
      const u = gqlResp?.data?.user;
      if (u) {
        totalCommits =
          u.contributionsCollection?.contributionCalendar?.totalContributions ??
          0;
        prsMerged = u.pullRequests?.totalCount ?? 0;
        issuesClosed = u.issues?.totalCount ?? 0;
      }
    } catch {
      /* ignore gql errors */
    }
  }

  // 3. Fetch profile views from komarev.com (parse SVG <text> elements)
  let profileViews = 0;
  try {
    const svgText = await fetchText(
      `https://komarev.com/ghpvc/?username=${USERNAME}`,
    );
    // komarev SVG has: <text ...>Profile views</text> then <text ...>65</text>
    // Extract the last <text> element that contains only digits
    const textMatches = svgText.match(/<text[^>]*>(\d+)<\/text>/g);
    if (textMatches) {
      const nums = textMatches.map((m) => {
        const n = m.match(/>(\d+)</);
        return n ? Number(n[1]) : 0;
      });
      profileViews = nums.length > 0 ? nums[nums.length - 1] : 0;
    }
  } catch {
    /* ignore — views will show 0 until komarev responds */
  }

  // 4. Build achievement cards from real data
  const cards = [];

  if (yearsActive >= 1) {
    cards.push({
      emoji: "🏅",
      name: "Core Contributor",
      tier:
        yearsActive >= 3 ? "Tier 3" : yearsActive >= 2 ? "Tier 2" : "Tier 1",
      desc: `${yearsActive} year${yearsActive > 1 ? "s" : ""} active`,
      color: "#0ea5e9",
      bg: "#0ea5e910",
    });
  }

  if (prsMerged > 0 || repos > 5) {
    const tier = prsMerged >= 50 ? 3 : prsMerged >= 16 ? 2 : 1;
    cards.push({
      emoji: "🦈",
      name: "Pull Shark",
      tier: `Tier ${tier}`,
      desc: `${prsMerged} PR${prsMerged !== 1 ? "s" : ""} merged`,
      color: "#22c55e",
      bg: "#22c55e10",
    });
  }

  if (issuesClosed > 0 || repos > 2) {
    const tier = issuesClosed >= 25 ? 3 : issuesClosed >= 8 ? 2 : 1;
    cards.push({
      emoji: "⚡",
      name: "Quickdraw",
      tier: `Tier ${tier}`,
      desc: `${issuesClosed} issue${issuesClosed !== 1 ? "s" : ""} closed`,
      color: "#ff6b6b",
      bg: "#ff6b6b10",
    });
  }

  cards.push({
    emoji: "🤘",
    name: "YOLO",
    tier: "Tier 1",
    desc: "Direct commits to main",
    color: "#a855f7",
    bg: "#a855f710",
  });

  if (followers > 0) {
    const tier = followers >= 100 ? 3 : followers >= 25 ? 2 : 1;
    cards.push({
      emoji: "⭐",
      name: "Starstruck",
      tier: `Tier ${tier}`,
      desc: `${followers} follower${followers !== 1 ? "s" : ""}`,
      color: "#f59e0b",
      bg: "#f59e0b10",
    });
  }

  if (totalCommits > 50) {
    cards.push({
      emoji: "🧠",
      name: "Galaxy Brain",
      tier:
        totalCommits >= 500
          ? "Tier 3"
          : totalCommits >= 200
            ? "Tier 2"
            : "Tier 1",
      desc: `${totalCommits} contributions`,
      color: "#06b6d4",
      bg: "#06b6d410",
    });
  }

  // 5. Write achievements SVG
  fs.mkdirSync(path.dirname(SVG_FILE), { recursive: true });
  fs.writeFileSync(SVG_FILE, generateSVG(cards), "utf-8");
  console.log(`✅ Wrote ${cards.length} achievement cards → ${SVG_FILE}`);

  // 6. Write stats.json for shields.io endpoint badges
  const stats = {
    followers,
    profileViews,
    publicRepos: repos,
    totalCommits,
    prsMerged,
    issuesClosed,
    yearsActive,
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(JSON_FILE, JSON.stringify(stats, null, 2), "utf-8");
  console.log(`✅ Wrote stats.json → ${JSON_FILE}`);
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
