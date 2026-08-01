"use strict";

function sectionBody(markdown, heading) {
  const source = String(markdown || "");
  const marker = "## " + heading;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const next = source.indexOf("\n## ", bodyStart);
  return source.slice(bodyStart, next < 0 ? source.length : next);
}

function parseRateLimitedUpdates(markdown) {
  const section = sectionBody(markdown, "Rate-Limited");
  const updates = [];
  const pattern = /<!--\s*unlimit-branch=([^\s]+)\s*-->([^\n]+)/g;
  let match;
  while ((match = pattern.exec(section)) !== null) {
    updates.push({
      branchName: match[1].trim(),
      title: match[2].trim(),
    });
  }
  return updates;
}

function parseDetectedDependencies(markdown) {
  const section = sectionBody(markdown, "Detected Dependencies");
  const dependencies = [];
  const seen = new Set();

  for (const line of section.split("\n")) {
    const match = line.match(/^\s*-\s+`([^`]+)`(?:\s+→\s+\[Updates:\s+(.+?)\])?\s*$/);
    if (!match) continue;

    const value = match[1].trim();
    const splitAt = value.lastIndexOf(" ");
    if (splitAt <= 0) continue;

    const name = value.slice(0, splitAt).trim();
    const currentValue = value.slice(splitAt + 1).trim();
    const updates = [];
    const updatePattern = /`([^`]+)`/g;
    let updateMatch;
    while ((updateMatch = updatePattern.exec(match[2] || "")) !== null) {
      updates.push(updateMatch[1].trim());
    }

    const key = name + "\u0000" + currentValue + "\u0000" + updates.join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    dependencies.push({ name, currentValue, updates });
  }

  return dependencies;
}

function parseDependencyDashboard(markdown) {
  return {
    rateLimitedUpdates: parseRateLimitedUpdates(markdown),
    detectedDependencies: parseDetectedDependencies(markdown),
  };
}

module.exports = {
  parseDependencyDashboard,
};
