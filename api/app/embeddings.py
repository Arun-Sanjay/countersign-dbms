"""Optional Voyage AI embeddings (VOYAGE_API_KEY). Without the key nothing here is called:
retrieval is keyword-only (search_chunks' full-text list) and still ranked.

Model: VOYAGE_MODEL (default voyage-4) at 1024 dimensions, the size of
artifact_chunk.embedding (vector(1024)); the model name is stored in embedding_model so
vectors from different models are never compared by accident.
Documents are embedded with input_type 'document', questions with 'query'.
"""

from __future__ import annotations

import httpx

from .config import Settings

URL = "https://api.voyageai.com/v1/embeddings"
DIMS = 1024
BATCH = 64


class EmbeddingError(RuntimeError):
    pass


def enabled(settings: Settings) -> bool:
    return bool(settings.voyage_api_key)


def embed(http: httpx.Client, settings: Settings, texts: list[str], input_type: str) -> list[list[float]]:
    if not settings.voyage_api_key:
        raise EmbeddingError("VOYAGE_API_KEY is not set")
    if not texts:
        return []
    try:
        r = http.post(URL, headers={"Authorization": f"Bearer {settings.voyage_api_key}"},
                      json={"input": texts, "model": settings.voyage_model, "input_type": input_type,
                            "output_dimension": DIMS}, timeout=60)
    except httpx.HTTPError as exc:
        raise EmbeddingError(f"Voyage unreachable ({type(exc).__name__})") from None
    if r.status_code != 200:
        raise EmbeddingError(f"Voyage answered HTTP {r.status_code}")
    data = sorted(r.json().get("data") or [], key=lambda d: d.get("index", 0))
    vectors = [d["embedding"] for d in data]
    if len(vectors) != len(texts) or any(len(v) != DIMS for v in vectors):
        raise EmbeddingError(f"Voyage returned {len(vectors)} vectors, expected {len(texts)} x {DIMS}")
    return vectors
