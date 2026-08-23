using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using Dapper;

namespace Docsage.Api.Tests;

/// <summary>
/// Atomicity of the ingestion endgame: a document that fails processing ends
/// failed with a readable reason and leaves NO partial chunks behind (the
/// chunk loop commits in a single transaction with the terminal status).
/// </summary>
[Collection("database")]
public sealed class PipelineFailureTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [SkippableFact]
    public async Task Corrupt_Pdf_Fails_With_Reason_And_No_Partial_Chunks()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        await client.RegisterAndLoginAsync($"fail-{Guid.NewGuid():N}@example.com");

        // Valid %PDF magic (passes upload validation) but a garbage body —
        // extraction cannot succeed.
        var bytes = System.Text.Encoding.ASCII
            .GetBytes("%PDF-2.0\nthis is not really a pdf stream")
            .ToArray();
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/pdf");
        form.Add(file, "file", "broken.pdf");
        form.Add(new StringContent("demo"), "provider");
        form.Add(new StringContent("personal"), "scope");
        var upload = await client.PostAsync("/api/documents", form);
        Assert.Equal(HttpStatusCode.Accepted, upload.StatusCode);
        var doc = await upload.Content.ReadFromJsonAsync<JsonElement>();
        var id = doc.GetProperty("id").GetGuid();

        await client.WaitForStatusAsync(id, status: "failed");

        await using var db = new NpgsqlConnection(TestDatabaseFixture.TestConnectionString);
        await db.OpenAsync();
        var statusError = await db.ExecuteScalarAsync<string?>(
            "SELECT status_error FROM documents WHERE id = @id", new { id });
        Assert.False(string.IsNullOrWhiteSpace(statusError));
        var chunks = await db.ExecuteScalarAsync<long>(
            "SELECT count(*) FROM chunks WHERE document_id = @id", new { id });
        Assert.Equal(0, chunks);
    }
}
