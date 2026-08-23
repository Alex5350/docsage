using Dapper;
using Docsage.Api.Infrastructure;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Npgsql;

namespace Docsage.Api.Endpoints;

public sealed record OverviewCounts
{
    public long Users { get; init; }
    public long TotalDocuments { get; init; }
    public long PersonalDocuments { get; init; }
    public long LibraryDocuments { get; init; }
    public long PendingReviews { get; init; }
}

public sealed record StatusCount
{
    public string Status { get; init; } = "";
    public long Count { get; init; }
}

public static class AdminEndpoints
{
    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin");

        group.MapGet("/overview", async (ISessionService sessions, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            if (user.Role != "admin")
                return ApiError.Forbidden("Admin role required");

            var counts = await db.QuerySingleAsync<OverviewCounts>(
                """
                SELECT (SELECT count(*) FROM users) AS users,
                       (SELECT count(*) FROM documents) AS total_documents,
                       (SELECT count(*) FROM documents WHERE scope = 'personal') AS personal_documents,
                       (SELECT count(*) FROM documents WHERE scope = 'library') AS library_documents,
                       (SELECT count(*) FROM documents WHERE review_status = 'pending_sme') AS pending_reviews
                """);
            var pipeline = (await db.QueryAsync<StatusCount>(
                "SELECT status, count(*) AS count FROM documents GROUP BY status"))
                .ToDictionary(r => r.Status, r => r.Count);

            return Results.Ok(new
            {
                users = counts.Users,
                total_documents = counts.TotalDocuments,
                personal_documents = counts.PersonalDocuments,
                library_documents = counts.LibraryDocuments,
                pending_reviews = counts.PendingReviews,
                pipeline,
            });
        });

        return app;
    }
}
