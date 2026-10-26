"""
End-to-end training pipeline.

    python -m ml.train

Produces
    artifacts/model.joblib    tuned Random Forest pipeline (raw dataframe in, P(click) out)
    artifacts/results.json    every number and curve the dashboard and report display
"""
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.stats import binomtest, randint
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import (AdaBoostClassifier, GradientBoostingClassifier,
                              RandomForestClassifier)
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, auc, confusion_matrix, f1_score,
                             precision_recall_curve, precision_score,
                             recall_score, roc_auc_score, roc_curve)
from sklearn.model_selection import (RandomizedSearchCV, StratifiedKFold,
                                     cross_val_score, cross_validate,
                                     learning_curve, train_test_split,
                                     validation_curve)
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

from ml.features import (DROPPED, FEATURE_NOTES, FEATURES, NUMERIC_RAW, TARGET,
                         FeatureBuilder, load_raw)
from ml.scratch_forest import ScratchForest

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "advertising.csv"
OUT = ROOT / "artifacts"
SEED = 42
CV = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)


def r(x, n=4):
    return float(round(float(x), n))


def metrics(y_true, prob, threshold=0.5):
    pred = (prob >= threshold).astype(int)
    return {
        "accuracy": r(accuracy_score(y_true, pred)),
        "precision": r(precision_score(y_true, pred, zero_division=0)),
        "recall": r(recall_score(y_true, pred)),
        "f1": r(f1_score(y_true, pred)),
        "roc_auc": r(roc_auc_score(y_true, prob)),
    }


def thin_curve(xs, ys, max_points=120):
    """Downsample a curve for the browser while keeping its endpoints."""
    xs, ys = np.asarray(xs), np.asarray(ys)
    if len(xs) > max_points:
        idx = np.unique(np.linspace(0, len(xs) - 1, max_points).astype(int))
        xs, ys = xs[idx], ys[idx]
    return [[r(a), r(b)] for a, b in zip(xs, ys)]


# ----------------------------------------------------------------------------
# 1. Dataset understanding
# ----------------------------------------------------------------------------
def profile_dataset(df):
    raw = pd.read_csv(DATA)
    cols = []
    descriptions = {
        "Daily Time Spent on Site": "Minutes per day on the publisher site",
        "Age": "User age in years",
        "Area Income": "Avg. yearly income of the user's area (USD)",
        "Daily Internet Usage": "Minutes per day online overall",
        "Ad Topic Line": "Headline text of the ad shown",
        "City": "User city",
        "Male": "Gender flag (1 = male)",
        "Country": "User country",
        "Timestamp": "When the ad was shown",
        "Clicked on Ad": "Target: 1 = clicked, 0 = not clicked",
    }
    for c in raw.columns:
        s = raw[c]
        kind = "numeric" if pd.api.types.is_numeric_dtype(s) else "text"
        if c == "Timestamp":
            kind = "datetime"
        if c in ("Male", TARGET):
            kind = "binary"
        entry = {
            "name": c,
            "dtype": str(s.dtype),
            "kind": kind,
            "missing": int(s.isna().sum()),
            "unique": int(s.nunique()),
            "description": descriptions[c],
            "role": "target" if c == TARGET else ("dropped" if c in DROPPED else "feature"),
        }
        if kind == "numeric":
            entry.update(min=r(s.min(), 2), max=r(s.max(), 2), mean=r(s.mean(), 2),
                         std=r(s.std(), 2), median=r(s.median(), 2))
        cols.append(entry)

    preview = raw.copy()
    preview["Timestamp"] = preview["Timestamp"].astype(str)
    return {
        "rows": int(len(raw)),
        "columns": int(raw.shape[1]),
        "missing_total": int(raw.isna().sum().sum()),
        "duplicates": int(raw.duplicated().sum()),
        "class_counts": {str(k): int(v) for k, v in raw[TARGET].value_counts().sort_index().items()},
        "date_range": [str(df["Timestamp"].min().date()), str(df["Timestamp"].max().date())],
        "column_info": cols,
        "records": preview.to_dict(orient="records"),
    }


