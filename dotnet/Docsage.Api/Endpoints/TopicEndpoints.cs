using Dapper;
using Docsage.Api.Infrastructure;
using Docsage.Api.Models;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Npgsql;

namespace Docsage.Api.Endpoints;

public sealed record CreateTopicRequest(string Name, string? Description);
public sealed record DesignateSmeRequest(Guid UserId);

public sealed record SmeListRow
{
    public Guid TopicId { get; init; }
    public Guid Id { get; init; }
    public string DisplayName { get; init; } = "";
    public string Email { get; init; } = "";
}

public static class TopicEndpoints
{
    public static IEndpointRouteBuilder MapTopicEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/topics");

        group.MapGet("/", async (ISessionService sessions, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is null)
                return ApiError.Unauthorized();

            var topics = (await db.QueryAsync<TopicRow>(
                "SELECT id, name, description, created_by, created_at FROM topics ORDER BY name")).ToList();
            var smes = await db.QueryAsync<SmeListRow>(
                """
                SELECT sd.topic_id, u.id, u.display_name, u.email
                FROM sme_designations sd JOIN users u ON u.id = sd.user_id
                """);
            var byTopic = smes.ToLookup(s => s.TopicId);
            return Results.Ok(new
            {
                items = topics.Select(t => new TopicDto(
                    t.Id,
                    t.Name,
                    t.Description,
                    [.. byTopic[t.Id].Select(s => new SmeDto(s.Id, s.DisplayName, s.Email))])).ToList(),
            });
        });

        group.MapPost("/", async (CreateTopicRequest body, ISessionService sessions, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            if (user.Role != "admin")
                return ApiError.Forbidden("Admin role required");
            if (string.IsNullOrWhiteSpace(body.Name))
                return ApiError.Validation("name is required");

            try
            {
                var topic = await db.QuerySingleAsync<TopicRow>(
                    """
                    INSERT INTO topics (id, name, description, created_by)
                    VALUES (@Id, @Name, @Description, @CreatedBy)
                    RETURNING id, name, description, created_by, created_at
                    """,
                    new { Id = Guid.NewGuid(), Name = body.Name.Trim(), Description = body.Description ?? "", CreatedBy = user.Id });
                return TypedResults.Created($"/api/topics/{topic.Id}", new { id = topic.Id, name = topic.Name, description = topic.Description });
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return ApiError.Conflict("Topic name already exists");
            }
        });

        group.MapPost("/{id:guid}/smes", async (Guid id, DesignateSmeRequest body, ISessionService sessions, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            if (user.Role != "admin")
                return ApiError.Forbidden("Admin role required");
            if (await db.QuerySingleOrDefaultAsync<Guid?>("SELECT id FROM topics WHERE id = @id", new { id }) is null)
                return ApiError.NotFound("Topic not found");
            if (await db.QuerySingleOrDefaultAsync<Guid?>("SELECT id FROM users WHERE id = @UserId", new { body.UserId }) is null)
                return ApiError.NotFound("User not found");

            try
            {
                await db.ExecuteAsync(
                    """
                    INSERT INTO sme_designations (id, topic_id, user_id, designated_by)
                    VALUES (@Id, @TopicId, @UserId, @DesignatedBy)
                    """,
                    new { Id = Guid.NewGuid(), TopicId = id, body.UserId, DesignatedBy = user.Id });
                return TypedResults.Created($"/api/topics/{id}/smes/{body.UserId}", new { topic_id = id, user_id = body.UserId });
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return ApiError.Conflict("User is already an SME for this topic");
            }
        });

        group.MapDelete("/{id:guid}/smes/{userId:guid}", async (Guid id, Guid userId, ISessionService sessions, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            if (user.Role != "admin")
                return ApiError.Forbidden("Admin role required");

            var deleted = await db.ExecuteAsync(
                "DELETE FROM sme_designations WHERE topic_id = @id AND user_id = @userId",
                new { id, userId });
            return deleted == 0 ? ApiError.NotFound("SME designation not found") : TypedResults.NoContent();
        });

        return app;
    }
}
