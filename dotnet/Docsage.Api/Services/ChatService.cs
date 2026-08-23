using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;
using Docsage.Api.Infrastructure;
using Docsage.Api.Models;
using Docsage.Api.Providers;
using Npgsql;

namespace Docsage.Api.Services;

/// <summary>SSE chat event per contract: delta / citations / done / error.</summary>
public sealed record ChatStreamEvent(
    string Type,
    string? Text = null,
    IReadOnlyList<CitationDto>? Citations = null,
    Guid? MessageId = null,
    string? Message = null);

/// <summary>
/// Orchestrates one chat turn: persist the user message, retrieve passages per scope, stream
/// answer deltas from the answer provider (OpenAI stream in real mode, extractive in demo mode),
/// then persist the assistant message with its citations and finish with done/message_id.
/// </summary>
public sealed class ChatService(
    NpgsqlConnection db,
    RetrievalService retrieval,
    DemoChatAnswerProvider demoAnswer,
    OpenAiChatAnswerProvider openAiAnswer,
    DocsageOptions options,
    ILogger<ChatService> logger)
{
    // citations jsonb must use the same snake_case keys as the SSE citations event
    private static readonly JsonSerializerOptions CitationJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public async IAsyncEnumerable<ChatStreamEvent> ProcessAsync(
        ChatSessionRow session, string content, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        // Yielding is not allowed inside try/catch, so the core pipeline runs unguarded and
        // failures surface as an error event from the manual enumerator below.
        await using var enumerator = CoreAsync(session, content, ct).GetAsyncEnumerator(ct);
        while (true)
        {
            ChatStreamEvent? evt = null;
            ChatStreamEvent? error = null;
            try
            {
                if (!await enumerator.MoveNextAsync())
                    break;
                evt = enumerator.Current;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Chat streaming failed for session {SessionId}", session.Id);
                error = new ChatStreamEvent("error", Message: ex.Message.Truncate(300));
            }
            if (error is not null)
            {
                yield return error;
                yield break;
            }
            if (evt is not null)
                yield return evt;
        }
    }

    private async IAsyncEnumerable<ChatStreamEvent> CoreAsync(
        ChatSessionRow session, string content, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        await db.ExecuteAsync(
            "INSERT INTO chat_messages (id, session_id, role, content, citations) VALUES (@Id, @SessionId, 'user', @Content, '[]'::jsonb)",
            new { Id = Guid.NewGuid(), SessionId = session.Id, Content = content });

        var answer = new StringWriter();
        Guid assistantMessageId = Guid.NewGuid();

        var retrieved = await retrieval.RetrieveAsync(session.UserId, session.Scope, content, ct);
        var citations = retrieved.Select((r, i) => new CitationDto(
            r.ChunkId.ToString(),
            r.DocumentId.ToString(),
            r.DocumentTitle,
            Snippet(r.Content),
            Math.Round(r.Score, 4),
            r.Page)).ToList();

        var passages = retrieved.Select((r, i) => new AnswerPassage(i + 1, r.DocumentTitle, r.Content, r.Page)).ToList();
        var provider = options.OpenAiConfigured && !options.EffectiveDemoMode
            ? (IChatAnswerProvider)openAiAnswer
            : demoAnswer;
        await foreach (var delta in provider.StreamAnswerAsync(new ChatAnswerRequest(content, passages), ct))
        {
            answer.Write(delta);
            yield return new ChatStreamEvent("delta", Text: delta);
        }

        await db.ExecuteAsync(
            "INSERT INTO chat_messages (id, session_id, role, content, citations) VALUES (@Id, @SessionId, 'assistant', @Content, @Citations::jsonb)",
            new
            {
                Id = assistantMessageId,
                SessionId = session.Id,
                    Content = answer.ToString(),
                    Citations = JsonSerializer.Serialize(citations, CitationJsonOptions),
            });

        yield return new ChatStreamEvent("citations", Citations: citations);
        yield return new ChatStreamEvent("done", MessageId: assistantMessageId);
    }

    private static string Snippet(string content)
    {
        var text = content.ReplaceLineEndings(" ").Trim();
        return text.Length <= 280 ? text : text[..280] + "…";
    }
}

public static class ChatServiceExtensions
{
    public static IServiceCollection AddChatService(this IServiceCollection services) =>
        services.AddScoped<ChatService>();
}
