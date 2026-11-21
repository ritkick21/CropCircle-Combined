"""Export aggregate marketplace history for offline demand-model training."""

import argparse
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from cropcircle_ml.config import get_settings
from cropcircle_ml.repository import demand_history


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    with psycopg.connect(get_settings().database_url, row_factory=dict_row) as connection:
        history = demand_history(connection)
    # No customer identifiers or issue content are written to the training export.
    history["scope"] = history.scope.astype("category").cat.codes
    history[["scope", "crop", "period", "requested", "acceptance", "distributed"]].to_csv(args.out, index=False)
    print(f"Exported {len(history)} completed crop-month aggregates")
