using Dapper;
using Docsage.Api.Models;
using Docsage.Api.Providers;
using Npgsql;

namespace Docsage.Api.Services;

public sealed record RetrievedChunk
{
    public Guid ChunkId { get; init; }
    public Guid DocumentId { get; init; }
    public string DocumentTitle { get; init; } = "";
    public string Content { get; init; } = "";
    public double Score { get; init; }
    public int? Page { get; init; }
}

/// <summary>
/// Chat retrieval per contract: pgvector cosine distance (&lt;=&gt;), top 6, query embedded once
/// per provider present in the candidate set (max two) and merged by cosine score. The 0.15
/// similarity floor filters real-provider (gemini/openai) noise; demo retrieval is rank-only —
/// demo scores are deterministic hash noise, meaningless as confidence (mirrors the python
/// reference backend/src/docsage_api/services/retrieval.py).
/// </summary>
public sealed class RetrievalService(NpgsqlConnection db, EmbeddingProviderResolver providers)
{
    public const int TopK = 6;
    public const double RealProviderCutoff = 0.15;

    public async Task<IReadOnlyList<RetrievedChunk>> RetrieveAsync(
        Guid userId, string scope, string query, CancellationToken ct = default)
    {
        var isAdminScope = scope == "admin";
        const string candidatePredicate = """
            ((@IsAdminScope AND d.status <> 'failed')
             OR (NOT @IsAdminScope AND (
                 (d.owner_id = @UserId AND d.scope = 'personal')
                 OR (d.scope = 'library' AND d.review_status = 'approved'))))
            """;

        var providerNames = (await db.QueryAsync<string>(
            $"""
             SELECT DISTINCT d.embedding_provider FROM documents d
             WHERE {candidatePredicate}
             """,
            new { IsAdminScope = isAdminScope, UserId = userId })).Distinct().OrderBy(p => p, StringComparer.Ordinal).Take(2).ToList();

        var merged = new List<RetrievedChunk>();
        foreach (var providerName in providerNames)
        {
            // Filter by the column value (the provider space chosen at upload); the query is
            // embedded with that space's resolved provider (demo fallback when keys missing).
            var provider = providers.Resolve(providerName);
            var queryVector = await provider.EmbedQueryAsync(query, ct);
            var cutoff = providerName != "demo" ? RealProviderCutoff : double.NegativeInfinity;

            var rows = await db.QueryAsync<RetrievedChunk>(
                $"""
                 SELECT c.id AS chunk_id, d.id AS document_id, d.title AS document_title,
                        c.content, 1 - (c.embedding <=> @QueryVector) AS score, c.page
                 FROM chunks c JOIN documents d ON d.id = c.document_id
                 WHERE d.embedding_provider = @ProviderName AND c.embedding IS NOT NULL
                   AND {candidatePredicate}
                 ORDER BY c.embedding <=> @QueryVector
                 LIMIT @TopK
                 """,
                new { QueryVector = queryVector.ToPgVector(), ProviderName = providerName, TopK, IsAdminScope = isAdminScope, UserId = userId });
            merged.AddRange(rows.Where(r => r.Score >= cutoff));
        }
        return merged.OrderByDescending(r => r.Score).Take(TopK).ToList();
    }
}

public static class RetrievalServiceExtensions
{
    public static IServiceCollection AddRetrievalService(this IServiceCollection services) =>
        services.AddScoped<RetrievalService>();
}
