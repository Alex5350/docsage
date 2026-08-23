using System.Text.Json;
using Dapper;
using Docsage.Api.Infrastructure;
using Docsage.Api.Models;
using Docsage.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Npgsql;

namespace Docsage.Api.Endpoints;

public sealed record CreateChatSessionRequest(string Scope);
public sealed record SendChatMessageRequest(string Content);

public static class ChatEndpoints
{
    public static IEndpointRouteBuilder MapChatEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/chat/sessions");

        group.MapPost("/", async (CreateChatSessionRequest body, ISessionService sessions, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            var scope = string.IsNullOrEmpty(body.Scope) ? "personal" : body.Scope;
            if (scope is not ("personal" or "admin"))
                return ApiError.Validation("scope must be 'personal' or 'admin'");
            if (scope == "admin" && user.Role != "admin")
                return ApiError.Forbidden("Admin role required for admin chat scope");

            var session = await db.QuerySingleAsync<ChatSessionRow>(
                """
                INSERT INTO chat_sessions (id, user_id, scope) VALUES (@Id, @UserId, @Scope)
                RETURNING id, user_id, scope, title, created_at
                """,
                new { Id = Guid.NewGuid(), UserId = user.Id, Scope = scope });
            var dto = new ChatSessionDto(session.Id, session.Scope, session.Title, session.CreatedAt);
            return TypedResults.Created($"/api/chat/sessions/{session.Id}", dto);
        });

        group.MapGet("/", async (ISessionService sessions, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            var items = await db.QueryAsync<ChatSessionDto>(
                "SELECT id, scope, title, created_at FROM chat_sessions WHERE user_id = @UserId ORDER BY created_at DESC",
                new { UserId = user.Id });
            return Results.Ok(new { items });
        });

        group.MapGet("/{id:guid}/messages", async (Guid id, ISessionService sessions, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            if (await FindOwnSessionAsync(db, id, user) is null)
                return ApiError.NotFound("Chat session not found");

            var rows = await db.QueryAsync<ChatMessageRow>(
                "SELECT id, session_id, role, content, citations::text AS citations, created_at FROM chat_messages WHERE session_id = @id ORDER BY created_at",
                new { id });
            return Results.Ok(new
            {
                items = rows.Select(r => new ChatMessageDto(
                    r.Id,
                    r.Role,
                    r.Content,
                    JsonDocument.Parse(r.Citations).RootElement.Clone(),
                    r.CreatedAt)).ToList(),
            });
        });

        group.MapPost("/{id:guid}/messages", async (Guid id, SendChatMessageRequest body, ISessionService sessions,
            ChatService chat, NpgsqlConnection db,
            Microsoft.Extensions.Options.IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions> jsonOptions) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            if (string.IsNullOrWhiteSpace(body.Content))
                return ApiError.Validation("content is required");
            if (await FindOwnSessionAsync(db, id, user) is not { } session)
                return ApiError.NotFound("Chat session not found");

            var serializerOptions = jsonOptions.Value.SerializerOptions;
            return Results.Stream(async stream =>
            {
                await using var writer = new StreamWriter(stream, leaveOpen: true);
                await foreach (var evt in chat.ProcessAsync(session, body.Content))
                {
                    await writer.WriteAsync("data: ");
                    await writer.WriteAsync(JsonSerializer.Serialize(evt, serializerOptions));
                    await writer.WriteAsync("\n\n");
                    await writer.FlushAsync();
                }
            }, "text/event-stream");
        });

        return app;
    }

    private static async Task<ChatSessionRow?> FindOwnSessionAsync(NpgsqlConnection db, Guid id, UserRow user) =>
        await db.QuerySingleOrDefaultAsync<ChatSessionRow>(
            "SELECT id, user_id, scope, title, created_at FROM chat_sessions WHERE id = @id AND user_id = @UserId",
            new { id, UserId = user.Id });
}
