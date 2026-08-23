using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Docsage.Api.Infrastructure;
using Docsage.Api.Services.Extraction;

namespace Docsage.Api.Services;

public sealed record EnrichmentPlan(
    string Summary,
    IReadOnlyList<string> Keywords,
    IReadOnlyList<string> Questions,
    IReadOnlyDictionary<int, string> Captions,
    IReadOnlyDictionary<int, string> TablePreambles);

/// <summary>
/// Deterministic enrichment for the .NET backend. The demo path is a byte-exact
/// port of the FastAPI reference (docs/CONTRACT.md, services/enrichment.py):
/// same summary derivation, same keyword regex and stopword list, same caption
/// and table-preamble strings — so the same document produces byte-identical
/// chunk embedding text, and therefore identical demo-provider vectors, on
/// either backend. Image captions upgrade to Gemini vision when a key is set.
/// </summary>
public sealed partial class Enricher(DocsageOptions options, IHttpClientFactory httpClientFactory)
{
    /// <summary>python STOPOWORDS in enrichment.py — mirrored exactly (parity requirement).</summary>
    private static readonly HashSet<string> Stopwords =
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
    ];

    public async Task<EnrichmentPlan> GenerateAsync(
        string title, IReadOnlyList<ExtractedPart> parts, CancellationToken ct = default)
    {
        var texts = parts.Where(p => p.Kind == PartKinds.Text && !string.IsNullOrWhiteSpace(p.Content))
            .Select(p => p.Content).ToList();
        var tables = parts.Where(p => p.Kind == PartKinds.Table && !string.IsNullOrWhiteSpace(p.Content))
            .Select(p => p.Content).ToList();

        var summary = texts.Count > 0 ? FirstSentences(texts[0])
            : tables.Count > 0 ? FirstSentences(tables[0])
            : title;
        var keywords = FrequencyKeywords(texts.Concat(tables).ToList());
        var questions = keywords.Take(3).Select(k => $"What does {title} say about {k}?").ToList();

        var captions = new Dictionary<int, string>();
        var preambles = new Dictionary<int, string>();
        for (var i = 0; i < parts.Count; i++)
        {
            if (parts[i].Kind == PartKinds.ImageDescription)
                captions[i] = $"Image {parts[i].ImageName}: chart or photograph extracted from {title} (demo caption)";
            else if (parts[i].Kind == PartKinds.Table)
                preambles[i] = $"Table from {title}.";
        }

        if (options.GeminiConfigured)
        {
            for (var i = 0; i < parts.Count; i++)
            {
                if (parts[i].Kind == PartKinds.ImageDescription && parts[i].ImageBytes is { Length: > 0 }
                    && await CaptionAsync(parts[i], ct) is { } caption)
                    captions[i] = caption;
            }
        }

        return new EnrichmentPlan(summary, keywords, questions, captions, preambles);
    }

    private async Task<string?> CaptionAsync(ExtractedPart image, CancellationToken ct)
    {
        try
        {
            var http = httpClientFactory.CreateClient("gemini");
            var url = $"https://generativelanguage.googleapis.com/v1beta/models/{options.GeminiVisionModel}:generateContent?key={options.GeminiApiKey}";
            var body = JsonSerializer.Serialize(new
            {
                contents = new object[]
                {
                    new
                    {
                        parts = new object[]
                        {
                            new { text = "Describe this image for retrieval in at most two sentences." },
                            new { inline_data = new { mime_type = image.ImageMime ?? "image/png", data = Convert.ToBase64String(image.ImageBytes!) } },
                        },
                    },
                },
            });
            using var response = await http.PostAsync(url, new StringContent(body, Encoding.UTF8, "application/json"), ct);
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var text = doc.RootElement.GetProperty("candidates")[0]
                .GetProperty("content").GetProperty("parts")[0]
                .GetProperty("text").GetString();
            return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        }
        catch (Exception)
        {
            return null;
        }
    }

    // ---------------------------------------------------- reference-parity helpers

    [GeneratedRegex(@"(?<=[.!?])\s+")]
    private static partial Regex SentenceSplitRegex();

    [GeneratedRegex(@"[A-Za-z][A-Za-z0-9'-]*")]
    private static partial Regex WordRegex();

    /// <summary>python first_sentences: split after .!? at whitespace, take N, join with spaces.</summary>
    internal static string FirstSentences(string text)
    {
        var sentences = SentenceSplitRegex()
            .Split(text.Trim())
            .Select(s => s.Trim())
            .Where(s => s.Length > 0)
            .Take(2)
            .ToList();
        return string.Join(" ", sentences);
    }

    /// <summary>python frequency_keywords: words of 5+ chars minus stopwords, most frequent first,
    /// ties broken alphabetically (ordinal), top 8.</summary>
    internal static IReadOnlyList<string> FrequencyKeywords(IReadOnlyList<string> texts)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var match in WordRegex().Matches(string.Join("\n", texts).ToLowerInvariant()).Cast<Match>())
        {
            var word = match.Value;
            if (word.Length <= 4 || Stopwords.Contains(word))
                continue;
            counts[word] = counts.TryGetValue(word, out var seen) ? seen + 1 : 1;
        }
        return counts
            .OrderByDescending(kv => kv.Value)
            .ThenBy(kv => kv.Key, StringComparer.Ordinal)
            .Take(8)
            .Select(kv => kv.Key)
            .ToList();
    }
}

public static class EnricherExtensions
{
    public static IServiceCollection AddEnricher(this IServiceCollection services) =>
        services.AddHttpClient("gemini").Services.AddSingleton<Enricher>();
}