# ----------------------------------------------------------------------------
# 2. Exploratory analysis
# ----------------------------------------------------------------------------
def explore(df):
    out = {"histograms": {}, "box": {}}
    y = df[TARGET]
    for col in NUMERIC_RAW:
        edges = np.histogram_bin_edges(df[col], bins=18)
        h0, _ = np.histogram(df.loc[y == 0, col], bins=edges)
        h1, _ = np.histogram(df.loc[y == 1, col], bins=edges)
        out["histograms"][col] = {
            "edges": [r(e, 2) for e in edges],
            "not_clicked": h0.tolist(),
            "clicked": h1.tolist(),
            "mean_not_clicked": r(df.loc[y == 0, col].mean(), 2),
            "mean_clicked": r(df.loc[y == 1, col].mean(), 2),
        }
        for label, part in (("not_clicked", df.loc[y == 0, col]), ("clicked", df.loc[y == 1, col])):
            q1, med, q3 = np.percentile(part, [25, 50, 75])
            iqr = q3 - q1
            lo_w = part[part >= q1 - 1.5 * iqr].min()
            hi_w = part[part <= q3 + 1.5 * iqr].max()
            outl = part[(part < q1 - 1.5 * iqr) | (part > q3 + 1.5 * iqr)]
            out["box"].setdefault(col, {})[label] = {
                "q1": r(q1, 2), "median": r(med, 2), "q3": r(q3, 2),
                "lo": r(lo_w, 2), "hi": r(hi_w, 2), "outliers": [r(v, 2) for v in outl],
            }

    ts = df["Timestamp"]
    by_hour = df.groupby(ts.dt.hour)[TARGET].agg(["mean", "count"])
    out["by_hour"] = [{"hour": int(h), "rate": r(m), "n": int(c)} for h, (m, c) in by_hour.iterrows()]
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    by_day = df.groupby(ts.dt.day_of_week)[TARGET].agg(["mean", "count"])
    out["by_day"] = [{"day": days[int(d)], "rate": r(m), "n": int(c)} for d, (m, c) in by_day.iterrows()]

    bands = pd.cut(df["Age"], bins=[18, 25, 30, 35, 40, 45, 50, 61],
                   labels=["18-25", "26-30", "31-35", "36-40", "41-45", "46-50", "51-61"],
                   include_lowest=True)
    by_age = df.groupby(bands, observed=True)[TARGET].agg(["mean", "count"])
    out["by_age"] = [{"band": str(b), "rate": r(m), "n": int(c)} for b, (m, c) in by_age.iterrows()]

    by_gender = df.groupby("Male")[TARGET].agg(["mean", "count"])
    out["by_gender"] = [{"group": "Male" if g == 1 else "Female", "rate": r(m), "n": int(c)}
                        for g, (m, c) in by_gender.iterrows()]

    sample = df.sample(400, random_state=SEED)
    out["scatter"] = [
        {"t": r(a, 2), "u": r(b, 2), "y": int(c)}
        for a, b, c in zip(sample["Daily Time Spent on Site"], sample["Daily Internet Usage"], sample[TARGET])
    ]

    feats = FeatureBuilder(clip=False).fit(df).transform(df)
    feats[TARGET] = df[TARGET].values
    corr = feats.corr()
    out["corr"] = {"labels": list(corr.columns), "matrix": [[r(v, 3) for v in row] for row in corr.values]}

    # quick business numbers used in the insights section
    t = df["Daily Time Spent on Site"]
    u = df["Daily Internet Usage"]
    out["facts"] = {
        "rate_time_lt_60": r(y[t < 60].mean()),
        "rate_time_ge_75": r(y[t >= 75].mean()),
        "rate_usage_lt_150": r(y[u < 150].mean()),
        "rate_usage_ge_200": r(y[u >= 200].mean()),
        "rate_age_ge_45": r(y[df["Age"] >= 45].mean()),
        "rate_age_lt_30": r(y[df["Age"] < 30].mean()),
        "rate_income_lt_40k": r(y[df["Area Income"] < 40000].mean()),
        "rate_income_ge_60k": r(y[df["Area Income"] >= 60000].mean()),
        "corr_with_target": {c: r(corr.loc[c, TARGET], 3) for c in FEATURES},
    }
    return out


