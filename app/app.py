"""
Flask server for the Ad Click Prediction dashboard.

    python app/app.py        →  http://127.0.0.1:5000
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
from flask import Flask, jsonify, render_template, request

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))          # so joblib can import ml.features

from ml.features import FEATURES, NUMERIC_RAW, raw_row_from_inputs  # noqa: E402

ARTIFACTS = ROOT / "artifacts"
if not (ARTIFACTS / "model.joblib").exists():
    sys.exit("Model not found. Run `python -m ml.train` first.")

model = joblib.load(ARTIFACTS / "model.joblib")
features_step = model.named_steps["features"]
forest = model.named_steps["rf"]
with open(ARTIFACTS / "results.json", encoding="utf-8") as fh:
    RESULTS = json.load(fh)
RANGES = RESULTS["predictor"]["ranges"]

app = Flask(__name__)
app.json.sort_keys = False          # keep feature order from results.json


def _validate(payload):
    values = {}
    limits = {**{c: (RANGES[c]["min"] * 0.5, RANGES[c]["max"] * 1.5) for c in NUMERIC_RAW},
              "Male": (0, 1), "Hour": (0, 23), "Day of Week": (0, 6), "Month": (1, 12)}
    for key, (lo, hi) in limits.items():
        if key not in payload:
            raise ValueError(f"missing field: {key}")
        v = float(payload[key])
        if not lo <= v <= hi:
            raise ValueError(f"{key} must be between {lo:g} and {hi:g}")
        values[key] = v
    return values


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/results")
def results():
    return jsonify(RESULTS)


@app.post("/api/predict")
def predict():
    try:
        values = _validate(request.get_json(force=True))
    except (ValueError, TypeError) as exc:
        return jsonify(error=str(exc)), 400

    row = raw_row_from_inputs(values)
    X = features_step.transform(row)
    tree_probs = np.array([t.predict_proba(X.values)[0, 1] for t in forest.estimators_])
    prob = float(model.predict_proba(row)[0, 1])

    # what-if: sweep each numeric input across its observed range, others fixed
    whatif = {}
    for col in NUMERIC_RAW:
        grid = np.linspace(RANGES[col]["min"], RANGES[col]["max"], 40)
        rows = raw_row_from_inputs(values).loc[[0] * len(grid)].reset_index(drop=True)
        rows[col] = grid
        whatif[col] = [[round(float(g), 2), round(float(p), 4)]
                       for g, p in zip(grid, model.predict_proba(rows)[:, 1])]

    return jsonify(
        probability=round(prob, 4),
        label=int(prob >= 0.5),
        tree_probs=[round(float(p), 3) for p in tree_probs],
        trees_for_click=int((tree_probs >= 0.5).sum()),
        site_share=round(float(X["Site Share"].iloc[0]), 4),
        whatif=whatif,
    )


if __name__ == "__main__":
    app.run(debug=False, port=5000)
