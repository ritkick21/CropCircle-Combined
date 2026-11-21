"""Build compact, reproducible demo training snapshots from public datasets."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
from urllib.parse import urlparse
from urllib.request import urlopen

import pandas as pd

from cropcircle_ml.vision import image_features

ROOT = Path(__file__).resolve().parents[2]
USDA = "https://www.ers.usda.gov/media/7009/all-fruit-and-tree-nuts-yearbook-data.csv?v=61543"
NOAA = "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/national/time-series/110"
TEXT = "https://huggingface.co/datasets/ixrbhii/crop-disease-qa/resolve/main/data/qa.jsonl"
PHOTO = "https://huggingface.co/datasets/kirutheen/Crop_Disease_Images/resolve/main/annotations.csv"
TABLES = {"Apples": "B-3", "Grapes": "B-12", "Peaches": "B-21", "Pears": "B-24"}
FRESH = {"Apples": "G-1", "Grapes": "G-6", "Pears": "G-11"}
NUTRIENT = re.compile(r"deficien|nutri(?:ent|tion)|chlorosis", re.I)
PEST = re.compile(r"borer|worm|thrips|mite|aphid|leaf ?miner|whitefl|fly|beetle|hopper|bug|weevil|insect|moth|caterpillar|mealybug", re.I)
DISEASE = re.compile(r"blight|rot|wilt|mildew|virus|fung|bacter|disease|scab|rust|spot|anthracnose|canker|smut|mosaic", re.I)


def get(url, cap=25_000_000):
    with urlopen(url, timeout=25) as response:
        data = response.read(cap + 1)
    if len(data) > cap:
        raise ValueError("Public data file exceeds download limit")
    return data


def agriculture(out, source):
    usda = pd.read_csv(io.BytesIO(source("usda.csv", USDA)), encoding="cp1252", low_memory=False)
    usda = usda[usda.geographic_extent.eq("United States")].copy()
    usda["year_value"] = pd.to_numeric(usda.year_value.astype(str).str[:4], errors="coerce")
    usda["value"] = pd.to_numeric(usda.value, errors="coerce")
    usda["table"] = usda.table_name.str.extract(r"^Table ([A-Z]-\d+)--")
    usda["variable"] = usda.variable.str.casefold()

    def series(crop, table, segment, variable, factor=1):
        rows = usda[(usda.commodity_element == crop) & (usda.table == table)
                    & (usda.market_segment == segment) & (usda.variable == variable)].dropna(subset=["value"])
        convert = rows.unit.map({"million pounds": 453592.37, "thousand tons": 907184.74}).fillna(factor)
        return pd.Series((rows.value * convert).to_numpy(), index=rows.year_value, name=variable)

    climate = {}
    for code, season, month in [("tavg", "spring_temp_f", 6), ("tavg", "summer_temp_f", 9),
                               ("pcp", "spring_rain_in", 6), ("pcp", "summer_rain_in", 9)]:
        path = f"{code}-{month}.csv"
        raw = pd.read_csv(io.BytesIO(source(path, f"{NOAA}/{code}/3/{month}/1980-2025.csv")), comment="#")
        climate[season] = pd.Series(raw.Value.to_numpy(), index=raw.Date // 100)
    weather = pd.DataFrame(climate).rename_axis("year")
    crops, demand = [], []
    for crop, table in TABLES.items():
        total = series(crop, table, "All", "production")
        utilized = series(crop, table, "All", "utilized production")
        acres = series(crop, "A-4", "All", "area bearing", 1000)
        frame = pd.concat([total, utilized, acres], axis=1).join(weather).dropna()
        frame["crop"] = crop.casefold()
        crops.append(frame.reset_index(names="year"))
        if crop in FRESH:
            fresh = series(crop, FRESH[crop], "Fresh", "domestic availability").to_frame().sort_index()
            fresh["crop"] = crop.casefold()
            demand.append(fresh.reset_index(names="year"))
    pd.concat(crops).round(3).to_csv(out / "usda-surplus.csv", index=False)
    pd.concat(demand).round(3).to_csv(out / "usda-demand.csv", index=False)


def symptom_text(out, raw):
    records = []
    for line in raw.decode().splitlines():
        row = json.loads(line)
        condition = (row.get("disease") or "").strip()
        answer = row["answer"]
        if NUTRIENT.search(condition) and re.search(r"symptom|look|sign|identif|recogniz", row["question"], re.I):
            label = "NUTRIENT"
        elif row["section"] == "symptoms" and row["category"] == "pest_identification":
            label = "PEST"
        elif row["section"] == "symptoms" and row["category"] in {"disease_identification", "disease_symptoms"}:
            label = "DISEASE"
        else:
            continue
        if not isinstance(answer, str) or not condition or condition.casefold() in {"healthy", "general", "unknown"}:
            continue
        # Hide the recorded condition name and omit the prompt, which often supplies the answer.
        answer = re.sub(re.escape(condition), " ", answer, flags=re.I)
        answer = re.split(r"\b(?:recommended treatment|to control|to manage|to treat)\b", answer, maxsplit=1, flags=re.I)[0]
        if len(answer.strip()) >= 35:
            records.append((row["id"], row["crop"].casefold(), condition.casefold(), answer.strip(), label))
    pd.DataFrame(records, columns=["source_id", "crop", "condition", "description", "label"]).drop_duplicates(
        subset=["description", "label"]
    ).to_csv(out / "symptoms.csv", index=False)


def photos(out, raw):
    frame = pd.read_csv(io.BytesIO(raw)).fillna("")

    def category(diagnosis):
        if diagnosis.strip().casefold() == "healthy":
            return "HEALTHY"
        found = [label for pattern, label in ((NUTRIENT, "NUTRIENT"), (PEST, "PEST"), (DISEASE, "DISEASE"))
                 if pattern.search(diagnosis)]
        return found[0] if len(found) == 1 and ";" not in diagnosis else None

    frame["label"] = frame.diagnosis.map(category)
    sample = pd.concat([group.sample(n=min(75, len(group)), random_state=7)
                        for _, group in frame.groupby("label")]).drop_duplicates("image_url")

    def extract(row):
        url = urlparse(row.image_url)
        if url.scheme != "https" or url.hostname != "farmerchat-mobile-app-prod.s3.ap-southeast-2.amazonaws.com":
            return None
        try:
            raw_image = get(row.image_url, 5_000_000)
            features = image_features(raw_image).round(5)
        except (OSError, ValueError, Image.DecompressionBombError):
            return None
        return [hashlib.sha256(raw_image).hexdigest(), row.crop.casefold(), row.diagnosis, row.label, *features]

    from PIL import Image
    with ThreadPoolExecutor(max_workers=12) as executor:
        rows = [row for row in executor.map(extract, sample.itertuples()) if row is not None]
    pd.DataFrame(rows, columns=["digest", "crop", "diagnosis", "label", *(f"f{i}" for i in range(132))]).drop_duplicates(
        "digest"
    ).to_csv(out / "leaf-features.csv", index=False, float_format="%.5f")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "data")
    parser.add_argument("--cache", type=Path)
    args = parser.parse_args()
    args.out.mkdir(exist_ok=True, parents=True)

    def source(name, url):
        file = args.cache / name if args.cache else None
        if file and file.exists():
            return file.read_bytes()
        data = get(url)
        if file:
            file.parent.mkdir(exist_ok=True, parents=True)
            file.write_bytes(data)
        return data

    agriculture(args.out, source)
    symptom_text(args.out, source("qa.jsonl", TEXT))
    photos(args.out, source("issues.csv", PHOTO))


if __name__ == "__main__":
    main()
