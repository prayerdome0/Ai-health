"""A micro reverse-mode automatic-differentiation engine, written from scratch.

This is what makes Pulse a *real* neural network rather than a wrapper:
every weight is learned by backpropagation computed right here —
forward nodes record how they were made, gradients flow backwards through
the recorded graph, and an AdamW optimizer updates the parameters.

Supports exactly the ops a GPT needs: add, mul, matmul, batched matmul,
reshape, transpose of last two dims, GELU, layernorm, causal softmax,
embedding lookup and cross-entropy loss.
"""
from __future__ import annotations

import math
from typing import Callable

import numpy as np


def _unbroadcast(grad: np.ndarray, shape: tuple) -> np.ndarray:
    """Sum `grad` down to `shape` (the reverse of numpy broadcasting)."""
    while grad.ndim > len(shape):
        grad = grad.sum(axis=0)
    for ax, size in enumerate(shape):
        if size == 1 and grad.shape[ax] != 1:
            grad = grad.sum(axis=ax, keepdims=True)
    return grad


class Tensor:
    __slots__ = ("value", "grad", "_parents", "_backward")

    def __init__(self, value, parents: tuple = (), backward: Callable | None = None):
        self.value = np.asarray(value)   # dtype preserved (float32 for training, float64 for tests)
        self.grad = np.zeros_like(self.value)
        self._parents = parents          # tuple[Tensor, ...]
        self._backward = backward        # propagates self.grad into parents

    # ------------------------------------------------- graph traversal
    def _topo(self) -> list["Tensor"]:
        topo, seen = [], set()

        def visit(t: "Tensor"):
            if id(t) in seen:
                return
            seen.add(id(t))
            for p in t._parents:
                visit(p)
            topo.append(t)

        visit(self)
        return topo

    def backward(self) -> None:
        """Seed with 1.0 and push gradients through the whole graph."""
        self.grad = np.ones_like(self.value)
        for node in reversed(self._topo()):
            if node._backward is not None:
                node._backward()

    def release_graph(self) -> None:
        """Break the graph's reference cycles so every node and its arrays
        are freed immediately by reference counting instead of waiting for
        the cyclic garbage collector. Call right after backward()."""
        for node in self._topo():
            node._parents = ()
            node._backward = None

    # ------------------------------------------------------------ ops
    def __add__(self, other):
        other = other if isinstance(other, Tensor) else Tensor(other)
        out = Tensor(self.value + other.value, (self, other))

        def _bw():
            self.grad += _unbroadcast(out.grad, self.value.shape)
            other.grad += _unbroadcast(out.grad, other.value.shape)
        out._backward = _bw
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Tensor) else Tensor(other)
        out = Tensor(self.value * other.value, (self, other))

        def _bw():
            self.grad += _unbroadcast(out.grad * other.value, self.value.shape)
            other.grad += _unbroadcast(out.grad * self.value, other.value.shape)
        out._backward = _bw
        return out

    def matmul(self, other):
        """Matrix multiply. Supports 2-D@2-D and batched(...,n,m) @ 2-D(m,k)."""
        out = Tensor(self.value @ other.value, (self, other))

        def _bw():
            dy, a, b = out.grad, self.value, other.value
            if a.ndim == 2 and b.ndim == 2:
                self.grad += dy @ b.T
                other.grad += a.T @ dy
            elif b.ndim == 2:                     # (…,n,m) @ (m,k)
                self.grad += dy @ b.T
                other.grad += (a.reshape(-1, a.shape[-1]).T
                               @ dy.reshape(-1, dy.shape[-1]))
            else:                                 # batched @ batched (bmm-style)
                self.grad += dy @ np.swapaxes(b, -1, -2)
                other.grad += np.swapaxes(a, -1, -2) @ dy
        out._backward = _bw
        return out

    def bmm(self, other):
        """Batched matmul over the last two dims: (B,n,m) @ (B,m,k)."""
        out = Tensor(self.value @ other.value, (self, other))

        def _bw():
            self.grad += out.grad @ np.swapaxes(other.value, -1, -2)
            other.grad += np.swapaxes(self.value, -1, -2) @ out.grad
        out._backward = _bw
        return out

    def reshape(self, *shape):
        out = Tensor(self.value.reshape(*shape), (self,))

        def _bw():
            self.grad += out.grad.reshape(self.value.shape)
        out._backward = _bw
        return out

    def swap_last(self):
        """Swap the last two axes ((B,n,m) -> (B,m,n))."""
        out = Tensor(np.swapaxes(self.value, -1, -2), (self,))

        def _bw():
            self.grad += np.swapaxes(out.grad, -1, -2)
        out._backward = _bw
        return out

    def transpose(self, *axes):
        """Generic transpose with an arbitrary axis permutation."""
        out = Tensor(self.value.transpose(*axes), (self,))

        def _bw():
            self.grad += out.grad.transpose(*np.argsort(axes))
        out._backward = _bw
        return out

    def pick(self, i: int):
        """Select [:, i] along axis 1 (used to split q/k/v), grad flows back."""
        out = Tensor(self.value[:, i], (self,))

        def _bw():
            self.grad[:, i] += out.grad
        out._backward = _bw
        return out

    def slice_rows(self, n: int):
        """First n rows along axis 0 (used for positional embeddings)."""
        out = Tensor(self.value[:n], (self,))

        def _bw():
            self.grad[:n] += out.grad
        out._backward = _bw
        return out

    def gelu(self):
        """GELU activation, tanh approximation (same as GPT-2 / BERT)."""
        x = self.value
        c = math.sqrt(2.0 / math.pi)
        u = c * (x + 0.044715 * x * x * x)
        t = np.tanh(u)
        out = Tensor(0.5 * x * (1.0 + t), (self,))

        def _bw():
            d = 0.5 * (1.0 + t) + 0.5 * x * (1.0 - t * t) * c * (1.0 + 3 * 0.044715 * x * x)
            self.grad += out.grad * d
        out._backward = _bw
        return out

    def layernorm(self, gain, bias, eps: float = 1e-5):
        """LayerNorm over the last dimension. gain/bias are Tensors (d,)."""
        x = self.value
        mu = x.mean(axis=-1, keepdims=True)
        var = x.var(axis=-1, keepdims=True)
        xhat = (x - mu) / np.sqrt(var + eps)
        out = Tensor(gain.value * xhat + bias.value, (self, gain, bias))

        def _bw():
            dy = out.grad
            n = x.shape[-1]
            self.grad += (gain.value / np.sqrt(var + eps) * (dy -
                          dy.mean(axis=-1, keepdims=True)
                          - xhat * (dy * xhat).mean(axis=-1, keepdims=True)))
            gain.grad += (dy * xhat).sum(axis=tuple(range(dy.ndim - 1)))
            bias.grad += dy.sum(axis=tuple(range(dy.ndim - 1)))
        out._backward = _bw
        return out

    def causal_softmax(self, mask):
        """Row-wise softmax with an additive mask (-inf where masked).

        mask: np.bool_ array broadcastable to out.shape; True = allowed.
        """
        x = np.where(mask, self.value, np.float32(-1e9))
        x = x - x.max(axis=-1, keepdims=True)
        e = np.exp(x)
        p = e / e.sum(axis=-1, keepdims=True)
        out = Tensor(p, (self,))

        def _bw():
            g = np.where(mask, out.grad, np.float32(0.0))
            self.grad += p * (g - (g * p).sum(axis=-1, keepdims=True))
        out._backward = _bw
        return out

    def embed(self, weight):
        """Embedding lookup: self holds int indices, weight is (V, d)."""
        out = Tensor(weight.value[self.value.astype(np.int64)], (self, weight))

        def _bw():
            np.add.at(weight.grad, self.value.astype(np.int64).reshape(-1),
                      out.grad.reshape(-1, out.grad.shape[-1]))
        out._backward = _bw
        return out

    def cross_entropy(self, targets):
        """Mean cross-entropy. self: (N, V) logits, targets: (N,) int labels."""
        x = self.value
        x = x - x.max(axis=-1, keepdims=True)
        logsumexp = np.log(np.exp(x).sum(axis=-1))
        n = x.shape[0]
        pick = x[np.arange(n), targets.astype(np.int64)]
        loss_val = float((logsumexp - pick).mean())
        out = Tensor(loss_val, (self,))          # float64 scalar: exact for grad checks

        def _bw():
            p = np.exp(x) / np.exp(x).sum(axis=-1, keepdims=True)
            d = p.copy()
            d[np.arange(n), targets.astype(np.int64)] -= 1.0
            self.grad += out.grad * d / n
        out._backward = _bw
        return out


