using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Docsage.Api.Infrastructure;

namespace Docsage.Api.Providers;

/// <summary>
/// Google Gemini embeddings via generativelanguage batchEmbedContents, dimensionality
/// truncated to 1536. Documents use taskType RETRIEVAL_DOCUMENT, queries RETRIEVAL_QUERY.
/// Handles 429 with a single retry after the delay advertised by Retry-After (or 2s).
/// </summary>
public sealed class GeminiEmbeddingProvider(DocsageOptions options, HttpClient http) : IEmbeddingProvider
{
    private const int BatchSize = 100;

    private string Key => options.GeminiApiKey ?? throw new InvalidOperationException("GEMINI_API_KEY not configured");

    public string Name => "gemini";

    public async Task<double[]> EmbedQueryAsync(string text, CancellationToken ct = default)
    {
        var batch = await EmbedBatchAsync([text], "RETRIEVAL_QUERY", ct);
        return batch[0];
    }

    public async Task<IReadOnlyList<double[]>> EmbedDocumentsAsync(IReadOnlyList<string> texts, CancellationToken ct = default) =>
        await EmbedBatchAsync(texts, "RETRIEVAL_DOCUMENT", ct);

    private async Task<IReadOnlyList<double[]>> EmbedBatchAsync(IReadOnlyList<string> texts, string taskType, CancellationToken ct)
    {
        var results = new List<double[]>(texts.Count);
        foreach (var batch in texts.Chunk(BatchSize))
        {
            var body = new
            {
                requests = batch.Select(t => new
                {
                    model = $"models/{options.GeminiEmbeddingModel}",
                    content = new { parts = new[] { new { text = t } } },
                    taskType,
                    outputDimensionality = EmbeddingDimensions.Size,
                }),
            };

            using var response = await PostWithRateLimitRetryAsync(body, ct);
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            foreach (var embedding in doc.RootElement.GetProperty("embeddings").EnumerateArray())
            {
                results.Add(embedding.GetProperty("values").EnumerateArray().Select(e => e.GetDouble()).ToArray());
            }
        }
        return results;
    }

    private async Task<HttpResponseMessage> PostWithRateLimitRetryAsync(object body, CancellationToken ct)
    {
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{options.GeminiEmbeddingModel}:batchEmbedContents?key={Key}";
        var json = JsonSerializer.Serialize(body);
        var response = await http.PostAsync(url, new StringContent(json, Encoding.UTF8, "application/json"), ct);
        if (response.StatusCode != System.Net.HttpStatusCode.TooManyRequests)
            return response;

        var delay = TimeSpan.FromSeconds(2);
        if (response.Headers.TryGetValues("Retry-After", out var values))
            foreach (var value in values)
                if (double.TryParse(value, out var seconds))
                    delay = TimeSpan.FromSeconds(seconds);
        response.Dispose();
        await Task.Delay(delay, ct);
        return await http.PostAsync(url, new StringContent(json, Encoding.UTF8, "application/json"), ct);
    }
}
