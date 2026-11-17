#!/usr/bin/env python3
"""Build the sourced catalog alongside the hand-curated sector files.

Only factual metadata and reader genre labels are used. The source's
synopses and reviews are deliberately excluded.
"""

import argparse
import ast
import csv
import hashlib
import io
import json
import re
import subprocess
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
SOURCE_COMMIT = "b7722711a91ed8f0fd78be8971d252afc5528d05"
SOURCE_URL = (
    "https://raw.githubusercontent.com/ferdesmello/sci-fi-novels-evolution/"
    + SOURCE_COMMIT + "/data/filtered/sci-fi_novels_FILTERED.csv"
)
SOURCE_SHA256 = "85bd757fe41bd6ea096ecd2062f575adff061449ddbba6743444b69ea4c9af06"

# Use only a prominent source genre (one of its first five) to choose a sector.
# This keeps a broad "science fiction" shelf from assigning a false theme.
SECTOR_FOR_GENRE = {
    "Space Opera": "opera",
    "Military Science Fiction": "military",
    "Military Fiction": "military",
    "Aliens": "contact",
    "Hard Science Fiction": "hard",
    "Climate Change Fiction": "eco",
    "Climate Change": "eco",
    "Environment": "eco",
    "Ecology": "eco",
    "Post Apocalyptic": "apoc",
    "Apocalyptic": "apoc",
    "Dystopia": "dystopia",
    "Utopia": "utopia",
    "LGBT": "identity",
    "Queer": "identity",
    "Feminism": "identity",
    "Gender": "identity",
    "Transgender": "identity",
    "Evolution": "posthuman",
    "Genetics": "posthuman",
    "Cyberpunk": "cyber",
    "Virtual Reality": "cyber",
    "Artificial Intelligence": "ai",
    "Robots": "ai",
    "Time Travel": "time",
    "Alternate History": "time",
    "Satire": "satire",
}
GENERIC_GENRES = {
    "Science Fiction", "Fiction", "Fantasy", "Science Fiction Fantasy",
    "Audiobook", "Novels", "Speculative Fiction", "Books", "Adult",
}


def key(text):
    text = unicodedata.normalize("NFKD", text).casefold()
    return "".join(c for c in text if c.isalnum())


def curated_keys():
    code = r"""
const fs = require('fs'), vm = require('vm');
const c = vm.createContext({window: {}, SFMAP: undefined});
vm.runInContext(fs.readFileSync('data/meta.js', 'utf8'), c);
c.SFMAP = c.window.SFMAP;
for (const file of fs.readdirSync('data/sectors').sort()) {
  if (file.startsWith('catalog-') || !file.endsWith('.js')) continue;
  vm.runInContext(fs.readFileSync('data/sectors/' + file, 'utf8'), c);
}
process.stdout.write(JSON.stringify(c.SFMAP.works.map(w => [w.title, w.author])));
"""
    result = subprocess.run(
        ["node", "-e", code], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return {(key(title), key(author)) for title, author in json.loads(result.stdout)}


def read_source(path):
    if path:
        raw = path.read_bytes()
    else:
        request = Request(SOURCE_URL, headers={"User-Agent": "scifi-map-catalog-import/1.0"})
        with urlopen(request, timeout=60) as response:
            raw = response.read()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError("Source checksum mismatch: " + digest)
    return csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""), delimiter=";")


def build_records(rows):
    seen = curated_keys()
    seen_ids = set()
    sectors = {sector: [] for sector in set(SECTOR_FOR_GENRE.values())}
    skipped = Counter()
    for row in rows:
        title, author = row["title"].strip(), row["author"].strip()
        try:
            year = int(row["year"])
            genres = ast.literal_eval(row["genres"])
        except (TypeError, ValueError, SyntaxError):
            skipped["invalid metadata"] += 1
            continue
        if not title or not author or not 1 <= year <= date.today().year or not isinstance(genres, list):
            skipped["invalid metadata"] += 1
            continue
        if "Science Fiction" not in genres:
            skipped["not science fiction"] += 1
            continue
        sector = next((SECTOR_FOR_GENRE[g] for g in genres[:5] if g in SECTOR_FOR_GENRE), None)
        if not sector:
            skipped["no prominent sector tag"] += 1
            continue
        match = re.fullmatch(r"https://www\.goodreads\.com/book/show/(\d+)(?:[./?#-].*)?", row["url"])
        if not match:
            skipped["invalid source ID"] += 1
            continue
        source_id = int(match.group(1))
        work_key = key(title), key(author)
        if work_key in seen or source_id in seen_ids:
            skipped["duplicate or curated"] += 1
            continue
        seen.add(work_key)
        seen_ids.add(source_id)
        tags = list(dict.fromkeys(g for g in genres if g not in GENERIC_GENRES))[:3]
        record = {
            "id": "catalog-" + str(source_id),
            "title": title,
            "author": author,
            "year": year,
            "tags": tags,
            "blurb": "Catalogued as science fiction; reader tags: " + ", ".join(tags) + ".",
            "sourceId": source_id,
        }
        sectors[sector].append(record)
    for records in sectors.values():
        records.sort(key=lambda w: (w["year"], w["title"].casefold(), w["id"]))
    return sectors, skipped


def write_files(sectors, directory):
    directory.mkdir(parents=True, exist_ok=True)
    for sector, records in sorted(sectors.items()):
        path = directory / ("catalog-" + sector + ".js")
        body = [
            "// Generated by scripts/import-catalog.py from the pinned SF novels dataset.",
            "// Reader genre labels are used for sectors and blurbs; no source prose is copied.",
            "SFMAP.addWorks('" + sector + "', [",
        ]
        body += ["  " + json.dumps(w, ensure_ascii=False) + "," for w in records]
        body += ["]);", ""]
        path.write_text("\n".join(body), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="local copy of the pinned source CSV")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/sectors")
    args = parser.parse_args()
    sectors, skipped = build_records(read_source(args.source))
    write_files(sectors, args.output_dir)
    print("Imported", sum(map(len, sectors.values())), "works:",
          ", ".join(f"{s} {len(v)}" for s, v in sorted(sectors.items())))
    print("Skipped:", dict(skipped))


if __name__ == "__main__":
    main()
