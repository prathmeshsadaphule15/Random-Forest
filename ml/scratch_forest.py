"""
Random Forest implemented from scratch with NumPy only.

Two pieces:
  ScratchTree    – a CART decision tree that splits on Gini impurity
  ScratchForest  – bagging of ScratchTrees with random feature subsets,
                   probability averaging, out-of-bag score and
                   impurity-based feature importance

Written for binary targets (0/1), which is all this project needs.
"""
import numpy as np


def gini(n_pos, n):
    """Gini impurity of a node holding n samples, n_pos of them positive."""
    if n == 0:
        return 0.0
    p = n_pos / n
    return 1.0 - p * p - (1.0 - p) * (1.0 - p)


class _Node:
    __slots__ = ("feature", "threshold", "left", "right", "prob", "n", "impurity")

    def __init__(self, prob, n, impurity):
        self.feature = None
        self.threshold = None
        self.left = None
        self.right = None
        self.prob = prob          # P(click) among samples reaching this node
        self.n = n
        self.impurity = impurity

    @property
    def is_leaf(self):
        return self.feature is None


class ScratchTree:
    def __init__(self, max_depth=None, min_samples_split=2, min_samples_leaf=1,
                 max_features=None, rng=None):
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.min_samples_leaf = min_samples_leaf
        self.max_features = max_features
        self.rng = rng if rng is not None else np.random.default_rng()

    def fit(self, X, y):
        self.n_features_ = X.shape[1]
        self.importance_ = np.zeros(self.n_features_)
        self._n_total = len(y)
        self.root_ = self._grow(X, y, depth=0)
        return self

    def _best_split(self, X, y):
        """Search every candidate threshold on a random subset of features.

        For one feature, sort the samples once; a running sum of positives then
        gives the class counts on each side of every possible cut in O(n).
        """
        n = len(y)
        k = self.max_features or self.n_features_
        candidates = self.rng.choice(self.n_features_, size=k, replace=False)

        parent = gini(y.sum(), n)
        best = (None, None, 0.0)            # feature, threshold, impurity decrease
        leaf = self.min_samples_leaf

        for f in candidates:
            order = np.argsort(X[:, f], kind="mergesort")
            xs, ys = X[order, f], y[order]
            pos_left = np.cumsum(ys)[:-1]            # positives left of cut i+1
            n_left = np.arange(1, n)
            n_right = n - n_left
            pos_right = ys.sum() - pos_left

            p_l = pos_left / n_left
            p_r = pos_right / n_right
            g_l = 1 - p_l ** 2 - (1 - p_l) ** 2
            g_r = 1 - p_r ** 2 - (1 - p_r) ** 2
            weighted = (n_left * g_l + n_right * g_r) / n

            # a cut is only valid between two different values and must leave
            # at least min_samples_leaf on each side
            valid = (xs[1:] != xs[:-1]) & (n_left >= leaf) & (n_right >= leaf)
            if not valid.any():
                continue
            weighted = np.where(valid, weighted, np.inf)
            i = int(np.argmin(weighted))
            gain = parent - weighted[i]
            if gain > best[2]:
                best = (f, (xs[i] + xs[i + 1]) / 2.0, gain)
        return best

    def _grow(self, X, y, depth):
        n = len(y)
        node = _Node(prob=y.mean(), n=n, impurity=gini(y.sum(), n))

        stop = (
            node.impurity == 0.0
            or n < self.min_samples_split
            or (self.max_depth is not None and depth >= self.max_depth)
        )
        if stop:
            return node

        f, thr, gain = self._best_split(X, y)
        if f is None:
            return node

        # weighted impurity decrease, as in sklearn's feature_importances_
        self.importance_[f] += gain * n / self._n_total
        mask = X[:, f] <= thr
        node.feature, node.threshold = f, thr
        node.left = self._grow(X[mask], y[mask], depth + 1)
        node.right = self._grow(X[~mask], y[~mask], depth + 1)
        return node

    def predict_proba_one(self, x):
        node = self.root_
        while not node.is_leaf:
            node = node.left if x[node.feature] <= node.threshold else node.right
        return node.prob

    def predict_proba(self, X):
        return np.array([self.predict_proba_one(x) for x in X])

    def depth(self, node=None):
        node = node or self.root_
        if node.is_leaf:
            return 0
        return 1 + max(self.depth(node.left), self.depth(node.right))


class ScratchForest:
    """Bagged ensemble of ScratchTrees.

    Each tree sees a bootstrap sample (rows drawn with replacement) and, at
    every split, only a random subset of features. Averaging many such
    de-correlated trees lowers variance compared with a single deep tree.
    """

    def __init__(self, n_estimators=100, max_depth=None, min_samples_split=2,
                 min_samples_leaf=1, max_features="sqrt", random_state=None):
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.min_samples_leaf = min_samples_leaf
        self.max_features = max_features
        self.random_state = random_state

    def _n_split_features(self, n_features):
        if self.max_features == "sqrt":
            return max(1, int(np.sqrt(n_features)))
        if self.max_features == "log2":
            return max(1, int(np.log2(n_features)))
        if isinstance(self.max_features, float):
            return max(1, int(self.max_features * n_features))
        if self.max_features is None:
            return n_features
        return int(self.max_features)

    def fit(self, X, y):
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=int)
        n, p = X.shape
        rng = np.random.default_rng(self.random_state)
        k = self._n_split_features(p)

        self.trees_ = []
        oob_sum = np.zeros(n)
        oob_cnt = np.zeros(n)

        for _ in range(self.n_estimators):
            idx = rng.integers(0, n, size=n)                 # bootstrap sample
            oob = np.setdiff1d(np.arange(n), idx)            # ~36.8% left out
            tree = ScratchTree(self.max_depth, self.min_samples_split,
                               self.min_samples_leaf, k, rng)
            tree.fit(X[idx], y[idx])
            self.trees_.append(tree)
            if len(oob):
                oob_sum[oob] += tree.predict_proba(X[oob])
                oob_cnt[oob] += 1

        seen = oob_cnt > 0
        oob_pred = (oob_sum[seen] / oob_cnt[seen]) >= 0.5
        self.oob_score_ = float((oob_pred == y[seen]).mean())

        imp = np.mean([t.importance_ for t in self.trees_], axis=0)
        self.feature_importances_ = imp / imp.sum()
        return self

    def tree_votes(self, X):
        """Matrix (n_trees, n_samples) of each tree's P(click)."""
        X = np.asarray(X, dtype=float)
        return np.array([t.predict_proba(X) for t in self.trees_])

    def predict_proba(self, X):
        p = self.tree_votes(X).mean(axis=0)
        return np.column_stack([1 - p, p])

    def predict(self, X, threshold=0.5):
        return (self.predict_proba(X)[:, 1] >= threshold).astype(int)
