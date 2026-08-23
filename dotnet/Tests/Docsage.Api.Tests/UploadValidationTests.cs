using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Docsage.Api.Tests;

/// <summary>
/// Server-side upload validation parity: the declared mime must be in the
/// allowlist AND the bytes must match the family — a renamed zip never
/// persists as a PDF, and unknown types 422 instead of ingesting junk.
/// </summary>
[Collection("database")]
public sealed class UploadValidationTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static async Task<HttpResponseMessage> UploadAsync(
        HttpClient client, byte[] bytes, string filename, string contentType)
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        form.Add(file, "file", filename);
        form.Add(new StringContent("demo"), "provider");
        form.Add(new StringContent("personal"), "scope");
        return await client.PostAsync("/api/documents", form);
    }

    [SkippableFact]
    public async Task Renamed_Zip_Declared_As_Pdf_Is_Rejected()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        await client.RegisterAndLoginAsync($"magic-{Guid.NewGuid():N}@example.com");

        var response = await UploadAsync(
            client, [0x50, 0x4B, 0x03, 0x04, .. new byte[64]], "evil.pdf", "application/pdf");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("not a PDF", body.GetProperty("detail").GetString());
    }

    [SkippableFact]
    public async Task Text_Bytes_Declared_As_Png_Are_Rejected()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        await client.RegisterAndLoginAsync($"magic-{Guid.NewGuid():N}@example.com");

        var response = await UploadAsync(
            client,
            System.Text.Encoding.UTF8.GetBytes("just plain text, not pixels"),
            "notes.png", "image/png");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("not a PNG", body.GetProperty("detail").GetString());
    }

    [SkippableFact]
    public async Task Unknown_Declared_Mime_Is_Rejected_Instead_Of_Ingesting_Junk()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        await client.RegisterAndLoginAsync($"magic-{Guid.NewGuid():N}@example.com");

        var response = await UploadAsync(
            client, [0x4D, 0x5A, 0x00, 0x01], "payload.bin", "application/octet-stream");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("unsupported file type", body.GetProperty("detail").GetString());
    }

    [SkippableFact]
    public async Task Genuine_Png_Bytes_Are_Accepted()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        await client.RegisterAndLoginAsync($"magic-{Guid.NewGuid():N}@example.com");

        var response = await UploadAsync(
            client,
            [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, .. new byte[256]],
            "chart.png", "image/png");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }
}
