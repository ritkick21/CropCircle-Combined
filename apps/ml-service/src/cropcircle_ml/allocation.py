"""Eligibility, ranking, and a bounded mixed-integer allocation for one listing."""

from datetime import datetime, timedelta
from math import asin, cos, exp, floor, radians, sin, sqrt

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

VERSION = "allocation-1"
ROAD_FACTOR = 1.25
SPEED_KPH = 45
STOP_MINUTES = 10
MAX_DROPOFFS = 8


def distance(a, b):
    lat1, lon1, lat2, lon2 = map(radians, (a[0], a[1], b[0], b[1]))
    angle = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 12742 * asin(sqrt(min(1, angle)))


def road_km(a, b):
    return distance(a, b) * ROAD_FACTOR


def drive_minutes(km):
    return km / SPEED_KPH * 60


def crop_key(text):
    text = text.strip().casefold()
    return {"apples": "apple", "grapes": "grape", "peaches": "peach", "pears": "pear",
            "tomatoes": "tomato", "potatoes": "potato", "carrots": "carrot"}.get(text, text)


def rank(listing, candidates, now):
    start = max(now, listing["pickup_from"] or now, listing["harvest_date"])
    deadline = min(
        listing["expires_at"], listing["pickup_until"] or listing["expires_at"],
        listing["harvest_date"] + timedelta(days=listing["shelf_life_days"]),
    )
    available = float(listing["available"])
    factor = 0.45359237 if listing["unit"] == "LB" else 1
    if listing["unit"] == "BOX":
        return [], start, deadline, "weight_required"
    if start >= deadline or available < 0.01:
        return [], start, deadline, "no_available_produce"

    crop = crop_key(listing["crop_name"])
    freshness_minutes = (deadline - start).total_seconds() / 60
    eligible = []
    for candidate in candidates:
        accepted = {crop_key(value) for value in candidate["accepted_crops"]}
        if not ({crop, "*"} & accepted) or not (candidate["pickup"] or candidate["delivery"]):
            continue
        if listing["mode"] == "SALE" and not candidate["accepts_sales"]:
            continue
        if listing["requires_cold_storage"] and not candidate["cold_storage"]:
            continue
        # Unknown capacity does not establish eligibility. Zero is a valid limit.
        limits = [float(x) for x in candidate["limits"] if x is not None]
        if not limits:
            continue
        capacity = max(0, min(limits) - float(candidate["reserved_kg"]))
        distance_km = distance(listing["point"], candidate["point"])
        if distance_km > (candidate["service_radius_km"] or 100):
            continue
        minutes = drive_minutes(distance_km * ROAD_FACTOR) + STOP_MINUTES
        units = floor(min(capacity / factor, available) * 100 + 1e-7)
        if units <= 0 or minutes > freshness_minutes:
            continue
        probability = (candidate["fulfilled"] + 2) / (candidate["closed"] + 4)
        historical_demand = min(1, float(candidate["requested_kg"]) / max(available * factor, 1))
        demand = max(historical_demand, 0.7 if crop in candidate["demand"].casefold() else 0)
        features = {
            "capacityFit": units / (available * 100),
            "proximity": exp(-distance_km / 45),
            "travel": exp(-minutes / 100),
            "freshness": max(0, 1 - minutes / freshness_minutes),
            "demand": demand,
            "storage": 1 if candidate["cold_storage"] else 0.65,
            "pickup": 1 if candidate["pickup"] else 0.5,
            "fulfillment": probability,
        }
        weights = (0.13, 0.12, 0.10, 0.13, 0.14, 0.08, 0.10, 0.20)
        score = sum(w * value for w, value in zip(weights, features.values()))
        eligible.append({
            "id": str(candidate["organization_id"]), "name": candidate["name"],
            "capacity": units, "distanceKm": round(distance_km, 2), "travelMinutes": round(minutes, 1),
            "score": score, "fulfillmentRateEstimate": round(probability, 3),
            "closedRequests": candidate["closed"], "factors": features,
            "method": "RECIPIENT_PICKUP" if candidate["pickup"] else "FARM_DROPOFF",
            "point": candidate["point"],
        })
    return sorted(eligible, key=lambda x: (-x["score"], x["id"])), start, deadline, None


