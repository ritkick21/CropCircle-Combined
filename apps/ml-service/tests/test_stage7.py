from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
import os

from PIL import Image
import pandas as pd
import pytest

from cropcircle_ml.allocation import rank, recommend, route
from cropcircle_ml.inference import models, surplus
from cropcircle_ml.forecast import demand_rows, fit_forecast, predict
from cropcircle_ml.issues import classify, similar
from cropcircle_ml.monitor import drift_report
from cropcircle_ml.vision import image_features

NOW = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)


def listing(**overrides):
    return {
        "point": (40.7, -74), "crop_name": "Apple", "unit": "KG", "mode": "DONATION", "available": 75,
        "harvest_date": NOW - timedelta(days=1), "shelf_life_days": 7, "pickup_from": None,
        "pickup_until": NOW + timedelta(days=1), "expires_at": NOW + timedelta(days=3),
        "requires_cold_storage": True, **overrides,
    }


def recipient(id_, **overrides):
    return {
        "organization_id": id_, "name": id_, "accepted_crops": ["Apples"], "point": (40.72, -74),
        "pickup": False, "delivery": True, "accepts_sales": False, "cold_storage": True,
        "limits": [50, 40, None], "reserved_kg": 5, "service_radius_km": 50,
        "demand": "Fresh apple", "requested_kg": 20, "fulfilled": 5, "closed": 6, **overrides,
    }


def test_rank_filters_incompatible_capacity_storage_transport_and_freshness():
    results, _, _, _ = rank(listing(), [
        recipient("eligible"), recipient("cold", cold_storage=False), recipient("crop", accepted_crops=["Grape"]),
        recipient("unknown", limits=[None]), recipient("full", limits=[0]), recipient("far", point=(42.0, -74)),
        recipient("unavailable", pickup=False, delivery=False), recipient("reserved", reserved_kg=40),
    ], NOW)
    assert [x["id"] for x in results] == ["eligible"]
    assert rank(listing(mode="SALE"), [recipient("a")], NOW)[0] == []
    assert rank(listing(pickup_until=NOW + timedelta(minutes=5)), [recipient("a")], NOW)[0] == []
    assert rank(listing(harvest_date=NOW - timedelta(days=8)), [recipient("a")], NOW)[3] == "no_available_produce"


def test_multi_stop_allocation_routes_and_does_not_overfill():
    plan = recommend(listing(), [recipient("a"), recipient("b", point=(40.74, -74)), recipient("c", pickup=True)], NOW)
    assert plan["allocated"] == 75
    assert plan["unallocated"] == 0
    assert len([x for x in plan["recommendations"] if x["allocation"] > 0]) == 3
    assert all(x["allocation"] <= 35 for x in plan["recommendations"])
    assert plan["dropoffRouteKm"] < plan["separateDropoffTripsKm"]
    assert plan["expectedFulfilledEstimate"] < plan["allocated"]
    assert [row["id"] for row in plan["dropoffRoute"]] == ["a", "b"]


def test_capacity_unit_conversion_and_delivery_deadline():
    result = recommend(listing(unit="LB", available=100), [recipient("a", limits=[10], reserved_kg=0)], NOW)
    assert result["allocated"] == 22.04
    assert recommend(listing(unit="BOX"), [recipient("a")], NOW)["reason"] == "weight_required"
    candidates = [recipient("a"), recipient("b", point=(40.69, -74))]
    plan = recommend(listing(pickup_until=NOW + timedelta(minutes=18)), candidates, NOW)
    assert len(plan["dropoffRoute"]) == 1
    assert plan["allocated"] == 35


def test_route_empty():
    assert route((0, 0), []) == ([], 0)


def test_platform_training_lags_requests_acceptance_and_distribution():
    periods = pd.date_range("2023-01-01", periods=24, freq="MS").strftime("%Y-%m-%d")
    history = pd.DataFrame({
        "scope": "fixture", "crop": "apple", "period": periods,
        "requested": [10 + i % 6 for i in range(24)], "acceptance": [0.4 + i / 100 for i in range(24)],
        "distributed": [i % 9 for i in range(24)],
    })
    rows = demand_rows(history, platform=True)
    assert rows.iloc[0].prior_demand == history.iloc[1].requested
    assert rows.iloc[0].acceptance == history.iloc[1].acceptance
    assert rows.iloc[0].distributed == history.iloc[1].distributed
    trained = fit_forecast(rows, "platform_demand")
    estimate, signals = predict(trained, rows.iloc[-1])
    assert estimate["low"] <= estimate["estimate"] <= estimate["high"]
    assert "distributed" in signals


@pytest.fixture(scope="module")
def bundle():
    path = Path(os.getenv("ML_MODEL_DIR", Path(__file__).resolve().parents[1] / "models"))
    if not (path / "manifest.json").exists():
        if os.getenv("ML_REQUIRE_MODELS") == "1":
            pytest.fail("The trained model bundle is required")
        pytest.skip("Run the offline training command to verify the active model bundle")
    return models(path)


def test_trained_surplus_uses_scenario_acreage_and_intervals(bundle):
    result, _ = surplus(bundle, {"crop": "Apples", "acreage": 5})
    assert result["low"] <= result["estimate"] <= result["high"]
    assert result["acreage"] == 5
    assert result["source"].startswith("USDA")
    assert surplus(bundle, {"crop": "beet", "acreage": 5})[0]["status"] == "unsupported_crop"


def test_photo_descriptor_hypothesis_and_abstention(bundle):
    data = BytesIO()
    Image.new("RGB", (32, 32), "green").save(data, "PNG")
    assert image_features(data.getvalue()).shape == (132,)
    result, _ = classify(bundle, "apple", "Leaves have dark brown lesions and spots with yellow halos.", data.getvalue())
    assert result["photoAnalyzed"]
    weak, _ = classify(bundle, "apple", "vxzxv yzyxzz qytqq")
    assert weak["assessment"] == "INSUFFICIENT_EVIDENCE"


def test_farmer_matching_prioritizes_symptom_match_and_deduplicates(bundle):
    primary = {
        "crop_type": "Apple", "category": "DISEASE", "interests": ["orchard"],
        "point": (40.7, -74), "symptoms": "Dark brown lesions on the underside of leaves with yellow spots",
    }
    a = {**primary, "id": "a", "author_id": "farmer1", "display_name": "Peer", "region": "Local"}
    b = {**a, "id": "b", "author_id": "farmer2", "symptoms": "Irrigation around the roots was completely dry"}
    assert [x["reportId"] for x in similar(bundle, primary, [b, a, {**a, "id": "c"}])] == ["a", "b"]


def test_drift_requires_sample_threshold(bundle):
    class Connection:
        def execute(self, _sql, values):
            assert values == (bundle["manifest"]["version"],)
            return self

        def fetchall(self):
            return [{"kind": "SURPLUS", "signals": {"acreage_ratio": 10.0}, "source": ""}] * 10

    features = drift_report(Connection(), bundle)["features"]
    ratio = next(x for x in features if x["feature"] == "acreage_ratio")
    assert ratio["status"] == "review"
    assert ratio["outsideRange"] == 1
    assert next(x for x in features if x["feature"] == "summer_temp_f")["status"] == "insufficient_samples"
