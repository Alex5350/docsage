"""Agentic enrichment: summary, keywords, questions, image captions, table preambles.

The enrichment model follows the upload's provider family (Gemini flash for
``gemini``, gpt-5.6-terra for ``openai``); the demo path is deterministic and
extractive so the pipeline shape is identical without any API key.
"""

import base64
import json
import re
from dataclasses import dataclass, field

import openai
from google import genai
from google.genai import errors, types

from docsage_api.core.config import Settings
from docsage_api.services.extraction.base import ExtractedPart
from docsage_api.services.retry import call_with_retries

_RETRYABLE_HTTP = {408, 429, 500, 502, 503, 504}
_HTTP_TIMEOUT_S = 60.0

STOPOWORDS = frozenset(
    [
        "about", "above", "after", "again", "against", "along", "already", "also",
        "although", "always", "among", "around", "because", "before", "behind",
        "below", "beside", "between", "beyond", "both", "during", "each", "either",
        "enough", "every", "except", "following", "further", "having", "here",
        "herself", "himself", "itself", "just", "least", "less", "maybe", "might",
        "more", "most", "much", "must", "myself", "never", "other", "others",
        "ought", "ourselves", "outside", "over", "own", "rather", "really", "same",
        "shall", "should", "since", "some", "still", "their", "theirs", "them",
        "themselves", "there", "these", "those", "through", "under", "until",
        "upon", "what", "whatever", "when", "where", "which", "while", "whose",
        "within", "without", "would", "yourself",
    ]
)

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9'-]*")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass
class EnrichmentResult:
    """Everything the enrichment pass adds on top of the extracted parts."""

    summary: str = ""
    keywords: list[str] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)
    captions: dict[int, str] = field(default_factory=dict)  # part index -> caption
    table_preambles: dict[int, str] = field(default_factory=dict)  # part index -> one-liner


def first_sentences(text: str, count: int = 2) -> str:
    sentences = [s.strip() for s in _SENTENCE_RE.split(text.strip()) if s.strip()]
    return " ".join(sentences[:count])


