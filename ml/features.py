"""
Feature engineering for the Advertising click dataset.

The raw file has 10 columns. Three of them (Ad Topic Line, City, Country) are
free-text / near-unique identifiers, so they are dropped. The Timestamp is
broken into calendar parts, and one ratio feature is derived. Outlier bounds
are learned on the training split only, so no information leaks from test data.
"""
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

TARGET = "Clicked on Ad"

NUMERIC_RAW = ["Daily Time Spent on Site", "Age", "Area Income", "Daily Internet Usage"]
DROPPED = ["Ad Topic Line", "City", "Country"]

# Final model inputs, in order
FEATURES = [
    "Daily Time Spent on Site",
    "Age",
    "Area Income",
    "Daily Internet Usage",
    "Male",
    "Hour",
    "Day of Week",
    "Month",
    "Site Share",
]

FEATURE_NOTES = {
    "Daily Time Spent on Site": "Minutes per day the user spends on the publisher's site.",
    "Age": "User age in years.",
    "Area Income": "Average yearly income of the user's geographic area (USD).",
    "Daily Internet Usage": "Minutes per day the user spends online overall.",
    "Male": "1 if the user is male, 0 otherwise.",
    "Hour": "Hour of day (0-23) the ad was shown, from Timestamp.",
    "Day of Week": "Day the ad was shown (0 = Monday, 6 = Sunday), from Timestamp.",
    "Month": "Month the ad was shown (1-7 in this data), from Timestamp.",
    "Site Share": "Engineered: time on site / total internet time. How much of a "
                  "user's online day this site occupies.",
}


def load_raw(path):
    df = pd.read_csv(path)
    df["Timestamp"] = pd.to_datetime(df["Timestamp"])
    return df


class FeatureBuilder(BaseEstimator, TransformerMixin):
    """Turns a raw advertising dataframe into the model feature matrix.

    fit()       learns IQR clipping bounds for the numeric columns
    transform() builds calendar features, the Site Share ratio, and clips outliers
    """

    def __init__(self, iqr_factor=1.5, clip=True):
        self.iqr_factor = iqr_factor
        self.clip = clip

    def fit(self, X, y=None):
        self.bounds_ = {}
        for col in NUMERIC_RAW:
            q1, q3 = np.percentile(X[col], [25, 75])
            iqr = q3 - q1
            self.bounds_[col] = (q1 - self.iqr_factor * iqr, q3 + self.iqr_factor * iqr)
        return self

    def transform(self, X):
        X = X.copy()
        ts = pd.to_datetime(X["Timestamp"])
        out = pd.DataFrame(index=X.index)
        for col in NUMERIC_RAW:
            vals = X[col].astype(float)
            if self.clip:
                lo, hi = self.bounds_[col]
                vals = vals.clip(lo, hi)
            out[col] = vals
        out["Male"] = X["Male"].astype(int)
        out["Hour"] = ts.dt.hour
        out["Day of Week"] = ts.dt.day_of_week
        out["Month"] = ts.dt.month
        out["Site Share"] = out["Daily Time Spent on Site"] / out["Daily Internet Usage"]
        return out[FEATURES]

    def get_feature_names_out(self, input_features=None):
        return np.array(FEATURES)


def raw_row_from_inputs(values):
    """Build a one-row raw dataframe from the web form / API payload."""
    ts = pd.Timestamp(year=2016, month=int(values["Month"]), day=1, hour=int(values["Hour"]))
    # shift to the requested weekday within that month
    ts = ts + pd.Timedelta(days=(int(values["Day of Week"]) - ts.day_of_week) % 7)
    return pd.DataFrame([{
        "Daily Time Spent on Site": float(values["Daily Time Spent on Site"]),
        "Age": float(values["Age"]),
        "Area Income": float(values["Area Income"]),
        "Daily Internet Usage": float(values["Daily Internet Usage"]),
        "Male": int(values["Male"]),
        "Timestamp": ts,
    }])
