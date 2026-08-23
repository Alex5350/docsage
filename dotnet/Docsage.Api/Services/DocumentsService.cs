using Dapper;
using Docsage.Api.Infrastructure;
using Docsage.Api.Models;
using Npgsql;

namespace Docsage.Api.Services;

/// <summary>Summary row joined with topic/owner names plus the pending_reviewer flag.</summary>
public sealed record DocumentListRow
{
    public Guid Id { get; init; }
    public Guid OwnerId { get; init; }
    public string Scope { get; init; } = "";
    public string Title { get; init; } = "";
    public string SourceFilename { get; init; } = "";
    public string MimeType { get; init; } = "";
    public string Status { get; init; } = "";
    public string? StatusError { get; init; }
    public string EmbeddingProvider { get; init; } = "";
    public string EmbeddingModel { get; init; } = "";
    public Guid? TopicId { get; init; }
    public string? TopicName { get; init; }
    public string ReviewStatus { get; init; } = "";
    public int ChunkCount { get; init; }
    public long SizeBytes { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public string? OwnerDisplayName { get; init; }
    public bool PendingReviewer { get; init; }
}

/// <summary>Approval row joined with the reviewer display name for DocumentDetail.approvals.</summary>
public sealed record ApprovalListRow
{
    public Guid Id { get; init; }
    public Guid DocumentId { get; init; }
    public Guid ReviewerId { get; init; }
    public string ReviewerName { get; init; } = "";
    public string Decision { get; init; } = "";
    public string Note { get; init; } = "";
    public DateTimeOffset DecidedAt { get; init; }
}

/// <summary>
/// Document visibility per contract: personal docs only to their owner (and admins for the
/// admin chat scope), library docs to everyone once approved, to admins always, and to the
/// SMEs designated for the document's topic before approval.
/// </summary>
public sealed class DocumentsService(NpgsqlConnection db)
{
    private const string SelectBase = """
        SELECT d.id, d.owner_id, d.scope, d.title, d.source_filename, d.mime_type, d.status,
               d.status_error, d.embedding_provider, d.embedding_model, d.topic_id, t.name AS topic_name,
               d.review_status, d.chunk_count, d.size_bytes, d.created_at,
               u.display_name AS owner_display_name,
               (d.review_status = 'pending_sme' AND (@IsAdmin OR EXISTS (
                   SELECT 1 FROM sme_designations sd WHERE sd.user_id = @UserId AND sd.topic_id = d.topic_id
               ))) AS pending_reviewer
        FROM documents d
        LEFT JOIN topics t ON t.id = d.topic_id
        LEFT JOIN users u ON u.id = d.owner_id
        """;

    public async Task<IReadOnlyList<DocumentListRow>> ListAsync(UserRow user, string scope) =>
        (IReadOnlyList<DocumentListRow>)await db.QueryAsync<DocumentListRow>(
            scope == "library" ? SelectBase + """
                 WHERE d.scope = 'library'
                   AND (@IsAdmin OR d.review_status = 'approved'
                        OR EXISTS (SELECT 1 FROM sme_designations sd WHERE sd.user_id = @UserId))
                 ORDER BY d.created_at DESC
                """
                : SelectBase + """
                 WHERE d.owner_id = @UserId AND d.scope = 'personal'
                 ORDER BY d.created_at DESC
                """,
            new { IsAdmin = user.Role == "admin", UserId = user.Id });

    public async Task<DocumentListRow?> FindSummaryAsync(UserRow user, Guid id) =>
        await db.QuerySingleOrDefaultAsync<DocumentListRow>(
            SelectBase + " WHERE d.id = @id",
            new { IsAdmin = user.Role == "admin", UserId = user.Id, id });

    /// <summary>Detail access: owner | admin | (library &amp; approved) | SME-of-topic.</summary>
    public static bool CanView(UserRow user, DocumentListRow row) =>
        row.OwnerId == user.Id
        || user.Role == "admin"
        || (row.Scope == "library" && row.ReviewStatus == "approved")
        || (row.Scope == "library" && row.PendingReviewer);

    public static bool CanDelete(UserRow user, DocumentListRow row) =>
        row.OwnerId == user.Id || user.Role == "admin";

    public async Task<IReadOnlyList<EnrichmentRow>> EnrichmentsAsync(Guid documentId) =>
        (IReadOnlyList<EnrichmentRow>)await db.QueryAsync<EnrichmentRow>(
            "SELECT * FROM enrichments WHERE document_id = @documentId ORDER BY created_at",
            new { documentId });

    public async Task<IReadOnlyList<ApprovalListRow>> ApprovalsAsync(Guid documentId) =>
        (IReadOnlyList<ApprovalListRow>)await db.QueryAsync<ApprovalListRow>(
            """
            SELECT a.id, a.document_id, a.reviewer_id, u.display_name AS reviewer_name,
                   a.decision, a.note, a.decided_at
            FROM approvals a JOIN users u ON u.id = a.reviewer_id
            WHERE a.document_id = @documentId
            ORDER BY a.decided_at DESC
            """,
            new { documentId });

    public static DocumentSummaryDto ToSummary(DocumentListRow row) => new(
        row.Id, row.Title, row.SourceFilename, row.MimeType, row.Scope, row.Status, row.StatusError,
        row.EmbeddingProvider, row.EmbeddingModel,
        row.TopicId is { } topicId && row.TopicName is { } topicName ? new TopicRefDto(topicId, topicName) : null,
        row.ReviewStatus, row.ChunkCount, row.SizeBytes, row.CreatedAt,
        row.OwnerDisplayName is { Length: > 0 } name ? new OwnerDto(row.OwnerId, name) : null,
        row.PendingReviewer);

    public DocumentDetailDto ToDetail(DocumentListRow row, IEnumerable<EnrichmentRow> enrichments, IEnumerable<ApprovalListRow> approvals) => new(
        row.Id, row.Title, row.SourceFilename, row.MimeType, row.Scope, row.Status, row.StatusError,
        row.EmbeddingProvider, row.EmbeddingModel,
        row.TopicId is { } topicId && row.TopicName is { } topicName ? new TopicRefDto(topicId, topicName) : null,
        row.ReviewStatus, row.ChunkCount, row.SizeBytes, row.CreatedAt,
        row.OwnerDisplayName is { Length: > 0 } name ? new OwnerDto(row.OwnerId, name) : null,
        row.PendingReviewer,
        [.. enrichments.Select(e => new EnrichmentDto(e.Kind, e.Content))],
        [.. approvals.Select(a => new ApprovalDto(a.ReviewerName, a.Decision, a.Note, a.DecidedAt))]);

    /// <summary>Pending reviews: SME sees documents pending for topics they cover, admin sees all pending.</summary>
    public async Task<IReadOnlyList<DocumentListRow>> PendingReviewsAsync(UserRow user) =>
        (IReadOnlyList<DocumentListRow>)await db.QueryAsync<DocumentListRow>(
            SelectBase + """
                 WHERE d.scope = 'library' AND d.review_status = 'pending_sme'
                   AND (@IsAdmin OR EXISTS (
                       SELECT 1 FROM sme_designations sd WHERE sd.user_id = @UserId AND sd.topic_id = d.topic_id))
                 ORDER BY d.created_at
                """,
            new { IsAdmin = user.Role == "admin", UserId = user.Id });
}

public static class DocumentsServiceExtensions
{
    public static IServiceCollection AddDocumentsService(this IServiceCollection services) =>
        services.AddScoped<DocumentsService>();
}