class AdamW:
    """AdamW optimizer (Adam with decoupled weight decay) — from scratch."""

    def __init__(self, params: dict, lr: float, betas=(0.9, 0.95), eps=1e-8,
                 weight_decay: float = 0.01):
        self.params = params
        self.lr, self.betas, self.eps, self.wd = lr, betas, eps, weight_decay
        self.m = {k: np.zeros_like(v.value) for k, v in params.items()}
        self.v = {k: np.zeros_like(v.value) for k, v in params.items()}
        self.t = 0

    def step(self):
        self.t += 1
        b1, b2 = self.betas
        bc1 = 1.0 - b1 ** self.t
        bc2 = 1.0 - b2 ** self.t
        for k, p in self.params.items():
            g = p.grad
            self.m[k] = b1 * self.m[k] + (1 - b1) * g
            self.v[k] = b2 * self.v[k] + (1 - b2) * g * g
            mhat = self.m[k] / bc1
            vhat = self.v[k] / bc2
            p.value -= self.lr * (mhat / (np.sqrt(vhat) + self.eps)
                                  + self.wd * p.value)

    def zero_grad(self):
        for p in self.params.values():
            p.grad[...] = 0.0

    def clip_grad_norm(self, max_norm: float) -> float:
        total = math.sqrt(sum(float((p.grad ** 2).sum()) for p in self.params.values()))
        if total > max_norm and total > 0:
            scale = max_norm / total
            for p in self.params.values():
                p.grad *= scale
        return total
