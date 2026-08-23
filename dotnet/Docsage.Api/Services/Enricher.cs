using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Docsage.Api.Infrastructure;
using Docsage.Api.Services.Extraction;

namespace Docsage.Api.Services;

public sealed record EnrichmentPlan(
    string Summary,
    string Keywords,
    string Questions,
    IReadOnlyList<string> ImageCaptions);

/// <summary>
/// Enrichment stand-ins for the .NET backend, deliberately simpler than the python agent but
/// storing the same enrichment kinds: summary (first two sentences of the first text part),
/// keywords (top frequent non-stopwords), one canned question per document, and image captions
/// via Gemini vision when GEMINI_API_KEY is set (placeholder text otherwise).
/// </summary>
public sealed class Enricher(DocsageOptions options, IHttpClientFactory httpClientFactory)
{
    private static readonly HashSet<string> Stopwords =
    [
        "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is", "it",
        "its", "of", "on", "or", "such", "that", "the", "their", "then", "there", "these", "they",
        "this", "to", "was", "will", "with", "we", "you", "your", "our", "from", "not", "can", "all",
        "has", "have", "had", "been", "were", "which", "what", "when", "where", "who", "how", "why",
    ];

    public async Task<EnrichmentPlan> GenerateAsync(
        string title, IReadOnlyList<ExtractedPart> parts, CancellationToken ct = default)
    {
        var textParts = parts.Where(p => p.Kind == PartKinds.Text).Select(p => p.Content).ToList();
        var summary = FirstSentences(string.Join("\n", textParts), 2);
        if (summary.Length == 0)
            summary = title;
        var keywords = TopKeywords(textParts, 8);
        var questions = $"What is \"{title}\" about and who should read it?";

        var captions = new List<string>();
        foreach (var image in parts.Where(p => p.Kind == PartKinds.ImageDescription))
        {
            var caption = options.GeminiConfigured && image.ImageBytes is { Length: > 0 }
                ? await CaptionAsync(image, ct)
                : null;
            captions.Add(caption ?? $"Image: {image.ImageName ?? "unnamed"} (caption unavailable without Gemini vision)");
        }
        return new EnrichmentPlan(summary, string.Join(", ", keywords), questions, captions);
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
                            new { text = "Describe this image in one concise sentence for a document search index." },
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

    private static string FirstSentences(string text, int count)
    {
        var trimmed = text.ReplaceLineEndings(" ").Trim();
        if (trimmed.Length == 0)
            return string.Empty;
        var found = 0;
        for (var i = 0; i < trimmed.Length && found < count; i++)
        {
            if (trimmed[i] is '.' or '!' or '?')
            {
                found++;
                if (found == count || i + 1 >= trimmed.Length)
                    return trimmed[..Math.Min(i + 1, trimmed.Length)];
            }
        }
        return trimmed;
    }

    private static IEnumerable<string> TopKeywords(IReadOnlyList<string> texts, int count)
    {
        var frequencies = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var text in texts)
        {
            foreach (var word in text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
            {
                var normalized = word.Trim(['.', ',', ';', ':', '!', '?', '"', '\'', '(', ')', '[', ']', '{', '}']).ToLowerInvariant();
                if (normalized.Length < 4 || Stopwords.Contains(normalized))
                    continue;
                frequencies[normalized] = frequencies.TryGetValue(normalized, out var seen) ? seen + 1 : 1;
            }
        }
        return frequencies.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal).Take(count).Select(kv => kv.Key);
    }
}

public static class EnricherExtensions
{
    public static IServiceCollection AddEnricher(this IServiceCollection services) =>
        services.AddHttpClient("gemini").Services.AddSingleton<Enricher>();
}
