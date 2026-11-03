/**
 * robots.txt: just enough of RFC 9309 to answer "may this crawler fetch this
 * path". We implement the rules a site owner actually relies on: user-agent
 * groups, Disallow/Allow, `*` wildcards, `$` end anchors, longest match wins,
 * Allow wins a tie, no match means allowed, unreachable file means allowed.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
  /** Source line, for reporting which rule decided it. */
  source: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

export interface RobotsDecision {
  allowed: boolean;
  rule: string | null;
}

export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  /** Agents can only be listed before the first rule of a group. */
  let acceptingAgents = true;

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !acceptingAgents) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
        acceptingAgents = true;
      }
      if (value) current.agents.push(value.toLowerCase());
      continue;
    }

    if (!current) continue;
    acceptingAgents = false;

    if (field === "allow" || field === "disallow") {
      // An empty Disallow means "allow everything", i.e. no rule.
      if (field === "disallow" && value === "") continue;
      current.rules.push({
        allow: field === "allow",
        pattern: value,
        source: `${field === "allow" ? "Allow" : "Disallow"}: ${value}`,
      });
      continue;
    }

    if (field === "crawl-delay") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed >= 0) current.crawlDelay = parsed;
    }
  }

  return groups.filter((g) => g.agents.length > 0);
}

interface CompiledPattern {
  re: RegExp;
  /** Specificity: characters that are not wildcards. */
  weight: number;
}

function compile(pattern: string): CompiledPattern {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern) || "/";
  let source = "";
  let weight = 0;
  for (const ch of body) {
    if (ch === "*") {
      source += ".*";
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      weight += 1;
    }
  }
  return { re: new RegExp(`^${source}${anchored ? "$" : ""}`), weight };
}

/** Pick the groups that apply to a robots token (exact match beats `*`). */
function applicableGroups(groups: RobotsGroup[], token: string): RobotsGroup[] {
  const needle = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && needle.startsWith(a)));
  if (specific.length > 0) return specific;
  return groups.filter((g) => g.agents.includes("*"));
}

export function isAllowed(
  groups: RobotsGroup[],
  pathWithQuery: string,
  token: string,
): RobotsDecision {
  const applicable = applicableGroups(groups, token);
  if (applicable.length === 0) return { allowed: true, rule: null };

  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  let best: { rule: RobotsRule; weight: number } | null = null;

  for (const group of applicable) {
    for (const rule of group.rules) {
      const { re, weight } = compile(rule.pattern);
      if (!re.test(path)) continue;
      if (!best) {
        best = { rule, weight };
        continue;
      }
      if (weight > best.weight) {
        best = { rule, weight };
      } else if (weight === best.weight && rule.allow && !best.rule.allow) {
        // Longest match wins; on an equal-length tie Allow wins.
        best = { rule, weight };
      }
    }
  }

  if (!best) return { allowed: true, rule: null };
  return { allowed: best.rule.allow, rule: best.rule.source };
}

export function pathWithQueryOf(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.pathname}${u.search}`;
  } catch {
    return rawUrl;
  }
}
