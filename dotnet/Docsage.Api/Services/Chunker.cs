using Docsage.Api.Services.Extraction;

namespace Docsage.Api.Services;

public sealed record ChunkPlan(int Ordinal, string Content, string Kind, int? Page, int TokenCount);

/// <summary>
/// Chunks parts into ~1100-token pieces using the chars/4 estimate (4400 chars nominal) with a
/// 150-token (600 char) overlap and a 4000-character hard cap per chunk.
/// </summary>
public sealed class Chunker
{
    public const int TargetTokens = 1100;
    public const int OverlapTokens = 150;
    public const int MaxChars = 4000;

    public static IReadOnlyList<ChunkPlan> Chunk(IReadOnlyList<ExtractedPart> parts)
    {
        var overlapChars = OverlapTokens * 4;
        var chunks = new List<ChunkPlan>();
        foreach (var part in parts)
        {
            var content = part.Content.Trim();
            if (content.Length == 0)
                continue;
            if (content.Length <= MaxChars)
            {
                chunks.Add(Make(chunks.Count, content, part));
                continue;
            }
            var start = 0;
            while (start < content.Length)
            {
                var end = Math.Min(start + MaxChars, content.Length);
                chunks.Add(Make(chunks.Count, content[start..end], part));
                if (end == content.Length)
                    break;
                start = end - overlapChars;
            }
        }
        return chunks;

        static ChunkPlan Make(int ordinalZeroBased, string content, ExtractedPart part) =>
            new(ordinalZeroBased + 1, content, part.Kind, part.Page, Math.Max(1, content.Length / 4));
    }
}