# ----------------------------------------------------------------------------
# 3. Preprocessing report
# ----------------------------------------------------------------------------
def preprocessing_report(df, fb):
    clipped = {}
    for col in NUMERIC_RAW:
        lo, hi = fb.bounds_[col]
        n_lo = int((df[col] < lo).sum())
        n_hi = int((df[col] > hi).sum())
        clipped[col] = {"lower": r(lo, 2), "upper": r(hi, 2), "below": n_lo, "above": n_hi}
    raw = pd.read_csv(DATA)
    return {
        "dropped": [{"name": c, "unique": int(raw[c].nunique()),
                     "share_unique": r(raw[c].nunique() / len(raw), 3)} for c in DROPPED],
        "clip_bounds": clipped,
        "features": [{"name": f, "note": FEATURE_NOTES[f]} for f in FEATURES],
        "split": {"train": 750, "test": 250, "stratified": True, "seed": SEED},
    }


# ----------------------------------------------------------------------------
# 4. Main
# ----------------------------------------------------------------------------
def main():
    OUT.mkdir(exist_ok=True)
    t0 = time.time()
    df = load_raw(DATA)
    y = df[TARGET].values
    X_train, X_test, y_train, y_test = train_test_split(
        df.drop(columns=[TARGET]), y, test_size=0.25, stratify=y, random_state=SEED)

    fb = FeatureBuilder().fit(X_train)
    A_train, A_test = fb.transform(X_train), fb.transform(X_test)

    results = {"meta": {"seed": SEED, "features": FEATURES}}
    print("profiling dataset ...")
    results["dataset"] = profile_dataset(df)
    results["eda"] = explore(df)
    results["preprocessing"] = preprocessing_report(X_train, fb)

    # --- from-scratch forest vs sklearn with identical settings -------------
    print("training from-scratch forest ...")
    t = time.time()
    scratch = ScratchForest(n_estimators=100, max_features="sqrt", random_state=SEED)
    scratch.fit(A_train.values, y_train)
    scratch_time = time.time() - t
    p_scratch = scratch.predict_proba(A_test.values)[:, 1]

    t = time.time()
    sk_same = RandomForestClassifier(n_estimators=100, max_features="sqrt",
                                     oob_score=True, random_state=SEED).fit(A_train, y_train)
    sk_time = time.time() - t
    p_sk = sk_same.predict_proba(A_test)[:, 1]

    # one worked example: the test row the scratch trees disagree on most,
    # which shows the vote doing real work rather than a unanimous 100-0
    all_votes = scratch.tree_votes(A_test.values)
    ex_i = int(np.argmin(np.abs((all_votes >= .5).mean(axis=0) - 0.5)))
    ex_row = A_test.values[ex_i]
    votes = all_votes[:, ex_i]
    results["scratch"] = {
        "params": {"n_estimators": 100, "max_features": "sqrt (= 3 of 9)", "max_depth": "None",
                   "criterion": "gini", "bootstrap": True},
        "scratch": {**metrics(y_test, p_scratch), "oob": r(scratch.oob_score_), "fit_seconds": r(scratch_time, 2),
                    "mean_depth": r(np.mean([t.depth() for t in scratch.trees_]), 1)},
        "sklearn": {**metrics(y_test, p_sk), "oob": r(sk_same.oob_score_), "fit_seconds": r(sk_time, 2),
                    "mean_depth": r(np.mean([e.get_depth() for e in sk_same.estimators_]), 1)},
        "importance": {f: [r(a), r(b)] for f, a, b in zip(
            FEATURES, scratch.feature_importances_, sk_same.feature_importances_)},
        "agreement": r(((p_scratch >= .5) == (p_sk >= .5)).mean()),
        "example": {
            "inputs": {f: r(v, 3) for f, v in zip(FEATURES, ex_row)},
            "truth": int(y_test[ex_i]),
            "tree_probs": [r(v, 3) for v in votes],
            "votes_click": int((votes >= .5).sum()),
            "mean_prob": r(votes.mean()),
        },
    }

    # --- hyperparameter tuning ---------------------------------------------
    print("randomized search ...")
    pipe = Pipeline([("features", FeatureBuilder()),
                     ("rf", RandomForestClassifier(random_state=SEED, n_jobs=-1))])
    space = {
        "rf__n_estimators": randint(100, 601),
        "rf__max_depth": [None, 4, 6, 8, 10, 12, 16],
        "rf__max_features": ["sqrt", "log2", 0.5, 0.7, None],
        "rf__min_samples_split": randint(2, 21),
        "rf__min_samples_leaf": randint(1, 11),
        "rf__bootstrap": [True, False],
        "rf__criterion": ["gini", "entropy"],
    }
    search = RandomizedSearchCV(pipe, space, n_iter=60, cv=CV, random_state=SEED, n_jobs=-1,
                                scoring={"roc_auc": "roc_auc", "accuracy": "accuracy", "f1": "f1"},
                                refit="roc_auc", return_train_score=True)
    t = time.time()
    search.fit(X_train, y_train)
    search_time = time.time() - t
    cvr = pd.DataFrame(search.cv_results_).sort_values("rank_test_roc_auc")

    def clean(p):
        return {k.replace("rf__", ""): (v if not isinstance(v, (np.integer, np.floating)) else v.item())
                for k, v in p.items()}

    trials = [{
        "rank": int(row.rank_test_roc_auc),
        "params": clean(row.params),
        "auc": r(row.mean_test_roc_auc), "auc_std": r(row.std_test_roc_auc),
        "acc": r(row.mean_test_accuracy), "f1": r(row.mean_test_f1),
        "train_auc": r(row.mean_train_roc_auc),
    } for row in cvr.itertuples()]

    best = search.best_estimator_
    best_params = clean(search.best_params_)

    # --- tuning curves (each varies one parameter around the best config) ----
    print("tuning curves ...")
    base_rf = dict(best.named_steps["rf"].get_params())
    A_train_np = A_train.values

    # OOB error as trees are added (needs bootstrap=True)
    warm = RandomForestClassifier(**{**base_rf, "bootstrap": True, "oob_score": True,
                                     "warm_start": True, "n_estimators": 20, "n_jobs": -1})
    oob_curve = []
    for n in [20, 30, 40, 60, 80, 100, 150, 200, 250, 300, 400, 500, 600]:
        warm.set_params(n_estimators=n)
        warm.fit(A_train_np, y_train)
        oob_curve.append([n, r(1 - warm.oob_score_)])

    def vcurve(param, values):
        rf = RandomForestClassifier(**{**base_rf, "n_jobs": -1})
        tr, te = validation_curve(rf, A_train_np, y_train, param_name=param,
                                  param_range=values, cv=CV, scoring="accuracy", n_jobs=-1)
        labels = ["None" if v is None else v for v in values]
        return [{"value": lab, "train": r(a.mean()), "cv": r(b.mean()), "cv_std": r(b.std())}
                for lab, a, b in zip(labels, tr, te)]

    depth_curve = vcurve("max_depth", [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, None])
    feat_curve = vcurve("max_features", [1, 2, 3, 4, 5, 6, 7, 8, 9])
    leaf_curve = vcurve("min_samples_leaf", [1, 2, 3, 5, 8, 12, 20, 30, 50])

    sizes, lc_tr, lc_te = learning_curve(best, X_train, y_train, cv=CV, n_jobs=-1,
                                         train_sizes=np.linspace(0.1, 1.0, 8), scoring="accuracy")
    results["tuning"] = {
        "space": {
            "n_estimators": "integer 100 – 600",
            "max_depth": "None, 4, 6, 8, 10, 12, 16",
            "max_features": "sqrt, log2, 0.5, 0.7, None (all)",
            "min_samples_split": "integer 2 – 20",
            "min_samples_leaf": "integer 1 – 10",
            "bootstrap": "True, False",
            "criterion": "gini, entropy",
        },
        "n_iter": 60, "folds": 5, "fits": 300, "refit_metric": "ROC-AUC",
        "seconds": r(search_time, 1),
        "best_params": best_params,
        "best_cv": {"auc": trials[0]["auc"], "acc": trials[0]["acc"], "f1": trials[0]["f1"]},
        "trials": trials,
        "oob_curve": oob_curve,
        "depth_curve": depth_curve,
        "features_curve": feat_curve,
        "leaf_curve": leaf_curve,
        "learning_curve": [{"size": int(s), "train": r(a.mean()), "cv": r(b.mean()), "cv_std": r(b.std())}
                           for s, a, b in zip(sizes, lc_tr, lc_te)],
    }

    # --- evaluation on the untouched test set -------------------------------
    print("evaluating ...")
    prob = best.predict_proba(X_test)[:, 1]
    pred = (prob >= .5).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_test, pred).ravel()
    fpr, tpr, _ = roc_curve(y_test, prob)
    prec, rec, _ = precision_recall_curve(y_test, prob)
    fold_scores = cross_validate(best, X_train, y_train, cv=CV, n_jobs=-1,
                                 scoring=["accuracy", "precision", "recall", "f1", "roc_auc"])

    test_rows = X_test.copy()
    test_rows["prob"] = prob
    test_rows["truth"] = y_test
    wrong = test_rows[(prob >= .5).astype(int) != y_test]
    misclassified = [{
        "time": r(w["Daily Time Spent on Site"], 2), "age": int(w["Age"]),
        "income": r(w["Area Income"], 0), "usage": r(w["Daily Internet Usage"], 2),
        "male": int(w["Male"]), "truth": int(w["truth"]), "prob": r(w["prob"], 3),
    } for _, w in wrong.iterrows()]

    results["evaluation"] = {
        "metrics": metrics(y_test, prob),
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "roc": thin_curve(fpr, tpr),
        "pr": thin_curve(rec[::-1], prec[::-1]),
        "pr_auc": r(auc(rec, prec)),
        "test": {"y": y_test.tolist(), "p": [r(v, 4) for v in prob]},
        "folds": {k.replace("test_", ""): [r(v) for v in vals]
                  for k, vals in fold_scores.items() if k.startswith("test_")},
        "misclassified": misclassified,
        "train_accuracy": r(accuracy_score(y_train, best.predict(X_train))),
    }

    # --- feature importance -------------------------------------------------
    print("feature importance ...")
    rf_final = best.named_steps["rf"]
    perm = permutation_importance(best, X_test, y_test, n_repeats=30, random_state=SEED,
                                  scoring="roc_auc", n_jobs=-1)
    # permutation_importance permutes raw columns; map raw → model features
    raw_cols = list(X_test.columns)
    perm_map = {c: (r(m), r(s)) for c, m, s in zip(raw_cols, perm.importances_mean, perm.importances_std)}
    results["importance"] = {
        "mdi": sorted([{"feature": f, "value": r(v)} for f, v in zip(FEATURES, rf_final.feature_importances_)],
                      key=lambda d: -d["value"]),
        "permutation": sorted([{"feature": c, "mean": m, "std": s} for c, (m, s) in perm_map.items()
                               if c not in DROPPED + [TARGET]],
                              key=lambda d: -d["mean"]),
    }

    # --- decision surface over the two strongest features --------------------
    # Other inputs are held at typical values; P(click) is averaged over the
    # first k trees so the dashboard can show the boundary smoothing as trees are added.
    nx = ny = 56
    t_grid = np.linspace(30, 92, nx)
    u_grid = np.linspace(100, 272, ny)
    T_, U_ = np.meshgrid(t_grid, u_grid)                 # rows = usage, cols = time on site
    fixed = {"Age": float(df["Age"].median()), "Area Income": float(df["Area Income"].median()),
             "Male": 0, "Timestamp": pd.Timestamp("2016-04-13 12:00")}
    grid_raw = pd.DataFrame({"Daily Time Spent on Site": T_.ravel(), "Daily Internet Usage": U_.ravel(), **fixed})
    G = best.named_steps["features"].transform(grid_raw).values
    per_tree = np.array([e.predict_proba(G)[:, 1] for e in rf_final.estimators_])
    cum = np.cumsum(per_tree, axis=0)
    results["surface"] = {
        "x": [r(t_grid[0], 2), r(t_grid[-1], 2)], "y": [r(u_grid[0], 2), r(u_grid[-1], 2)], "nx": nx, "ny": ny,
        "fixed": {"Age": fixed["Age"], "Area Income": r(fixed["Area Income"], 0)},
        "by_trees": {str(k): [r(v, 3) for v in cum[k - 1] / k] for k in (1, 3, 10, 30, len(per_tree))},
    }

    # --- partial dependence (manual: sweep one feature, average P(click)) ---
    pdp = {}
    A_full = fb.transform(X_train)
    for col in NUMERIC_RAW:
        grid = np.linspace(np.percentile(A_full[col], 2), np.percentile(A_full[col], 98), 30)
        curve = []
        for g in grid:
            Z = A_full.copy()
            Z[col] = g
            Z["Site Share"] = Z["Daily Time Spent on Site"] / Z["Daily Internet Usage"]
            curve.append([r(g, 2), r(rf_final.predict_proba(Z[FEATURES])[:, 1].mean())])
        pdp[col] = curve
    results["pdp"] = pdp

    # --- model comparison ---------------------------------------------------
    print("comparing models ...")
    scaled = lambda m: Pipeline([("f", FeatureBuilder()), ("s", StandardScaler()), ("m", m)])
    plain = lambda m: Pipeline([("f", FeatureBuilder()), ("m", m)])
    knn_k = max(range(3, 32, 2), key=lambda k: cross_val_score(
        scaled(KNeighborsClassifier(k)), X_train, y_train, cv=CV).mean())
    dt_d = max(range(2, 13), key=lambda d: cross_val_score(
        plain(DecisionTreeClassifier(max_depth=d, random_state=SEED)), X_train, y_train, cv=CV).mean())

    candidates = [
        ("Random Forest (tuned)", "ensemble · bagging", best),
        ("Random Forest (default)", "ensemble · bagging", plain(RandomForestClassifier(random_state=SEED))),
        ("Gradient Boosting", "ensemble · boosting", plain(GradientBoostingClassifier(random_state=SEED))),
        ("AdaBoost", "ensemble · boosting", plain(AdaBoostClassifier(random_state=SEED))),
        ("Logistic Regression", "linear", scaled(LogisticRegression(max_iter=1000))),
        ("SVM (RBF)", "kernel", scaled(CalibratedClassifierCV(SVC(random_state=SEED), ensemble=False))),
        (f"KNN (k={knn_k})", "instance-based", scaled(KNeighborsClassifier(knn_k))),
        ("Gaussian Naive Bayes", "probabilistic", plain(GaussianNB())),
        (f"Decision Tree (depth={dt_d})", "single tree", plain(DecisionTreeClassifier(max_depth=dt_d, random_state=SEED))),
    ]
    comparison, roc_overlay, test_preds = [], {}, {}
    for name, family, model in candidates:
        t = time.time()
        cv_acc = cross_val_score(model, X_train, y_train, cv=CV, n_jobs=-1)
        model.fit(X_train, y_train)
        fit_s = time.time() - t
        pm = model.predict_proba(X_test)[:, 1]
        test_preds[name] = (pm >= .5).astype(int)
        comparison.append({"model": name, "family": family, **metrics(y_test, pm),
                           "cv_mean": r(cv_acc.mean()), "cv_std": r(cv_acc.std()),
                           "train_acc": r(accuracy_score(y_train, model.predict(X_train))),
                           "seconds": r(fit_s, 2)})
        if name.startswith(("Random Forest (tuned)", "Logistic", "Decision Tree")):
            f_, t_, _ = roc_curve(y_test, pm)
            roc_overlay[name] = thin_curve(f_, t_, 80)
    test_preds["Random Forest (from scratch)"] = (p_scratch >= .5).astype(int)
    comparison.append({"model": "Random Forest (from scratch)", "family": "ensemble · bagging",
                       **metrics(y_test, p_scratch), "cv_mean": None, "cv_std": None,
                       "train_acc": r(accuracy_score(y_train, scratch.predict(A_train.values))),
                       "seconds": r(scratch_time, 2)})

    # With only 250 test rows, is any gap real? Wilson 95% interval on accuracy,
    # plus an exact McNemar test of each model against the tuned forest.
    n_test = len(y_test)
    ref_ok = test_preds["Random Forest (tuned)"] == y_test
    for m in comparison:
        ok = test_preds[m["model"]] == y_test
        p_hat, z = ok.mean(), 1.96
        centre = (p_hat + z * z / (2 * n_test)) / (1 + z * z / n_test)
        half = z * np.sqrt(p_hat * (1 - p_hat) / n_test + z * z / (4 * n_test ** 2)) / (1 + z * z / n_test)
        m["ci"] = [r(centre - half), r(centre + half)]
        b = int((ref_ok & ~ok).sum())     # forest right, other wrong
        c = int((~ref_ok & ok).sum())     # forest wrong, other right
        m["mcnemar"] = {"rf_only": b, "other_only": c,
                        "p": r(binomtest(b, b + c, 0.5).pvalue, 3) if b + c else 1.0}
    results["comparison"] = {"models": comparison, "roc_overlay": roc_overlay, "n_test": n_test}

    # --- one tree from the final forest, top levels, for the diagram --------
    est = rf_final.estimators_[0].tree_

    def export(node, depth):
        value = est.value[node][0]
        frac = float(value[1] / value.sum())
        d = {"samples": int(est.n_node_samples[node]), "p_click": r(frac, 3),
             "impurity": r(est.impurity[node], 3)}
        if est.children_left[node] == -1 or depth == 3:
            d["leaf"] = bool(est.children_left[node] == -1)
            return d
        d["feature"] = FEATURES[est.feature[node]]
        d["threshold"] = r(est.threshold[node], 2)
        d["left"] = export(est.children_left[node], depth + 1)
        d["right"] = export(est.children_right[node], depth + 1)
        return d

    results["tree"] = {"root": export(0, 0), "depth": int(rf_final.estimators_[0].get_depth()),
                       "leaves": int(rf_final.estimators_[0].get_n_leaves()),
                       "n_trees": int(rf_final.n_estimators)}

    # --- predictor form ranges ----------------------------------------------
    results["predictor"] = {
        "ranges": {c: {"min": r(df[c].min(), 2), "max": r(df[c].max(), 2), "median": r(df[c].median(), 2)}
                   for c in NUMERIC_RAW},
    }
    results["meta"]["seconds_total"] = r(time.time() - t0, 1)

    joblib.dump(best, OUT / "model.joblib")
    with open(OUT / "results.json", "w", encoding="utf-8") as fh:
        json.dump(results, fh, separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else str(o))
    print(f"done in {time.time() - t0:.1f}s")
    print("best params:", best_params)
    print("test metrics:", results["evaluation"]["metrics"])
    for m in comparison:
        print(f"  {m['model']:<30} acc={m['accuracy']:.3f} auc={m['roc_auc']:.3f} cv={m['cv_mean']}")


if __name__ == "__main__":
    main()
