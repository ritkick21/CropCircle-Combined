"""PostgreSQL queries used by inference jobs and the training export."""

LISTING = """
SELECT l.crop_name, l.unit, l.mode, l.quantity - l.reserved_quantity AS available,
       l.harvest_date::timestamp AT TIME ZONE 'UTC' AS harvest_date, l.expires_at, l.pickup_from,
       l.pickup_until, l.shelf_life_days, l.requires_cold_storage, l.organization_id,
       r.available AS location_available,
       ARRAY[ST_Y(r.public_geog::geometry), ST_X(r.public_geog::geometry)] AS point
FROM crop_listings l JOIN resource_locations r ON r.id = l.location_id
JOIN organizations o ON o.id = l.organization_id
WHERE l.id = %s AND l.deleted_at IS NULL AND o.deleted_at IS NULL AND o.suspended_at IS NULL
  AND o.verified_at IS NOT NULL AND r.published_at IS NOT NULL AND r.verified_at IS NOT NULL
"""

RECIPIENTS = """
SELECT p.organization_id, o.name, p.pickup, p.delivery, p.accepts_sales, p.cold_storage,
       coalesce(p.demand, '') AS demand, p.service_radius_km,
       CASE WHEN cardinality(p.accepted_crops) > 0 THEN p.accepted_crops ELSE r.accepted_crops END AS accepted_crops,
       ARRAY[p.quantity_limit, p.storage_capacity, r.capacity_kg] AS limits,
       ARRAY[ST_Y(r.public_geog::geometry), ST_X(r.public_geog::geometry)] AS point,
       coalesce(h.fulfilled, 0) AS fulfilled, coalesce(h.closed, 0) AS closed,
       coalesce(h.requested_kg, 0) AS requested_kg, coalesce(h.reserved_kg, 0) AS reserved_kg
FROM marketplace_profiles p JOIN organizations o ON o.id = p.organization_id
JOIN resource_locations r ON r.id = p.location_id AND r.organization_id = p.organization_id
JOIN crop_listings origin ON origin.id = %(listing)s
JOIN resource_locations src ON src.id = origin.location_id
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE q.status = 'FULFILLED') AS fulfilled,
         count(*) FILTER (WHERE q.status IN ('FULFILLED', 'REJECTED', 'CANCELLED')) AS closed,
         sum(q.quantity * CASE l.unit WHEN 'KG' THEN 1 WHEN 'LB' THEN 0.45359237 END)
           FILTER (WHERE lower(l.crop_name) = ANY(%(crop_names)s)
                   AND q.created_at >= now() - interval '90 days') AS requested_kg,
         sum(q.quantity * CASE l.unit WHEN 'KG' THEN 1 WHEN 'LB' THEN 0.45359237 END)
           FILTER (WHERE q.status = 'ACCEPTED' AND l.expires_at > now()) AS reserved_kg
  FROM marketplace_requests q JOIN crop_listings l ON l.id = q.listing_id
  WHERE q.organization_id = o.id
) h ON true
WHERE o.id <> %(seller)s AND o.deleted_at IS NULL AND o.suspended_at IS NULL
  AND o.verified_at IS NOT NULL AND r.verified_at IS NOT NULL AND r.published_at IS NOT NULL AND r.available
  AND ST_DWithin(r.public_geog, src.public_geog, 500000)
"""

ISSUE_FIELDS = """
SELECT i.id, i.author_id, i.crop_type, i.category, i.symptoms, i.region, i.interests,
       CASE WHEN i.public_lat IS NOT NULL AND i.public_lng IS NOT NULL
            THEN ARRAY[i.public_lat::float8, i.public_lng::float8] END AS point,
       u.display_name
FROM issue_reports i JOIN users u ON u.id = i.author_id
WHERE u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL AND u.deleted_at IS NULL
"""

DEMAND_HISTORY = """
WITH raw AS (
  SELECT q.organization_id::text AS org, lower(trim(l.crop_name)) AS crop,
         date_trunc('month', q.created_at AT TIME ZONE 'UTC')::date AS period,
         date_trunc('month', q.fulfilled_at AT TIME ZONE 'UTC')::date AS fulfilled_period,
         q.updated_at, q.status,
         q.quantity * CASE l.unit WHEN 'KG' THEN 1 WHEN 'LB' THEN 0.45359237 END AS kg
  FROM marketplace_requests q JOIN crop_listings l ON l.id = q.listing_id
  WHERE l.unit IN ('KG', 'LB') AND (%(organization)s::text IS NULL OR q.organization_id::text = %(organization)s)
    AND (%(crop_names)s::text[] IS NULL OR lower(trim(l.crop_name)) = ANY(%(crop_names)s))
), cohorts AS (
  SELECT org AS scope, crop, period, sum(kg) AS requested, count(*) AS requests,
         count(*) FILTER (WHERE
            (status = 'FULFILLED' AND fulfilled_period <= period)
            OR (status = 'ACCEPTED' AND updated_at < (period + interval '1 month') AT TIME ZONE 'UTC')
         ) AS accepted
  FROM raw GROUP BY org, crop, period
), deliveries AS (
  SELECT org AS scope, crop, fulfilled_period AS period, sum(kg) AS distributed
  FROM raw WHERE status = 'FULFILLED' AND fulfilled_period IS NOT NULL
  GROUP BY org, crop, fulfilled_period
)
SELECT coalesce(c.scope, d.scope) AS scope, coalesce(c.crop, d.crop) AS crop,
       coalesce(c.period, d.period)::text AS period, coalesce(requested, 0)::float8 AS requested,
       coalesce(requests, 0) AS requests, coalesce(accepted, 0) AS accepted,
       coalesce(distributed, 0)::float8 AS distributed
FROM cohorts c FULL JOIN deliveries d USING (scope, crop, period)
WHERE coalesce(c.period, d.period) < date_trunc('month', now() AT TIME ZONE 'UTC')::date
ORDER BY period, scope, crop
"""


def crop_variants(crop):
    from cropcircle_ml.allocation import crop_key
    crop = crop_key(crop)
    return [crop, crop + ("es" if crop.endswith(("ch", "to")) else "s")]


def demand_history(connection, organization=None, crop=None):
    from datetime import datetime, timezone

    import pandas as pd

    rows = connection.execute(DEMAND_HISTORY, {
        "organization": str(organization) if organization else None, "crop_names": crop_variants(crop) if crop else None,
    }).fetchall()
    if not rows:
        return pd.DataFrame(columns=["scope", "crop", "period", "requested", "acceptance", "distributed"])
    frame = pd.DataFrame(rows)
    from cropcircle_ml.allocation import crop_key
    frame["crop"] = frame.crop.map(crop_key)
    frame["period"] = pd.to_datetime(frame.period)
    monthly = frame.groupby(["scope", "crop", "period"], as_index=False)[
        ["requested", "requests", "accepted", "distributed"]
    ].sum()
    end = pd.Timestamp(datetime.now(timezone.utc).date()).replace(day=1) - pd.offsets.MonthBegin()
    groups = []
    for (scope, crop_name), group in monthly.groupby(["scope", "crop"]):
        periods = pd.date_range(group.period.min(), end, freq="MS").rename("period")
        complete = group.set_index("period").reindex(periods).fillna(
            {"requested": 0, "requests": 0, "accepted": 0, "distributed": 0},
        ).reset_index()
        complete["scope"], complete["crop"] = scope, crop_name
        complete["acceptance"] = (complete.accepted + 1) / (complete.requests + 2)
        groups.append(complete)
    return pd.concat(groups, ignore_index=True)
