using Dapper;
using Docsage.Api.Infrastructure;
using Docsage.Api.Models;
using Docsage.Api.Providers;
using Docsage.Api.Services.Extraction;
using Npgsql;

namespace Docsage.Api.Services;

/// <summary>
/// Background ingestion pipeline per contract: queued -> extracting -> enriching -> embedding ->
/// ready (or failed from any state, with status_error). Fire-and-forget from the upload
/// endpoint; each run creates its own DI scope for a dedicated DB connection.
/// </summary>
public sealed class IngestionPipeline(
    IServiceScopeFactory scopeFactory,
    ExtractorDispatcher extractor,
    Enricher enricher,
    EmbeddingProviderResolver providers,
    UploadStorage storage,
    ILogger<IngestionPipeline> logger)
{
    public void Start(Guid documentId) =>
        _ = Task.Run(() => RunAsync(documentId));

    private async Task RunAsync(Guid documentId)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NpgsqlConnection>();
        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        var ct = cts.Token;
        try
        {
            await db.OpenAsync(ct);
            var doc = await db.QuerySingleOrDefaultAsync<DocumentRow>(
                "SELECT * FROM documents WHERE id = @documentId", new { documentId });
            if (doc is null)
            {
                logger.LogWarning("Ingestion skipped: document {DocumentId} no longer exists", documentId);
                return;
            }

            await SetStatusAsync(db, documentId, "extracting", ct);
            var parts = (await extractor.ExtractAsync(
                storage.AbsolutePathFor(documentId, doc.SourceFilename), doc.MimeType, ct)).ToList();

            await SetStatusAsync(db, documentId, "enriching", ct);
            var plan = await enricher.GenerateAsync(doc.Title, parts, ct);
            // replace image placeholders with their captions, then chunk the enriched parts
            var captionIndex = 0;
            for (var i = 0; i < parts.Count; i++)
            {
                if (parts[i].Kind == PartKinds.ImageDescription && captionIndex < plan.ImageCaptions.Count)
                    parts[i] = parts[i] with { Content = plan.ImageCaptions[captionIndex++] };
            }
            await db.ExecuteAsync(
                """
                INSERT INTO enrichments (id, document_id, kind, content)
                VALUES (@Id, @DocumentId, 'summary', @Summary),
                       (@Id2, @DocumentId, 'keywords', @Keywords),
                       (@Id3, @DocumentId, 'questions', @Questions)
                """,
                new
                {
                    Id = Guid.NewGuid(),
                    Id2 = Guid.NewGuid(),
                    Id3 = Guid.NewGuid(),
                    documentId,
                    plan.Summary,
                    plan.Keywords,
                    plan.Questions,
                });
            foreach (var caption in plan.ImageCaptions)
            {
                await db.ExecuteAsync(
                    "INSERT INTO enrichments (id, document_id, kind, content) VALUES (@Id, @DocumentId, 'caption', @Caption)",
                    new { Id = Guid.NewGuid(), documentId, Caption = caption });
            }
            var chunks = Chunker.Chunk(parts);

            await SetStatusAsync(db, documentId, "embedding", ct);
            var provider = providers.Resolve(doc.EmbeddingProvider);
            var embedTexts = chunks.Select(c => $"Summary: {plan.Summary}\nKeywords: {plan.Keywords}\n\n{c.Content}").ToList();
            var vectors = await provider.EmbedDocumentsAsync(embedTexts, ct);
            if (vectors.Count != chunks.Count)
                throw new InvalidOperationException($"embedding provider returned {vectors.Count} vectors for {chunks.Count} chunks");

            foreach (var (chunk, vector) in chunks.Zip(vectors))
            {
                await db.ExecuteAsync(
                    """
                    INSERT INTO chunks (id, document_id, ordinal, content, kind, page, token_count, embedding)
                    VALUES (@Id, @DocumentId, @Ordinal, @Content, @Kind, @Page, @TokenCount, @Embedding)
                    """,
                    new
                    {
                        Id = Guid.NewGuid(),
                        DocumentId = documentId,
                        chunk.Ordinal,
                        chunk.Content,
                        chunk.Kind,
                        chunk.Page,
                        chunk.TokenCount,
                        Embedding = vector.ToPgVector(),
                    });
            }

            var pageCount = parts.Select(p => p.Page).Where(p => p is not null).DefaultIfEmpty(0).Max();
            await db.ExecuteAsync(
                """
                UPDATE documents
                SET status = 'ready', status_error = NULL, chunk_count = @ChunkCount, page_count = @PageCount,
                    review_status = CASE WHEN scope = 'library' THEN 'pending_sme' ELSE review_status END,
                    updated_at = now()
                WHERE id = @documentId
                """,
                new { ChunkCount = chunks.Count, PageCount = pageCount == 0 ? (int?)null : pageCount, documentId });
            logger.LogInformation("Document {DocumentId} ready with {ChunkCount} chunks", documentId, chunks.Count);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Ingestion failed for document {DocumentId}", documentId);
            try
            {
                await db.ExecuteAsync(
                    "UPDATE documents SET status = 'failed', status_error = @error, updated_at = now() WHERE id = @documentId",
                    new { error = ex.Message.Truncate(500), documentId });
            }
            catch (Exception persistEx)
            {
                logger.LogError(persistEx, "Could not persist failure status for {DocumentId}", documentId);
            }
        }
    }

    private static async Task SetStatusAsync(NpgsqlConnection db, Guid documentId, string status, CancellationToken ct) =>
        await db.ExecuteAsync(
            new CommandDefinition(
                "UPDATE documents SET status = @status, updated_at = now() WHERE id = @documentId",
                new { status, documentId }, cancellationToken: ct));
}

internal static class StringExtensions
{
    public static string Truncate(this string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];
}

public static class IngestionPipelineExtensions
{
    public static IServiceCollection AddIngestionPipeline(this IServiceCollection services) =>
        services.AddSingleton<IngestionPipeline>();
}