def frequency_keywords(text: str, limit: int = 8) -> list[str]:
    counts: dict[str, int] = {}
    for word in _WORD_RE.findall(text.lower()):
        if len(word) <= 4 or word in STOPOWORDS:
            continue
        counts[word] = counts.get(word, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [word for word, _ in ranked[:limit]]


def _parse_json_object(text: str) -> dict | None:
    """Best-effort extraction of the first JSON object from model output."""
    start = text.find("{")
    if start < 0:
        return None
    for end in range(len(text), start, -1):
        if text[end - 1] != "}":
            continue
        try:
            parsed = json.loads(text[start:end])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _gemini_retryable(exc: Exception) -> bool:
    return isinstance(exc, errors.APIError) and exc.code in _RETRYABLE_HTTP


def _openai_retryable(exc: Exception) -> bool:
    return isinstance(exc, openai.APIStatusError) and exc.status_code in _RETRYABLE_HTTP


DOCUMENT_PASS_INSTRUCTIONS = (
    "You enrich enterprise documents for retrieval. Read the document excerpt and "
    "respond with ONLY a JSON object (no markdown fences) with keys: "
    '"summary" (2-3 sentence factual summary), "keywords" (up to 8 short lowercase '
    'keywords), "questions" (up to 5 hypothetical questions a user would ask).'
)
TABLE_PASS_INSTRUCTIONS = (
    "You describe data tables for retrieval. For each numbered table below, write one "
    "line (max 20 words) stating what the table contains. Respond with ONLY a JSON "
    'object mapping each table number to its one-line description, e.g. {"1": "..."}'
)
CAPTION_PROMPT = "Describe this image for retrieval in <=2 sentences."


class EnrichmentService:
    """Runs the enrichment passes for one document (family chosen by provider)."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._gemini: genai.Client | None = None
        self._openai: openai.OpenAI | None = None

    def enrich(self, title: str, parts: list[ExtractedPart], provider: str) -> EnrichmentResult:
        if provider == "demo":
            return self._demo(title, parts)
        if provider == "gemini":
            return self._gemini_passes(title, parts)
        if provider == "openai":
            return self._openai_passes(title, parts)
        raise ValueError(f"unknown provider family for enrichment: {provider!r}")

    # ---------------------------------------------------------------- demo

    def _demo(self, title: str, parts: list[ExtractedPart]) -> EnrichmentResult:
        texts = [p.content for p in parts if p.kind == "text" and p.content.strip()]
        tables = [p.content for p in parts if p.kind == "table" and p.content.strip()]
        summary = first_sentences(texts[0]) if texts else (
            first_sentences(tables[0]) if tables else title
        )
        keywords = frequency_keywords("\n".join(texts + tables) or title)
        questions = [f"What does {title} say about {keyword}?" for keyword in keywords[:3]]

        captions = {
            i: f"Image {p.filename}: chart or photograph extracted from {title} (demo caption)"
            for i, p in enumerate(parts)
            if p.kind == "image"
        }
        preambles = {i: f"Table from {title}." for i, p in enumerate(parts) if p.kind == "table"}
        return EnrichmentResult(
            summary=summary, keywords=keywords, questions=questions,
            captions=captions, table_preambles=preambles,
        )

    # -------------------------------------------------------------- shared

    def _fallback(self, title: str, parts: list[ExtractedPart]) -> EnrichmentResult:
        """Deterministic stand-ins used when an LLM response fails to parse."""
        base = self._demo(title, parts)
        return EnrichmentResult(
            summary=base.summary or title,
            keywords=base.keywords,
            questions=base.questions,
        )

    def _document_excerpt(self, parts: list[ExtractedPart], limit: int = 24_000) -> str:
        chunks: list[str] = []
        for part in parts:
            if part.kind == "image":
                continue
            sample = part.content[:8_000]
            chunks.append(sample if part.kind == "text" else f"[table]\n{sample}")
            if sum(len(c) for c in chunks) >= limit:
                break
        return "\n\n".join(chunks)[:limit]

    # -------------------------------------------------------------- gemini

    def _gemini_client(self) -> genai.Client:
        if self._gemini is None:
            self._gemini = genai.Client(
                api_key=self._settings.gemini_api_key,
                http_options=types.HttpOptions(timeout=_HTTP_TIMEOUT_S * 1000),
            )
        return self._gemini

    def _gemini_generate(self, contents: object, *, system: str) -> str:
        client = self._gemini_client()
        response = call_with_retries(
            lambda: client.models.generate_content(
                model=self._settings.gemini_vision_model,
                contents=contents,
                config=types.GenerateContentConfig(system_instruction=system),
            ),
            is_retryable=_gemini_retryable,
        )
        return (response.text or "").strip()

    def _gemini_passes(self, title: str, parts: list[ExtractedPart]) -> EnrichmentResult:
        excerpt = self._document_excerpt(parts)
        prompt = f"Document title: {title}\n\n{excerpt}"
        raw = self._gemini_generate(prompt, system=DOCUMENT_PASS_INSTRUCTIONS)
        parsed = _parse_json_object(raw)
        fallback = self._fallback(title, parts)
        if parsed is None:
            summary, keywords, questions = fallback.summary, fallback.keywords, fallback.questions
        else:
            summary = str(parsed.get("summary") or fallback.summary).strip()
            raw_keywords = parsed.get("keywords") or []
            keywords = [str(k).lower() for k in raw_keywords][:8] or fallback.keywords
            raw_questions = parsed.get("questions") or []
            questions = [str(q) for q in raw_questions][:5] or fallback.questions

        captions: dict[int, str] = {}
        for i, part in enumerate(parts):
            if part.kind != "image" or not part.image_bytes:
                continue
            seed = f" EXIF/extracted description: {part.content}" if part.content else ""
            image_part = types.Part.from_bytes(data=part.image_bytes, mime_type=part.mime)
            text = self._gemini_generate(
                [image_part, CAPTION_PROMPT + seed],
                system="You caption images for document retrieval.",
            )
            captions[i] = text or f"Image {part.filename} from {title}."

        preambles = self._table_preambles_gemini(title, parts)
        return EnrichmentResult(
            summary=summary, keywords=keywords, questions=questions,
            captions=captions, table_preambles=preambles,
        )

    def _table_preambles_gemini(self, title: str, parts: list[ExtractedPart]) -> dict[int, str]:
        table_indexes = [i for i, p in enumerate(parts) if p.kind == "table"]
        if not table_indexes:
            return {}
        listing = "\n\n".join(
            f"Table {n}:\n{parts[i].content[:4_000]}" for n, i in enumerate(table_indexes, start=1)
        )
        parsed = _parse_json_object(
            self._gemini_generate(f"Document: {title}\n\n{listing}", system=TABLE_PASS_INSTRUCTIONS)
        )
        preambles: dict[int, str] = {}
        for n, part_index in enumerate(table_indexes, start=1):
            description = ""
            if parsed is not None:
                value = parsed.get(str(n)) or parsed.get(n)
                if isinstance(value, str) and value.strip():
                    description = value.strip()
            preambles[part_index] = description or f"Table from {title}."
        return preambles

    # -------------------------------------------------------------- openai

    def _openai_client(self) -> openai.OpenAI:
        if self._openai is None:
            self._openai = openai.OpenAI(
                api_key=self._settings.openai_api_key or None,
                base_url=self._settings.openai_base_url or None,
                timeout=_HTTP_TIMEOUT_S,
            )
        return self._openai

    def _openai_respond(self, instructions: str, input_payload: object) -> str:
        client = self._openai_client()
        response = call_with_retries(
            lambda: client.responses.create(
                model=self._settings.openai_chat_model,
                instructions=instructions,
                input=input_payload,
            ),
            is_retryable=_openai_retryable,
        )
        return (response.output_text or "").strip()

    def _openai_passes(self, title: str, parts: list[ExtractedPart]) -> EnrichmentResult:
        excerpt = self._document_excerpt(parts)
        raw = self._openai_respond(
            DOCUMENT_PASS_INSTRUCTIONS, f"Document title: {title}\n\n{excerpt}"
        )
        parsed = _parse_json_object(raw)
        fallback = self._fallback(title, parts)
        if parsed is None:
            summary, keywords, questions = fallback.summary, fallback.keywords, fallback.questions
        else:
            summary = str(parsed.get("summary") or fallback.summary).strip()
            raw_keywords = [str(k).lower() for k in (parsed.get("keywords") or [])]
            keywords = raw_keywords[:8] or fallback.keywords
            raw_questions = [str(q) for q in (parsed.get("questions") or [])]
            questions = raw_questions[:5] or fallback.questions

        captions: dict[int, str] = {}
        for i, part in enumerate(parts):
            if part.kind != "image" or not part.image_bytes:
                continue
            data_url = f"data:{part.mime};base64,{base64.b64encode(part.image_bytes).decode()}"
            seed = f" EXIF/extracted description: {part.content}" if part.content else ""
            text = self._openai_respond(
                "You caption images for document retrieval.",
                [
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": CAPTION_PROMPT + seed},
                            {"type": "input_image", "image_url": data_url},
                        ],
                    }
                ],
            )
            captions[i] = text or f"Image {part.filename} from {title}."

        preambles = self._table_preambles_openai(title, parts)
        return EnrichmentResult(
            summary=summary, keywords=keywords, questions=questions,
            captions=captions, table_preambles=preambles,
        )

    def _table_preambles_openai(self, title: str, parts: list[ExtractedPart]) -> dict[int, str]:
        table_indexes = [i for i, p in enumerate(parts) if p.kind == "table"]
        if not table_indexes:
            return {}
        listing = "\n\n".join(
            f"Table {n}:\n{parts[i].content[:4_000]}" for n, i in enumerate(table_indexes, start=1)
        )
        parsed = _parse_json_object(
            self._openai_respond(TABLE_PASS_INSTRUCTIONS, f"Document: {title}\n\n{listing}")
        )
        preambles: dict[int, str] = {}
        for n, part_index in enumerate(table_indexes, start=1):
            description = ""
            if parsed is not None:
                value = parsed.get(str(n)) or parsed.get(n)
                if isinstance(value, str) and value.strip():
                    description = value.strip()
            preambles[part_index] = description or f"Table from {title}."
        return preambles
