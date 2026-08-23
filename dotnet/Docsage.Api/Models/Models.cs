namespace Docsage.Api.Models;

/// <summary>
/// DB row shapes (snake_case columns, mapped via Dapper.MatchNamesWithUnderscores). Property
/// syntax instead of positional records: Dapper's constructor binding matches parameter names
/// to columns exactly, while property matching is case-insensitive.
/// </summary>
public sealed record UserRow
{
    public Guid Id { get; init; }
    public string Email { get; init; } = "";
    public string PasswordHash { get; init; } = "";
    public string DisplayName { get; init; } = "";
    public string Role { get; init; } = "";
    public DateTimeOffset CreatedAt { get; init; }
}

public sealed record TopicRow
{
    public Guid Id { get; init; }
    public string Name { get; init; } = "";
    public string Description { get; init; } = "";
    public Guid? CreatedBy { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
}

public sealed record DocumentRow
{
    public Guid Id { get; init; }
    public Guid OwnerId { get; init; }
    public string Scope { get; init; } = "";
    public string Title { get; init; } = "";
    public string SourceFilename { get; init; } = "";
    public string MimeType { get; init; } = "";
    public string StoragePath { get; init; } = "";
    public long SizeBytes { get; init; }
    public string ChecksumSha256 { get; init; } = "";
    public string Status { get; init; } = "";
    public string? StatusError { get; init; }
    public string EmbeddingProvider { get; init; } = "";
    public Guid? TopicId { get; init; }
    public string ReviewStatus { get; init; } = "";
    public int ChunkCount { get; init; }
    public int? PageCount { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; init; }
}

public sealed record EnrichmentRow
{
    public Guid Id { get; init; }
    public Guid DocumentId { get; init; }
    public string Kind { get; init; } = "";
    public string Content { get; init; } = "";
    public DateTimeOffset CreatedAt { get; init; }
}

public sealed record ChatSessionRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string Scope { get; init; } = "";
    public string Title { get; init; } = "";
    public DateTimeOffset CreatedAt { get; init; }
}

public sealed record ChatMessageRow
{
    public Guid Id { get; init; }
    public Guid SessionId { get; init; }
    public string Role { get; init; } = "";
    public string Content { get; init; } = "";
    public string Citations { get; init; } = "[]";
    public DateTimeOffset CreatedAt { get; init; }
}

public sealed record OwnerDto(Guid Id, string DisplayName);

public sealed record TopicRefDto(Guid Id, string Name);

public sealed record DocumentSummaryDto(
    Guid Id,
    string Title,
    string SourceFilename,
    string MimeType,
    string Scope,
    string Status,
    string? StatusError,
    string EmbeddingProvider,
    TopicRefDto? Topic,
    string ReviewStatus,
    int ChunkCount,
    long SizeBytes,
    DateTimeOffset CreatedAt,
    OwnerDto? Owner,
    bool PendingReviewer);

public sealed record EnrichmentDto(string Kind, string Content);

public sealed record ApprovalDto(string Reviewer, string Decision, string Note, DateTimeOffset DecidedAt);

public sealed record DocumentDetailDto(
    Guid Id,
    string Title,
    string SourceFilename,
    string MimeType,
    string Scope,
    string Status,
    string? StatusError,
    string EmbeddingProvider,
    TopicRefDto? Topic,
    string ReviewStatus,
    int ChunkCount,
    long SizeBytes,
    DateTimeOffset CreatedAt,
    OwnerDto? Owner,
    bool PendingReviewer,
    IReadOnlyList<EnrichmentDto> Enrichments,
    IReadOnlyList<ApprovalDto> Approvals);

public sealed record CitationDto(
    string ChunkId,
    string DocumentId,
    string DocumentTitle,
    string Snippet,
    double Score,
    int? Page);

public sealed record UserDto(Guid Id, string Email, string DisplayName, string Role);

public sealed record TopicDto(Guid Id, string Name, string Description, IReadOnlyList<SmeDto> Smes);

public sealed record SmeDto(Guid Id, string DisplayName, string Email);

public sealed record ChatSessionDto(Guid Id, string Scope, string Title, DateTimeOffset CreatedAt);

public sealed record ChatMessageDto(Guid Id, string Role, string Content, System.Text.Json.JsonElement Citations, DateTimeOffset CreatedAt);
