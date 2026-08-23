using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Docsage.Api.Infrastructure;
using Docsage.Api.Models;

namespace Docsage.Api.Providers;

/// <summary>One retrieved passage handed to the answer provider, ordered like the citations array.</summary>
public sealed record AnswerPassage(int Number, string DocumentTitle, string Content, int? Page);

public sealed record ChatAnswerRequest(string Question, IReadOnlyList<AnswerPassage> Passages);

/// <summary>Streams the final answer text incrementally; the caller relays each piece as an SSE delta.</summary>
public interface IChatAnswerProvider
{
    IAsyncEnumerable<string> StreamAnswerAsync(ChatAnswerRequest request, CancellationToken ct = default);
}

/// <summary>
/// Demo-mode extractive answer: no LLM involved. Leads with an explicit demo-mode label, then
/// the first sentence of the top passages with [n] markers matching the citations array order.
/// </summary>
public sealed class DemoChatAnswerProvider : IChatAnswerProvider
{
    public async IAsyncEnumerable<string> StreamAnswerAsync(ChatAnswerRequest request, [EnumeratorCancellation] CancellationToken ct = default)
    {
        yield return "Demo mode — extractive answer.\n\n";

        if (request.Passages.Count == 0)
        {
            yield return $"No passages were retrieved for: {request.Question}";
            yield break;
        }

        yield return $"Based on {request.Passages.Count} retrieved passage{(request.Passages.Count == 1 ? "" : "s")}: ";
        foreach (var passage in request.Passages.Take(3))
        {
            var sentence = FirstSentence(passage.Content);
            yield return $"[{passage.Number}] {sentence} ";
            await Task.Yield();
        }
    }

    private static string FirstSentence(string content)
    {
        var text = content.ReplaceLineEndings(" ").Trim();
        if (text.Length <= 220)
            return text;
        var cut = text.IndexOf('.', 0, Math.Min(220, text.Length));
        return cut > 0 ? text[..(cut + 1)] : text[..220] + "…";
    }
}

/// <summary>
/// Real-mode grounded answer: OpenAI chat completions with stream:true, relaying content deltas.
/// The system prompt forbids ungrounded claims and requires [n] citations matching the
/// numbered passages / citations array.
/// </summary>
public sealed class OpenAiChatAnswerProvider(DocsageOptions options, HttpClient http) : IChatAnswerProvider
{
    public async IAsyncEnumerable<string> StreamAnswerAsync(ChatAnswerRequest request, [EnumeratorCancellation] CancellationToken ct = default)
    {
        var passages = request.Passages.Count == 0
            ? "(no passages retrieved)"
            : string.Join("\n\n", request.Passages.Select(p =>
                $"[{p.Number}] ({p.DocumentTitle}{(p.Page is int page ? $", page {page}" : "")})\n{p.Content}"));

        var body = JsonSerializer.Serialize(new
        {
            model = options.OpenAiChatModel,
            stream = true,
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content = """
                        You are DocSage, an internal document Q&A assistant. Answer strictly and only
                        from the numbered passages provided in the user message. Cite every claim with
                        [n] markers matching the passage numbers. If the passages do not contain the
                        answer, say so plainly. Be concise and professional.
                        """,
                },
                new { role = "user", content = $"Question: {request.Question}\n\nPassages:\n{passages}" },
            },
        });

        var baseUrl = options.OpenAiBaseUrl is { Length: > 0 } b ? b.TrimEnd('/') : "https://api.openai.com";
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/v1/chat/completions")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.OpenAiApiKey);
        httpRequest.Headers.Accept.ParseAdd("text/event-stream");

        using var response = await http.SendAsync(httpRequest, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (!line.StartsWith("data:", StringComparison.Ordinal))
                continue;
            var payload = line["data:".Length..].Trim();
            if (payload == "[DONE]")
                yield break;
            using var doc = JsonDocument.Parse(payload);
            if (doc.RootElement.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
            {
                var delta = choices[0];
                if (delta.TryGetProperty("delta", out var deltaObj) && deltaObj.TryGetProperty("content", out var content)
                    && content.ValueKind == JsonValueKind.String)
                {
                    var text = content.GetString();
                    if (!string.IsNullOrEmpty(text))
                        yield return text;
                }
            }
        }
    }
}

public static class ChatAnswerProviderExtensions
{
    public static IServiceCollection AddChatAnswerProviders(this IServiceCollection services)
    {
        services.AddSingleton<DemoChatAnswerProvider>();
        services.AddHttpClient<OpenAiChatAnswerProvider>();
        return services;
    }
}
