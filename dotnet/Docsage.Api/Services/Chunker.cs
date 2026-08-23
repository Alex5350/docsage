using Docsage.Api.Services.Extraction;

namespace Docsage.Api.Services;

public sealed record ChunkPlan(int Ordinal, string Content, string Kind, int? Page, int TokenCount);

/// <summary>
/// Reference-parity chunker (services/ingestion.py): fixed 4000-char windows
/// advancing by 3400 (600-char overlap) — window starts at 0, 3400, 6800, …
/// like python's range(0, len, step) — parts at or under the cap pass through
/// whole, content is NOT trimmed, and table pieces carry their enrichment
/// preamble. Image parts become single image_description chunks (caption text).
/// </summary>
public sealed class Chunker
{
    public const int MaxChars = 4_000;
    public const int OverlapChars = 600;
    private const int Step = MaxChars - OverlapChars;

    public static IReadOnlyList<ChunkPlan> Chunk(
        IReadOnlyList<ExtractedPart> parts, IReadOnlyDictionary<int, string> tablePreambles)
    {
        var chunks = new List<ChunkPlan>();
        for (var i = 0; i < parts.Count; i++)
        {
            var part = parts[i];
            if (part.Kind == PartKinds.ImageDescription)
            {
                chunks.Add(Make(chunks.Count, part.Content, part));
                continue;
            }
            var preamble = tablePreambles.TryGetValue(i, out var pre) ? pre : null;
            foreach (var piece in ChunkText(part.Content))
            {
                var body = part.Kind == PartKinds.Table && preamble is not null
                    ? $"{preamble}\n\n{piece}"
                    : piece;
                chunks.Add(Make(chunks.Count, body, part));
            }
        }
        return chunks;

        static ChunkPlan Make(int ordinal, string content, ExtractedPart part) =>
            new(ordinal, content, part.Kind, part.Page, content.Length / 4);
    }

    private static IEnumerable<string> ChunkText(string content)
    {
        if (content.Length <= MaxChars)
        {
            yield return content;
            yield break;
        }
        for (var start = 0; start < content.Length; start += Step)
            yield return content[start..Math.Min(start + MaxChars, content.Length)];
    }
}
