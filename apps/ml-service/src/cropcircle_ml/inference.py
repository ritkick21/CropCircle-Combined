"""Application inputs, model bundle loading, and inference dispatch."""

from datetime import datetime, timezone
from functools import lru_cache
import json
from pathlib import Path

import joblib
import pandas as pd

from cropcircle_ml import allocation, issues
from cropcircle_ml.forecast import WEATHER, add_month, predict
from cropcircle_ml.repository import ISSUE_FIELDS, LISTING, RECIPIENTS, crop_variants, demand_history


@lru_cache(maxsize=2)
def _load(path, run_id):
    return joblib.load(path)


def models(model_dir):
    path = Path(model_dir)
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    return _load(path / manifest["artifact"], manifest["runId"])


def surplus(bundle, inputs):
    crop = allocation.crop_key(inputs["crop"])
    if crop not in bundle["historical"]:
        return {"crop": crop, "status": "unsupported_crop"}, {}
    row = dict(bundle["historical"][crop], crop=crop)
    acreage = inputs["acreage"]
    previous_acreage = inputs.get("priorAcreage") or acreage
    row["acreage_ratio"] = acreage / previous_acreage
    if inputs.get("priorHarvestKg") is not None:
        row["prior_harvest_per_acre"] = inputs["priorHarvestKg"] / previous_acreage
    if inputs.get("priorSurplusKg") is not None:
        row["prior_surplus_per_acre"] = inputs["priorSurplusKg"] / previous_acreage
    for key in WEATHER:
        if key in inputs:
            row[key] = inputs[key]
    result, signals = predict(bundle["surplus"], row, scale=acreage)
    return {
        **result, "crop": crop, "unit": "kg for the entered acreage", "period": row["last_year"] + 1,
        "acreage": acreage, "source": "USDA unutilized-production proxy, scaled to acreage",
        "weather": "Scenario inputs" if any(key in inputs for key in WEATHER) else "NOAA historical growing-season averages",
    }, signals


def demand(connection, bundle, job, inputs):
    crop = allocation.crop_key(inputs["crop"])
    model = bundle["platform_demand"]
    organization = job["organization_id"]
    if organization and model and crop in model["crops"]:
        history = demand_history(connection, organization, crop)
        if len(history) >= 3 and history.requests.sum() >= 3:
            last = history.iloc[-1]
            upcoming = last.period + pd.offsets.MonthBegin()
            row = pd.DataFrame([{
                "crop": crop, "prior_demand": last.requested, "recent_demand": history.requested.tail(3).mean(),
                "acceptance": last.acceptance, "distributed": last.distributed,
            }])
            add_month(row, upcoming.month)
            result, signals = predict(model, row.iloc[0])
            return {**result, "crop": crop, "unit": "kg requested",
                    "period": upcoming.strftime("%Y-%m"), "source": "CropCircle request history"}, signals
    if crop not in bundle["demand_history"]:
        return {"crop": crop, "status": "insufficient_history"}, {}
    row = dict(bundle["demand_history"][crop], crop=crop)
    result, signals = predict(bundle["demand"], row)
    return {**result, "crop": crop, "unit": "million kg nationally", "period": row["last_year"] + 1,
            "source": "USDA fresh domestic availability proxy", "localDemandAvailable": False}, signals


def run(connection, settings, job):
    kind = job["kind"]
    if kind == "RECOMMENDATION":
        listing = connection.execute(LISTING, (job["subject_id"],)).fetchone()
        if not listing or not listing["location_available"]:
            return {"reason": "listing_unavailable", "recommendations": []}, {}, allocation.VERSION
        recipients = connection.execute(RECIPIENTS, {
            "listing": job["subject_id"], "seller": listing["organization_id"],
            "crop_names": crop_variants(listing["crop_name"]),
        }).fetchall()
        result = allocation.recommend(listing, recipients, datetime.now(timezone.utc))
        return result, {"candidate_count": len(recipients)}, allocation.VERSION

    bundle = models(settings.ml_model_dir)
    inputs = job["input"]
    version = bundle["manifest"]["version"]
    if kind == "SURPLUS":
        result, signals = surplus(bundle, inputs)
    elif kind == "DEMAND":
        result, signals = demand(connection, bundle, job, inputs)
    elif kind == "CLASSIFY":
        import base64
        photo = base64.b64decode(inputs["photo"], validate=True) if inputs.get("photo") else None
        result, signals = issues.classify(bundle, inputs["crop"], inputs["symptoms"], photo)
    elif kind == "SIMILARITY":
        issue = connection.execute(ISSUE_FIELDS + " AND i.id = %s", (job["subject_id"],)).fetchone()
        candidates = connection.execute(
            ISSUE_FIELDS + """
            AND i.author_id <> %s AND i.author_id <> %s
            ORDER BY (lower(i.crop_type) = lower(%s)) DESC, (i.category = %s) DESC, i.created_at DESC
            LIMIT 200
            """,
            (issue["author_id"], job["user_id"], issue["crop_type"], issue["category"]),
        ).fetchall() if issue else []
        matches = issues.similar(bundle, issue, candidates) if issue else []
        result, signals = {"matches": matches}, {"candidate_count": len(candidates)}
    else:
        raise ValueError("Unsupported inference kind")
    return result, signals, version
