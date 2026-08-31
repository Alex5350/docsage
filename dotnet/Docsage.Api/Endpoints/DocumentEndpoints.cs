using Dapper;
using Docsage.Api.Infrastructure;
using Docsage.Api.Models;
using Docsage.Api.Providers;
using Docsage.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Npgsql;

namespace Docsage.Api.Endpoints;

public static class DocumentEndpoints
{
    private const long MaxUploadBytes = 25 * 1024 * 1024;

    private static readonly HashSet<string> AllowedProviders = ["gemini", "openai", "demo"];
    private static readonly Dictionary<string, string> ExtensionMime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".txt"] = "text/plain",
        [".md"] = "text/markdown",
        [".csv"] = "text/csv",
        [".pdf"] = "application/pdf",
        [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
    };

    /// <summary>Server-side validation mirroring the reference: the declared
    /// (or extension-derived) mime must be in the allowlist, and the bytes
    /// must match the family — magic numbers for binaries, UTF-8 for text.</summary>
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] JpegSignature = [0xFF, 0xD8, 0xFF];
    private static readonly System.Text.Encoding StrictUtf8 = System.Text.Encoding.GetEncoding(
        "utf-8", System.Text.EncoderFallback.ExceptionFallback, System.Text.DecoderFallback.ExceptionFallback);

    public static (string? Error, int Status) VerifyUpload(string mime, byte[] head)
    {
        if (!ExtensionMime.ContainsValue(mime))
        {
            var allowed = string.Join(", ", ExtensionMime.Values.OrderBy(v => v).Distinct());
            return ($"unsupported file type '{mime}'; allowed: {allowed}", 422);
        }
        var sample = head.AsSpan(0, Math.Min(head.Length, 1024));
        var (ok, reason) = mime switch
        {
            "application/pdf" => (sample.StartsWith("%PDF"u8), "file content is not a PDF"),
            "image/png" => (sample.StartsWith(PngSignature), "file content is not a PNG image"),
            "image/jpeg" => (sample.StartsWith(JpegSignature), "file content is not a JPEG image"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                => (sample.StartsWith("PK"u8), "file content is not an Office (OOXML) document"),
            "text/plain" or "text/markdown" or "text/csv"
                => (IsValidUtf8(sample), "text upload is not valid UTF-8"),
            _ => (true, ""),
        };
        return ok ? (null, 200) : (reason, 422);
    }

    private static bool IsValidUtf8(ReadOnlySpan<byte> bytes)
    {
        try
        {
            _ = StrictUtf8.GetString(bytes);
            return true;
        }
        catch (System.Text.DecoderFallbackException)
        {
            return false;
        }
    }

    public static IEndpointRouteBuilder MapDocumentEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/documents");

        group.MapGet("/", async (string? scope, ISessionService sessions, DocumentsService documents) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            var effectiveScope = string.IsNullOrEmpty(scope) ? "personal" : scope;
            if (effectiveScope is not ("personal" or "library"))
                return ApiError.Validation("scope must be 'personal' or 'library'");

            var items = await documents.ListAsync(user, effectiveScope);
            return Results.Ok(new { items = items.Select(DocumentsService.ToSummary).ToList() });
        });

        group.MapPost("/", async (HttpRequest request, ISessionService sessions, DocumentsService documents,
            UploadStorage storage, IngestionPipeline pipeline, EmbeddingProviderResolver resolver, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();

            if (!request.HasFormContentType)
                return ApiError.Validation("multipart/form-data with a 'file' field is required");
            var form = await request.ReadFormAsync();
            var file = form.Files.GetFiles("file").FirstOrDefault();
            var provider = form["provider"].ToString();
            var scope = form["scope"].ToString();
            var title = form["title"].ToString();
            var topicIdText = form["topic_id"].ToString();

            if (file is null || file.Length == 0)
                return ApiError.Validation("file is required");
            if (file.Length > MaxUploadBytes)
                return ApiError.PayloadTooLarge("file exceeds the 25MB upload limit");
            if (!AllowedProviders.Contains(provider))
                return ApiError.Validation("provider must be one of 'gemini', 'openai', 'demo'");
            if (scope is not ("personal" or "library"))
                return ApiError.Validation("scope must be 'personal' or 'library'");
            if (scope == "library" && user.Role != "admin")
                return ApiError.Forbidden("Only admins can ingest library documents");
            // Reference parity: a library doc without a topic can never reach an SME.
            if (scope == "library" && string.IsNullOrEmpty(topicIdText))
                return ApiError.Validation("topic_id is required for library documents");

            Guid? topicId = null;
            if (!string.IsNullOrEmpty(topicIdText))
            {
                if (!Guid.TryParse(topicIdText, out var parsed))
                    return ApiError.Validation("topic_id must be a UUID");
                topicId = parsed;
                if (await db.QuerySingleOrDefaultAsync<Guid?>("SELECT id FROM topics WHERE id = @topicId", new { topicId }) is null)
                    return ApiError.NotFound("Topic not found");
            }

            var filename = Path.GetFileName(file.FileName);
            if (string.IsNullOrWhiteSpace(filename))
                return ApiError.Validation("file must have a filename");
            var documentId = Guid.NewGuid();
            var absolutePath = storage.AbsolutePathFor(documentId, filename);
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)!);
            await using (var target = File.Create(absolutePath))
                await file.CopyToAsync(target);

            var mimeType = !string.IsNullOrWhiteSpace(file.ContentType) && file.ContentType != "application/octet-stream"
                ? file.ContentType
                : ExtensionMime.GetValueOrDefault(Path.GetExtension(filename), "application/octet-stream");

            // Server-side validation: allowlist + magic bytes (reference parity).
            byte[] head;
            using (var stream = File.OpenRead(absolutePath))
            {
                head = new byte[Math.Min(1024, stream.Length)];
                _ = await stream.ReadAsync(head);
            }
            var (uploadError, _) = VerifyUpload(mimeType, head);
            if (uploadError is not null)
            {
                Directory.Delete(Path.GetDirectoryName(absolutePath)!, recursive: true);
                return ApiError.Validation(uploadError);
            }


            var row = await db.QuerySingleAsync<DocumentListRow>(
                """
                INSERT INTO documents (id, owner_id, scope, title, source_filename, mime_type, storage_path,
                                       size_bytes, checksum_sha256, status, embedding_provider, embedding_model, topic_id)
                VALUES (@Id, @OwnerId, @Scope, @Title, @SourceFilename, @MimeType, @StoragePath,
                        @SizeBytes, @ChecksumSha256, 'queued', @EmbeddingProvider, @EmbeddingModel, @TopicId)
                RETURNING id, owner_id, scope, title, source_filename, mime_type, status, status_error,
                          embedding_provider, embedding_model, topic_id, NULL AS topic_name, review_status, chunk_count,
                          size_bytes, created_at, @OwnerDisplayName AS owner_display_name, FALSE AS pending_reviewer
                """,
                new
                {
                    Id = documentId,
                    OwnerId = user.Id,
                    Scope = scope,
                    Title = string.IsNullOrWhiteSpace(title) ? Path.GetFileNameWithoutExtension(filename) : title.Trim(),
                    SourceFilename = filename,
                    MimeType = mimeType,
                    StoragePath = storage.RelativePathFor(documentId, filename),
                    SizeBytes = (long)file.Length,
                    ChecksumSha256 = Sha256.HexOfFile(absolutePath),
                    EmbeddingProvider = provider,
                    EmbeddingModel = resolver.Resolve(provider).ModelId,
                    TopicId = topicId,
                    OwnerDisplayName = user.DisplayName,
                });

            pipeline.Start(documentId);
            return Results.Accepted($"/api/documents/{documentId}", DocumentsService.ToSummary(row));
        }).DisableAntiforgery();

        group.MapGet("/{id:guid}", async (Guid id, ISessionService sessions, DocumentsService documents) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            if (await documents.FindSummaryAsync(user, id) is not { } row)
                return ApiError.NotFound("Document not found");
            if (!DocumentsService.CanView(user, row))
                return ApiError.NotFound("Document not found");

            var enrichments = await documents.EnrichmentsAsync(id);
            var approvals = await documents.ApprovalsAsync(id);
            return Results.Ok(documents.ToDetail(row, enrichments, approvals));
        });

        group.MapDelete("/{id:guid}", async (Guid id, ISessionService sessions, DocumentsService documents,
            UploadStorage storage, NpgsqlConnection db) =>
        {
            if (await sessions.ResolveUserAsync() is not { } user)
                return ApiError.Unauthorized();
            if (await documents.FindSummaryAsync(user, id) is not { } row)
                return ApiError.NotFound("Document not found");
            if (!DocumentsService.CanDelete(user, row))
                return ApiError.Forbidden("Only the owner or an admin can delete a document");

            await db.ExecuteAsync("DELETE FROM documents WHERE id = @id", new { id });
            try
            {
                var dir = Path.Combine(storage.Root, id.ToString());
                if (Directory.Exists(dir))
                    Directory.Delete(dir, recursive: true);
            }
            catch (IOException)
            {
                // best effort: the DB row and chunks are already gone
            }
            return Results.NoContent();
        });

        return app;
    }
}
