"""Two interchangeable math backends for running the network.

* NumpyOps — fast path (used whenever numpy is installed).
* PureOps  — pure Python fallback with ZERO third-party dependencies.
             Slower (~1-2 s per token) but proves the model has no
             hidden library requirement: any machine with Python 3 can run it.

Both expose exactly the same tiny vector API used by ai/model.py.
"""
from __future__ import annotations

import math

_C = math.sqrt(2.0 / math.pi)
_GELU_A = 0.044715


def has_numpy() -> bool:
    try:
        import numpy  # noqa: F401
        return True
    except ImportError:
        return False


def get_ops():
    return NumpyOps() if has_numpy() else PureOps()


# ----------------------------------------------------------------- numpy
class NumpyOps:
    name = "numpy"

    def prepare(self, arr):
        import numpy as np
        return np.asarray(arr, dtype=np.float32)

    def matvec(self, w, x):
        """x @ w  —  w has shape (in, out), x shape (in,)."""
        return x @ w

    def add(self, a, b):
        return a + b

    def dot(self, a, b):
        return float(a @ b)

    def scale(self, a, s):
        return a * s

    def layernorm(self, x, g, b, eps=1e-5):
        mu = x.mean()
        var = x.var()
        return g * ((x - mu) / math.sqrt(var + eps)) + b

    def gelu(self, x):
        import numpy as np
        return 0.5 * x * (1.0 + np.tanh(_C * (x + _GELU_A * x * x * x)))

    def softmax(self, x):
        import numpy as np
        x = np.asarray(x, dtype=np.float32)
        e = np.exp(x - x.max())
        return e / e.sum()

    def concat(self, vecs):
        import numpy as np
        return np.concatenate(vecs)


# ---------------------------------------------------------- pure python
class PureOps:
    name = "pure-python"

    def prepare(self, arr):
        return [float(v) for v in arr]

    def matvec(self, w, x):
        """x @ w  —  w[i][o] = weight from input i to output o."""
        return [sum(xi * row[o] for xi, row in zip(x, w)) for o in range(len(w[0]))]

    def add(self, a, b):
        return [ai + bi for ai, bi in zip(a, b)]

    def dot(self, a, b):
        return sum(ai * bi for ai, bi in zip(a, b))

    def scale(self, a, s):
        return [ai * s for ai in a]

    def layernorm(self, x, g, b, eps=1e-5):
        n = len(x)
        mu = sum(x) / n
        var = sum((xi - mu) ** 2 for xi in x) / n
        inv = 1.0 / math.sqrt(var + eps)
        return [g[i] * (xi - mu) * inv + b[i] for i, xi in enumerate(x)]

    def gelu(self, x):
        return [0.5 * xi * (1.0 + math.tanh(_C * (xi + _GELU_A * xi * xi * xi)))
                for xi in x]

    def softmax(self, x):
        m = max(x)
        e = [math.exp(xi - m) for xi in x]
        s = sum(e)
        return [ei / s for ei in e]

    def concat(self, vecs):
        return [x for v in vecs for x in v]
