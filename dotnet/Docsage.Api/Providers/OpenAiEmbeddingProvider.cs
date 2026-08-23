using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Docsage.Api.Infrastructure;

namespace Docsage.Api.Providers;

/// <summary>
/// OpenAI (or OpenAI-compatible via OPENAI_BASE_URL) embeddings with Matryoshka truncation to
/// 1536 dimensions. Authorization: Bearer OPENAI_API_KEY. Handles 429 with a single retry.
/// </summary>
public sealed class OpenAiEmbeddingProvider(DocsageOptions options, HttpClient http) : IEmbeddingProvider
{
    private const int BatchSize = 100;

    private string BaseUrl => (options.OpenAiBaseUrl is { Length: > 0 } b ? b.TrimEnd('/') : "https://api.openai.com");

    public string Name => "openai";
    public string ModelId => options.OpenAiEmbeddingModel;

    public async Task<double[]> EmbedQueryAsync(string text, CancellationToken ct = default)
    {
        var batch = await EmbedBatchAsync([text], ct);
        return batch[0];
    }

    public async Task<IReadOnlyList<double[]>> EmbedDocumentsAsync(IReadOnlyList<string> texts, CancellationToken ct = default) =>
        await EmbedBatchAsync(texts, ct);

    private async Task<IReadOnlyList<double[]>> EmbedBatchAsync(IReadOnlyList<string> texts, CancellationToken ct)
    {
        var results = new List<double[]>(texts.Count);
        foreach (var batch in texts.Chunk(BatchSize))
        {
            var body = new
            {
                model = options.OpenAiEmbeddingModel,
                input = batch,
                dimensions = EmbeddingDimensions.Size,
            };
            var json = JsonSerializer.Serialize(body);
            using var response = await PostWithRateLimitRetryAsync(json, ct);
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            results.AddRange(doc.RootElement.GetProperty("data")
                .EnumerateArray()
                .OrderBy(d => d.GetProperty("index").GetInt32())
                .Select(d => d.GetProperty("embedding").EnumerateArray().Select(e => e.GetDouble()).ToArray()));
        }
        return results;
    }

    private async Task<HttpResponseMessage> PostWithRateLimitRetryAsync(string json, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/v1/embeddings")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.OpenAiApiKey);
        var response = await http.SendAsync(request, ct);
        if (response.StatusCode != System.Net.HttpStatusCode.TooManyRequests)
            return response;

        var delay = TimeSpan.FromSeconds(2);
        if (response.Headers.TryGetValues("Retry-After", out var values))
            foreach (var value in values)
                if (double.TryParse(value, out var seconds))
                    delay = TimeSpan.FromSeconds(seconds);
        response.Dispose();

        using var retry = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/v1/embeddings")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        retry.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.OpenAiApiKey);
        return await http.SendAsync(retry, ct);
    }
}
