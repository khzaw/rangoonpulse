#!/usr/bin/env python3
"""Fetch SP's electricity tariff and render time-gated Prometheus constants."""

import argparse
import calendar
import json
import os
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

SOURCE = "https://www.spgroup.com.sg/our-services/utilities/tariff-information"
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "infrastructure/monitoring/power-tariffs.json"
RULES = ROOT / "infrastructure/monitoring/prometheusrule-power-estimation.yaml"
START = "        # BEGIN GENERATED TARIFFS\n"
END = "        # END GENERATED TARIFFS\n"
SG = ZoneInfo("Asia/Singapore")


class VisibleText(HTMLParser):
    """Exclude Next.js payloads, scripts, and styling from source parsing."""

    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def quarter_end(start: date) -> date:
    month = start.month + 2
    return date(start.year, month, calendar.monthrange(start.year, month)[1])


def validate(entry: dict) -> None:
    start = date.fromisoformat(entry["start"])
    end = date.fromisoformat(entry["end"])
    rate = Decimal(entry["sgd_per_kwh"])
    if start.day != 1 or start.month not in {1, 4, 7, 10} or end != quarter_end(start):
        raise ValueError("Tariff must cover exactly one calendar quarter")
    if not Decimal("0.10") <= rate <= Decimal("0.80") or rate.as_tuple().exponent < -4:
        raise ValueError("Implausible SGD/kWh rate or precision")
    if entry["source"] != SOURCE:
        raise ValueError("Tariff source must be the official SP page")


def parse_tariff(html: str) -> dict:
    parser = VisibleText()
    parser.feed(html)
    text = " ".join(" ".join(parser.parts).split())
    pattern = (
        r"(?<![\d.])(?P<gross>\d+\.\d{2}) cents/kWh\s+"
        r"(?P<net>\d+\.\d{2}) cents/kWh \(w/o GST\)\s+"
        r"ELECTRICITY TARIFF\s+\(wef (?P<day>\d{1,2}) (?P<month>[A-Z][a-z]{2})"
        r" - (?P<end_day>\d{1,2}) (?P<end_month>[A-Z][a-z]{2}) (?P<year>\d{2})\)"
    )
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        raise ValueError("Expected exactly one GST-inclusive ELECTRICITY TARIFF with effective dates")
    fields = matches[0].groupdict()
    start = datetime.strptime(f"{fields['day']} {fields['month']} 20{fields['year']}", "%d %b %Y").date()
    end = datetime.strptime(f"{fields['end_day']} {fields['end_month']} 20{fields['year']}", "%d %b %Y").date()
    heading = f"Q{(start.month - 1) // 3 + 1} {start.year} Electricity Tariff (before GST)"
    if heading not in text:
        raise ValueError("Quarter heading and effective dates disagree")
    # SP currently publishes 9% GST, rounded to two decimal cents.
    gross, net = Decimal(fields["gross"]), Decimal(fields["net"])
    if abs(gross - net * Decimal("1.09")) > Decimal("0.011"):
        raise ValueError("GST cross-check failed; review source or tax changes manually")
    entry = {"start": start.isoformat(), "end": end.isoformat(),
             "sgd_per_kwh": str(gross / 100), "source": SOURCE}
    validate(entry)
    return entry


def merge_tariff(entries: list[dict], incoming: dict, today: date) -> tuple[list[dict], bool]:
    """Never silently rewrite history; large changes remain review-only."""
    validate(incoming)
    start, end = date.fromisoformat(incoming["start"]), date.fromisoformat(incoming["end"])
    if end < today or start > today + timedelta(days=100):
        raise ValueError("Publication is stale or implausibly far in the future")
    for existing in entries:
        validate(existing)
        if existing["start"] == incoming["start"]:
            if existing != incoming:
                raise ValueError("Published rate changed for a known quarter; manual review required")
            return entries, False
    previous = entries[-1]
    if start != date.fromisoformat(previous["end"]) + timedelta(days=1):
        raise ValueError("Missing quarter or out-of-order publication; manual review required")
    change = abs(Decimal(incoming["sgd_per_kwh"]) / Decimal(previous["sgd_per_kwh"]) - 1)
    return entries + [incoming], change <= Decimal("0.15")


def epoch(day: str) -> int:
    return int(datetime.combine(date.fromisoformat(day), datetime.min.time(), SG).timestamp())


def render(entries: list[dict]) -> str:
    if not entries:
        raise ValueError("No tariffs configured")
    for i, entry in enumerate(entries):
        validate(entry)
        if i and date.fromisoformat(entry["start"]) != date.fromisoformat(entries[i - 1]["end"]) + timedelta(days=1):
            raise ValueError("Tariff history must contain consecutive quarters")
    lines = [START.rstrip(), "        # SGD/kWh, GST inclusive; Singapore midnight boundaries. See power-tariffs.json."]
    metrics = {
        "homelab:singapore_household_tariff_sgd_per_kwh": lambda e: e["sgd_per_kwh"],
        "homelab:singapore_household_tariff_valid_until_seconds": lambda e: str(epoch((date.fromisoformat(e["end"]) + timedelta(days=1)).isoformat())),
    }
    for metric, value in metrics.items():
        lines.extend([f"        - record: {metric}", "          expr: >"])
        for i, entry in enumerate(entries):
            gate = f"(vector({value(entry)}) and on() (vector(time()) >= {epoch(entry['start'])}))"
            if i + 1 < len(entries):
                gate = f"({gate} and on() (vector(time()) < {epoch(entries[i + 1]['start'])}))"
            lines.append(f"            {'or ' if i else ''}{gate}")
    lines.append(END.rstrip())
    return "\n".join(lines) + "\n"


def update_rules(entries: list[dict], content: str) -> str:
    if content.count(START) != 1 or content.count(END) != 1:
        raise ValueError("Missing or duplicate generated tariff markers")
    before, remaining = content.split(START)
    _, after = remaining.split(END)
    return before + render(entries) + after


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check generated files without network access")
    parser.add_argument("--render", action="store_true", help="Render the existing tariff history without fetching")
    args = parser.parse_args()
    entries = json.loads(DATA.read_text())
    safe = False
    if not args.check and not args.render:
        request = Request(SOURCE, headers={"User-Agent": "rangoonpulse-tariff-check/1.0"})
        with urlopen(request, timeout=30) as response:
            if response.url != SOURCE:
                raise ValueError("Unexpected source redirect")
            html = response.read(2_000_001)
            if len(html) > 2_000_000:
                raise ValueError("Source exceeded size limit")
        entries, safe = merge_tariff(entries, parse_tariff(html.decode()), datetime.now(SG).date())
    old = RULES.read_text()
    new = update_rules(entries, old)
    if args.check:
        if new != old:
            raise ValueError("Generated tariff rules are out of date")
        return
    DATA.write_text(json.dumps(entries, indent=2) + "\n")
    RULES.write_text(new)
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a") as stream:
            stream.write(f"safe_to_merge={str(safe).lower()}\n")
    print(f"Verified tariff: {entries[-1]['sgd_per_kwh']} SGD/kWh, {entries[-1]['start']} through {entries[-1]['end']}")


if __name__ == "__main__":
    main()
