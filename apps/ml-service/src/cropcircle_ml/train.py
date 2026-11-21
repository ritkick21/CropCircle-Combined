"""Offline training and evaluation. Serving only loads the versioned bundle."""

import argparse
import hashlib
import json
import os
from pathlib import Path

import joblib
import mlflow
import numpy as np
import pandas as pd
from sklearn.decomposition import TruncatedSVD
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, f1_score
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import StratifiedGroupKFold

from cropcircle_ml.allocation import crop_key
from cropcircle_ml.forecast import WEATHER, demand_rows, fit_forecast, surplus_rows

FILES = ("usda-surplus.csv", "usda-demand.csv", "symptoms.csv", "leaf-features.csv")


def classification_metrics(labels, prediction, train, test):
    return {
        "holdout_balanced_accuracy": balanced_accuracy_score(labels, prediction),
        "holdout_macro_f1": f1_score(labels, prediction, average="macro"),
        "train_rows": len(train), "test_rows": len(test),
    }


def grouped_split(frame, groups):
    splits = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=7).split(frame, frame.label, groups)
    return next((train, test) for train, test in splits
                if set(frame.label.iloc[train]) == set(frame.label.iloc[test]) == set(frame.label))


def train(data_dir, output, platform_demand=None):
    frames = [pd.read_csv(data_dir / file) for file in FILES]
    agriculture, demand, symptoms, photos = frames
    for frame in frames:
        frame["crop"] = frame.crop.map(crop_key)
    yield_frame = surplus_rows(agriculture)
    demand_frame = demand_rows(demand)
    surplus = fit_forecast(yield_frame, "surplus")
    availability = fit_forecast(demand_frame, "demand")
    text_train, text_test = grouped_split(symptoms, symptoms.condition)
    symptoms_train = symptoms.iloc[text_train]
    symptoms_test = symptoms.iloc[text_test]
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=8000, stop_words="english")
    vectors = vectorizer.fit_transform(symptoms_train.description)
    text = LogisticRegression(class_weight="balanced", max_iter=400, random_state=7).fit(vectors, symptoms_train.label)
    test_vectors = vectorizer.transform(symptoms_test.description)
    text_metrics = classification_metrics(symptoms_test.label, text.predict(test_vectors), text_train, text_test)
    semantic = TruncatedSVD(n_components=48, random_state=7).fit(vectors)
    nearest = cosine_similarity(semantic.transform(test_vectors), semantic.transform(vectors)).argmax(axis=1)
    neighbor_agreement = float(np.mean(symptoms_train.label.iloc[nearest].to_numpy() == symptoms_test.label.to_numpy()))
    image_train, image_test = grouped_split(photos, photos.crop)
    features = photos[[f"f{i}" for i in range(132)]].to_numpy()
    vision = RandomForestClassifier(n_estimators=120, min_samples_leaf=2, class_weight="balanced",
                                    random_state=7, n_jobs=2).fit(features[image_train], photos.label.iloc[image_train])
    image_metrics = classification_metrics(
        photos.label.iloc[image_test], vision.predict(features[image_test]), image_train, image_test,
    )
    metrics = {"surplus": surplus["metrics"], "publicDemandProxy": availability["metrics"],
               "symptomCategory": text_metrics, "photoCategory": image_metrics,
               "similarityProxy": {"holdout_category_agreement": neighbor_agreement, "test_rows": len(text_test)}}
    forecast_platform = None
    paths = [data_dir / file for file in FILES]
    if platform_demand is not None:
        paths.append(platform_demand)
        platform = pd.read_csv(platform_demand)
        platform["crop"] = platform.crop.map(crop_key)
        forecast_platform = fit_forecast(demand_rows(platform, platform=True), "platform_demand")
        forecast_platform["crops"] = set(platform.crop)
        metrics["platformDemand"] = forecast_platform["metrics"]
    digest = hashlib.sha256()
    for path in [*paths, Path(__file__), Path(__file__).with_name("forecast.py"),
                 Path(__file__).with_name("issues.py"), Path(__file__).with_name("vision.py")]:
        digest.update(path.read_bytes())
    version = f"stage7-{digest.hexdigest()[:12]}"
    historical = {}
    for crop, rows in yield_frame.groupby("crop"):
        recent = rows.tail(10)
        historical[crop] = {
            "prior_harvest_per_acre": float(rows.iloc[-1].harvest_per_acre),
            "prior_surplus_per_acre": float(rows.iloc[-1].target), "acreage_ratio": 1,
            **{key: float(recent[key].mean()) for key in WEATHER},
            "last_year": int(rows.iloc[-1].year),
        }
    demand_history = {}
    for crop, rows in demand_frame.groupby("crop"):
        demand_history[crop] = {
            "prior_demand": float(rows.iloc[-1].target),
            "recent_demand": float(rows.target.tail(3).mean()), "last_year": int(rows.iloc[-1].year),
        }
    output.mkdir(parents=True, exist_ok=True)
    with mlflow.start_run(run_name=version) as run:
        model_file = output / f"{version}.joblib"
        manifest = {
            "version": version, "runId": run.info.run_id, "evaluation": metrics,
            "surplusCrops": sorted(historical), "demandProxyCrops": sorted(demand_history),
            "platformDemandModel": forecast_platform is not None, "artifact": model_file.name,
        }
        bundle = {
            "manifest": manifest, "surplus": surplus, "demand": availability, "platform_demand": forecast_platform,
            "historical": historical, "demand_history": demand_history, "text_vectorizer": vectorizer,
            "text_model": text, "image_model": vision, "semantic": semantic,
            "issue_reference_vectors": vectors,
            "issue_references": list(symptoms_train[["crop", "label", "condition"]].itertuples(index=False, name=None)),
            "issue_crops": set(symptoms_train.crop) | set(photos.iloc[image_train].crop),
            "text_ranges": {
                "known_terms": np.quantile(test_vectors.getnnz(axis=1), [.05, .95]).tolist(),
                "top_score": np.quantile(text.predict_proba(test_vectors).max(axis=1), [.05, .95]).tolist(),
            },
        }
        joblib.dump(bundle, model_file, compress=3)
        mlflow.log_params({"bundle_version": version, "seed": 7, "interval_target": 0.8,
                           "text_split": "condition", "image_split": "crop", "forecast_split": "chronological"})
        for section, values in metrics.items():
            mlflow.log_metrics({f"{section}.{key}": float(value) for key, value in values.items()
                                if isinstance(value, (float, int, np.number))})
        mlflow.log_artifact(str(model_file))
        mlflow.log_dict(manifest, "evaluation.json")
        pending = output / "manifest.pending"
        pending.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        pending.replace(output / "manifest.json")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--out", type=Path, default=Path("models"))
    parser.add_argument("--platform-demand", type=Path)
    args = parser.parse_args()
    if not os.environ.get("MLFLOW_TRACKING_URI"):
        os.environ["MLFLOW_ALLOW_FILE_STORE"] = "true"
        mlflow.set_tracking_uri((args.out / "mlruns").resolve().as_uri())
    mlflow.set_experiment("CropCircle Stage 7")
    print(json.dumps(train(args.data, args.out, args.platform_demand), indent=2))


if __name__ == "__main__":
    main()