def route(origin, stops):
    """Nearest-neighbor closed tour, improved with 2-opt."""
    remaining = list(stops)
    ordered = []
    point = origin
    while remaining:
        stop = min(remaining, key=lambda item: (road_km(point, item["point"]), item["id"]))
        remaining.remove(stop)
        ordered.append(stop)
        point = stop["point"]

    def km(tour):
        points = [origin, *(stop["point"] for stop in tour), origin]
        return sum(road_km(a, b) for a, b in zip(points, points[1:]))

    improved = True
    while improved:
        improved = False
        for i in range(len(ordered) - 1):
            for j in range(i + 1, len(ordered)):
                trial = ordered[:i] + ordered[i:j + 1][::-1] + ordered[j + 1:]
                if km(trial) + 1e-8 < km(ordered):
                    ordered = trial
                    improved = True

    arrivals, elapsed, point = [], 0.0, origin
    for stop in ordered:
        elapsed += drive_minutes(road_km(point, stop["point"])) + STOP_MINUTES
        arrivals.append((stop["id"], round(elapsed, 2)))
        point = stop["point"]
    return arrivals, km(ordered)


def solve(candidates, total):
    if not candidates:
        return []
    count = len(candidates)
    capacities = np.array([x["capacity"] for x in candidates])
    dropoffs = np.array([x["method"] == "FARM_DROPOFF" for x in candidates])
    # Quantity (hundredths of a listing unit) and binary stop-activation variables.
    constraints = [
        LinearConstraint(np.r_[np.ones(count), np.zeros(count)], -np.inf, total),
        LinearConstraint(np.c_[np.eye(count), -np.diag(capacities)], -np.inf, 0),
        LinearConstraint(np.c_[-np.eye(count), np.eye(count)], -np.inf, 0),
        LinearConstraint(np.r_[np.zeros(count), dropoffs], -np.inf, MAX_DROPOFFS),
    ]
    bounds = Bounds(np.zeros(2 * count), np.r_[capacities, np.ones(count)])
    integrality = np.ones(2 * count)
    first = milp(np.r_[-np.ones(count), np.zeros(count)], integrality=integrality,
                 bounds=bounds, constraints=constraints, options={"time_limit": 2})
    if first.x is None:
        raise RuntimeError("No allocation solution")
    volume = round(sum(first.x[:count]))
    constraints.append(LinearConstraint(np.r_[np.ones(count), np.zeros(count)], volume, volume))
    second = milp(
        np.r_[[-(x["score"] + x["fulfillmentRateEstimate"]) / 2 for x in candidates],
              [0.2 * x["distanceKm"] + 1 for x in candidates]],
        integrality=integrality, bounds=bounds, constraints=constraints, options={"time_limit": 2},
    )
    chosen = (second.x if second.x is not None else first.x)[:count]
    return [(candidate, round(quantity)) for candidate, quantity in zip(candidates, chosen)
            if round(quantity) > 0]


def recommend(listing, candidates, now: datetime):
    ranked, start, deadline, reason = rank(listing, candidates, now)
    pool = ranked[:40]
    total = round(float(listing["available"]) * 100)
    while True:
        allocations = solve(pool, total)
        drops = [row for row, _ in allocations if row["method"] == "FARM_DROPOFF"]
        arrivals, route_km = route(listing["point"], drops)
        if not arrivals or arrivals[-1][1] <= (deadline - start).total_seconds() / 60:
            break
        late_id = arrivals[-1][0]
        pool = [row for row in pool if row["id"] != late_id]
    amounts = {row["id"]: quantity / 100 for row, quantity in allocations}
    allocated = sum(amounts.values())
    estimated = sum(quantity / 100 * row["fulfillmentRateEstimate"] for row, quantity in allocations)
    return {
        "version": VERSION, "unit": listing["unit"], "crop": listing["crop_name"],
        "available": total / 100, "allocated": round(allocated, 2),
        "unallocated": round(total / 100 - allocated, 2), "expectedFulfilledEstimate": round(estimated, 2),
        "reason": reason or ("no_eligible_recipients" if not ranked else None),
        "evaluatedAt": now.isoformat(), "startAt": start.isoformat(), "deadline": deadline.isoformat(),
        "recommendations": [
            {**{k: v for k, v in row.items() if k not in {"point", "capacity", "score"}},
             "capacity": row["capacity"] / 100, "score": round(row["score"], 3),
             "allocation": amounts.get(row["id"], 0)}
            for row in ranked[:40]
        ],
        "dropoffRoute": [{"id": id_, "arrivalMinutes": minutes} for id_, minutes in arrivals],
        "dropoffRouteKm": round(route_km, 2),
        "separateDropoffTripsKm": round(sum(2 * road_km(listing["point"], x["point"]) for x in drops), 2),
        "transportEstimate": "Public coordinates, approximate road distance and driving time",
    }
