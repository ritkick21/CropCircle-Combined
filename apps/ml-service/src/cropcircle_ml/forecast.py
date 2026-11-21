"""Feature pipelines shared by training and serving."""

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import mean_absolute_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBRegressor

WEATHER = ["spring_temp_f", "summer_temp_f", "spring_rain_in", "summer_rain_in"]
FEATURES = {
    "surplus": ["prior_harvest_per_acre", "prior_surplus_per_acre", "acreage_ratio", *WEATHER],
    "demand": ["prior_demand", "recent_demand"],
    "platform_demand": ["prior_demand", "recent_demand", "acceptance", "distributed", "month_sin", "month_cos"],
}


def surplus_rows(data):
    data = data.sort_values(["crop", "year"]).copy()
    data["harvest_per_acre"] = data.production / data["area bearing"]
    data["target"] = ((data.production - data["utilized production"]) / data["area bearing"]).clip(lower=0)
    grouped = data.groupby("crop")
    data["prior_harvest_per_acre"] = grouped.harvest_per_acre.shift()
    data["prior_surplus_per_acre"] = grouped.target.shift()
    data["acreage_ratio"] = data["area bearing"] / grouped["area bearing"].shift()
    return data.dropna(subset=FEATURES["surplus"])


def demand_rows(data, platform=False):
    key = "period" if platform else "year"
    groups = ["scope", "crop"] if platform else ["crop"]
    data = data.sort_values([*groups, key]).copy()
    data["target"] = data["requested"] if platform else data["domestic availability"] / 1_000_000
    if platform and data.loc[data.target > 0, "period"].nunique() < 12:
        raise ValueError("Platform demand training needs requests in at least 12 distinct completed months")
    grouped = data.groupby(groups)
    data["prior_demand"] = grouped.target.shift()
    data["recent_demand"] = grouped.target.transform(lambda x: x.shift().rolling(3, min_periods=2).mean())
    if platform:
        # Each row's outcomes are available only as inputs to the following month.
        data[["acceptance", "distributed"]] = grouped[["acceptance", "distributed"]].shift()
        add_month(data, pd.to_datetime(data.period).dt.month)
    data["year"] = data[key]
    return data.dropna(subset=FEATURES["platform_demand" if platform else "demand"])


def add_month(frame, month):
    frame["month_sin"] = np.sin(2 * np.pi * month / 12)
    frame["month_cos"] = np.cos(2 * np.pi * month / 12)


def fit_forecast(frame, kind):
    features = FEATURES[kind]
    years = sorted(frame.year.unique())
    if len(years) < 12:
        raise ValueError("At least 12 populated periods are required after lagging")
    train_end, calibration_end = years[int(len(years) * .65)], years[int(len(years) * .8)]
    train = frame[frame.year < train_end]
    calibration = frame[(frame.year >= train_end) & (frame.year < calibration_end)]
    test = frame[frame.year >= calibration_end]
    inputs = ["crop", *features]
    transformer = ColumnTransformer([("crop", OneHotEncoder(handle_unknown="ignore"), ["crop"]),
                                     ("numeric", "passthrough", features)])
    model = make_pipeline(transformer, XGBRegressor(
        n_estimators=100, max_depth=3, learning_rate=0.045, objective="reg:absoluteerror",
        random_state=7, n_jobs=2,
    ))
    model.fit(train[inputs], train.target)
    predicted = np.maximum(0, model.predict(test[inputs]))
    residual = abs(calibration.target - np.maximum(0, model.predict(calibration[inputs])))
    q = min(1, np.ceil(0.8 * (len(residual) + 1)) / len(residual))
    width = float(np.quantile(residual, q, method="higher"))
    naive = test.prior_surplus_per_acre if kind == "surplus" else test.prior_demand
    mae = mean_absolute_error(test.target, predicted)
    naive_mae = mean_absolute_error(test.target, naive)
    # Select the simpler persistence baseline if it wins on calibration, never on test.
    cal_naive = calibration.prior_surplus_per_acre if kind == "surplus" else calibration.prior_demand
    persistence = mean_absolute_error(calibration.target, cal_naive) < residual.mean()
    if persistence:
        residual = abs(calibration.target - cal_naive)
        width = float(np.quantile(residual, q, method="higher"))
        predicted = naive
    coverage = float(np.mean(abs(test.target - predicted) <= width))
    return {
        "model": model, "width": width, "inputs": inputs,
        "persistence": ("prior_surplus_per_acre" if kind == "surplus" else "prior_demand") if persistence else None,
        "ranges": {col: [float(train[col].quantile(.05)), float(train[col].quantile(.95))] for col in features},
        "metrics": {
            "holdout_mae": mean_absolute_error(test.target, predicted),
            "xgboost_mae": mae, "persistence_mae": naive_mae, "holdout_interval_coverage": coverage,
            "prefer_persistence_on_calibration": int(persistence),
            "train_rows": len(train), "calibration_rows": len(calibration), "test_rows": len(test),
            "holdout_start": str(calibration_end),
        },
    }


def predict(model, row, scale=1):
    if model["persistence"]:
        point = max(0, float(row[model["persistence"]]))
    else:
        point = max(0, float(model["model"].predict(pd.DataFrame([row], columns=model["inputs"]))[0]))
    width = model["width"]
    result = {"estimate": round(point * scale, 2), "low": round(max(0, point - width) * scale, 2),
              "high": round((point + width) * scale, 2), "intervalTarget": 0.8}
    signals = {key: float(row[key]) for key in model["ranges"]}
    return result, signals
