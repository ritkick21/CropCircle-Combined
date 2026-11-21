"""Compare recent inference features with the active bundle's reference ranges."""

def drift_report(connection, bundle):
    references = {
        "SURPLUS": [("surplus", bundle["surplus"]["ranges"])],
        "DEMAND": [("publicDemandProxy", bundle["demand"]["ranges"])],
        "CLASSIFY": [("symptomInputCoverage", bundle["text_ranges"])],
    }
    if bundle["platform_demand"] is not None:
        references["DEMAND"].append(("platformDemand", bundle["platform_demand"]["ranges"]))
    rows = connection.execute("""
        SELECT kind::text AS kind, signals, output->>'source' AS source FROM intelligence_jobs
        WHERE status = 'COMPLETE' AND model_version = %s AND signals IS NOT NULL
          AND finished_at >= now() - interval '30 days'
        ORDER BY finished_at DESC LIMIT 1000
        """, (bundle["manifest"]["version"],)).fetchall()
    report = []
    for kind, datasets in references.items():
        for dataset, ranges in datasets:
            samples = [row["signals"] for row in rows if row["kind"] == kind and (
                kind != "DEMAND" or (row["source"] == "CropCircle request history") == (dataset == "platformDemand")
            )]
            for feature, (low, high) in ranges.items():
                values = [sample[feature] for sample in samples if feature in sample]
                outside = round(sum(not low <= value <= high for value in values) / len(values), 3) if values else None
                report.append({
                    "model": dataset, "feature": feature, "samples": len(values), "outsideRange": outside,
                    "reference": [low, high],
                    "status": "insufficient_samples" if len(values) < 10 else "review" if outside > 0.30 else "stable",
                })
    return {"version": bundle["manifest"]["version"], "windowDays": 30, "features": report}
