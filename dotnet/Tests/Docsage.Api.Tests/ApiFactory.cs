using Microsoft.Extensions.Configuration;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Docsage.Api.Tests;

public sealed class ApiFactory(TestDatabaseFixture fixture) : WebApplicationFactory<Program>
{
    static ApiFactory() =>
        // Test hosts share static state across the run; limits are re-enabled
        // explicitly by the dedicated RateLimitTests.
        Docsage.Api.Infrastructure.RateLimiter.Enabled = false;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["DOCSAGE_DATABASE_URL"] = fixture.DatabaseUrl,
            ["DOCSAGE_DEMO_MODE"] = "true",
            ["DOCSAGE_UPLOAD_DIR"] = fixture.UploadsDir,
            ["DOCSAGE_ENV"] = "development",
        }));
    }
}

public static class TestServerExtensions
{
    public static async Task<JsonDocument> ReadJsonAsync(this HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        return JsonDocument.Parse(body);
    }

    public static async Task<string> RegisterAndLoginAsync(this HttpClient client, string email,
        string password = "password123", string displayName = "Test User")
    {
        var register = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password, display_name = displayName });
        register.EnsureSuccessStatusCode();
        return await LoginAsync(client, email, password);
    }

    public static async Task<string> LoginAsync(this HttpClient client, string email, string password)
    {
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password });
        login.EnsureSuccessStatusCode();
        return email;
    }

    public static async Task<HttpResponseMessage> PostUploadAsync(this HttpClient client, string content,
        string filename = "notes.txt", string provider = "demo", string scope = "personal",
        string? topicId = null, string? title = null)
    {
        using var form = new MultipartFormDataContent();
        var file = new StreamContent(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(content)));
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/plain");
        form.Add(file, "file", filename);
        form.Add(new StringContent(provider), "provider");
        form.Add(new StringContent(scope), "scope");
        if (topicId is not null)
            form.Add(new StringContent(topicId), "topic_id");
        if (title is not null)
            form.Add(new StringContent(title), "title");
        return await client.PostAsync("/api/documents", form);
    }

    public static async Task<JsonElement> UploadTextDocumentAsync(this HttpClient client, string content,
        string filename = "notes.txt", string provider = "demo", string scope = "personal",
        string? topicId = null, string? title = null)
    {
        var response = await client.PostUploadAsync(content, filename, provider, scope, topicId, title);
        response.EnsureSuccessStatusCode();
        Assert.Equal(System.Net.HttpStatusCode.Accepted, response.StatusCode);
        using var json = await response.ReadJsonAsync();
        return json.RootElement.Clone();
    }

    /// <summary>Polls the document detail endpoint until the pipeline reports ready or failed.</summary>
    public static async Task<JsonElement> WaitForStatusAsync(this HttpClient client, Guid documentId,
        string status = "ready", int timeoutSeconds = 30)
    {
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        while (DateTime.UtcNow < deadline)
        {
            var response = await client.GetAsync($"/api/documents/{documentId}");
            response.EnsureSuccessStatusCode();
            using var json = await response.ReadJsonAsync();
            var current = json.RootElement.GetProperty("status").GetString();
            if (current == status)
                return json.RootElement.Clone();
            if (current == "failed")
                Assert.Fail($"Pipeline failed: {json.RootElement.GetProperty("status_error").GetString()}");
            await Task.Delay(150);
        }
        Assert.Fail($"Timed out waiting for document {documentId} to reach status '{status}'");
        throw new System.Diagnostics.UnreachableException();
    }
}
