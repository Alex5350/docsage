using Dapper;
using Docsage.Api.Infrastructure;
using Docsage.Api.Models;
using Docsage.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Npgsql;

namespace Docsage.Api.Endpoints;

public sealed record ReviewDecisionRequest(string Decision, string? Note);

public static class ReviewEndpoints
{
    public static IEndpointRouteBuilder MapReviewEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/reviews");

        group.MapGet("/pending", async (ISessionService sessions, DocumentsService documents, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            var isSme = await db.QuerySingleOrDefaultAsync<int?>(
                "SELECT 1 WHERE EXISTS (SELECT 1 FROM sme_designations WHERE user_id = @UserId)",
                new { UserId = user.Id });
            if (user.Role != "admin" && isSme is null)
                return ApiError.Forbidden("SME designation or admin role required");

            var items = await documents.PendingReviewsAsync(user);
            return Results.Ok(new { items = items.Select(DocumentsService.ToSummary).ToList() });
        });

        group.MapPost("/{documentId:guid}", async (Guid documentId, ReviewDecisionRequest body,
            ISessionService sessions, DocumentsService documents, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            if (body.Decision is not ("approved" or "rejected"))
                return ApiError.Validation("decision must be 'approved' or 'rejected'");
            if (await documents.FindSummaryAsync(user, documentId) is not { } row)
                return ApiError.NotFound("Document not found");
            if (row.Scope != "library" || row.ReviewStatus != "pending_sme")
                return ApiError.Conflict("Document is not pending SME review");
            if (user.Role != "admin" && !row.PendingReviewer)
                return ApiError.Forbidden("Only an SME of this topic or an admin can review");
            // No self-approval (ADR 0005): the uploader needs someone else to decide,
            // admins included, or the audit trail means nothing.
            if (row.OwnerId == user.Id)
                return ApiError.Forbidden("The uploader cannot review their own document");

            await db.ExecuteAsync(
                """
                INSERT INTO approvals (id, document_id, reviewer_id, decision, note)
                VALUES (@Id, @DocumentId, @ReviewerId, @Decision, @Note)
                """,
                new { Id = Guid.NewGuid(), DocumentId = documentId, ReviewerId = user.Id, Decision = body.Decision, Note = body.Note ?? "" });
            await db.ExecuteAsync(
                "UPDATE documents SET review_status = @Decision, updated_at = now() WHERE id = @DocumentId",
                new { Decision = body.Decision, DocumentId = documentId });

            var updated = await documents.FindSummaryAsync(user, documentId);
            return Results.Ok(DocumentsService.ToSummary(updated ?? row));
        });

        return app;
    }
}
