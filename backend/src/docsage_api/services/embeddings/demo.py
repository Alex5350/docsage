"""Deterministic offline embedding provider — implements docs/CONTRACT.md appendix EXACTLY.

The algorithm is the single source of demo-vector truth shared (byte-identical)
with the .NET parity backend: sha256-seeded dual xorshift64star generators,
uniform components in [-0.5, 0.5), L2-normalized, rounded half-away-from-zero
to 7 decimals.
"""

import hashlib
import math
import struct

DIMENSIONS = 1536
MODEL_ID = "demo-v1"

_MASK64 = (1 << 64) - 1
_MULTIPLIER = 0x2545F4914F6CDD1D
_FRACTION_SCALE = 1.0 / float(1 << 53)  # 2^53


class _Xorshift64Star:
    """One 64-bit xorshift64star generator (state wraps mod 2^64)."""

    __slots__ = ("state",)

    def __init__(self, seed: int) -> None:
        self.state = seed & _MASK64

    def next(self) -> int:
        state = self.state
        state ^= state >> 12
        state = (state ^ ((state << 25) & _MASK64)) & _MASK64
        state ^= state >> 27
        self.state = state
        return (state * _MULTIPLIER) & _MASK64


def _round_half_away_from_zero(x: float) -> float:
    return math.copysign(math.floor(abs(x) * 1e7 + 0.5), x) / 1e7


def embed_text(text: str) -> list[float]:
    """Compute the 1536-dim demo vector for ``text`` (pure stdlib, deterministic)."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    seed0, seed1 = struct.unpack(">QQ", digest[:16])  # uint64 big-endian halves
    gen_a = _Xorshift64Star(seed0)
    gen_b = _Xorshift64Star(seed1)

    values = [0.0] * DIMENSIONS
    for i in range(DIMENSIONS):
        gen = gen_a if i % 2 == 0 else gen_b  # even -> A, odd -> B
        fraction = (gen.next() >> 11) * _FRACTION_SCALE  # 53-bit mantissa in [0,1)
        values[i] = fraction - 0.5

    norm = math.sqrt(math.fsum(v * v for v in values))
    if norm == 0.0:  # pragma: no cover - unreachable for sha256-derived seeds
        norm = 1.0
    return [_round_half_away_from_zero(v / norm) for v in values]


class DemoEmbeddingProvider:
    """Offline provider: hash-derived vectors with no semantic signal, but stable."""

    name = "demo"
    model_id = MODEL_ID

    def embed_documents(self, texts: list[str], title: str) -> list[list[float]]:
        return [embed_text(t) for t in texts]  # title pairing is a no-op in demo space

    def embed_query(self, text: str) -> list[float]:
        return embed_text(text)

    def embed_image(self, data: bytes, mime: str) -> list[float] | None:
        return None  # demo cannot embed pixels; captions carry image content
