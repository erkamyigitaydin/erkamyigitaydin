// Rewrites the block between <!-- LIVE:START --> and <!-- LIVE:END --> in README.md
// with Damla's latest release and stats from the contribution calendar.
// Needs Node 18+ (built-in fetch) and a GITHUB_TOKEN. No dependencies.

import { readFile, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER || "erkamyigitaydin";
const RELEASE_REPO = process.env.RELEASE_REPO || `${USER}/Damla`;
const TOKEN = process.env.GITHUB_TOKEN;
const README = new URL("../README.md", import.meta.url);

if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "profile-readme-updater",
};

async function rest(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors ?? res.status)}`);
  return body.data;
}

const DAY = 86_400_000;
const today = new Date(new Date().toISOString().slice(0, 10)); // UTC midnight

function ago(iso) {
  const days = Math.round((today - new Date(iso.slice(0, 10))) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function stats(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const cutoff = new Date(today - 29 * DAY).toISOString().slice(0, 10);
  const last30 = sorted.filter((d) => d.date >= cutoff);

  let best = 0, run = 0;
  for (const d of sorted) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }

  // Current streak: count back from today; an empty today doesn't break it yet.
  let current = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = sorted[i];
    if (d.contributionCount > 0) current++;
    else if (i === sorted.length - 1) continue;
    else break;
  }

  const perWeekday = Array(7).fill(0);
  for (const d of sorted) perWeekday[d.weekday] += d.contributionCount;
  const top = perWeekday.indexOf(Math.max(...perWeekday));

  return {
    total30: last30.reduce((s, d) => s + d.contributionCount, 0),
    active30: last30.filter((d) => d.contributionCount > 0).length,
    current,
    best,
    favourite: perWeekday[top] > 0 ? WEEKDAYS[top] : null,
  };
}

const release = await rest(`/repos/${RELEASE_REPO}/releases/latest`);
const { user } = await graphql(
  `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks { contributionDays { date weekday contributionCount } }
        }
      }
    }
  }`,
  { login: USER },
);
const days = user.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
const s = stats(days);

const repoName = RELEASE_REPO.split("/")[1];
const rows = [
  `| 💧 **${repoName}** | [${release.tag_name}](${release.html_url}) shipped ${ago(release.published_at)} |`,
  `| 📈 **Last 30 days** | **${s.total30}** contributions across **${s.active30}** days |`,
  s.current > 1
    ? `| 🔥 **Streak** | **${s.current}** days running · best this year **${s.best}** |`
    : `| 🔥 **Best streak** | **${s.best}** days in a row this year |`,
];
if (s.favourite) rows.push(`| 📅 **Busiest day** | ${s.favourite} |`);

const block = ["<!-- LIVE:START -->", "| | |", "|---|---|", ...rows, "<!-- LIVE:END -->"].join("\n");

const readme = await readFile(README, "utf8");
const pattern = /<!-- LIVE:START -->[\s\S]*?<!-- LIVE:END -->/;
if (!pattern.test(readme)) throw new Error("LIVE markers not found in README.md");
const next = readme.replace(pattern, block);

if (next === readme) {
  console.log("README already up to date");
} else {
  await writeFile(README, next);
  console.log(block);
}
