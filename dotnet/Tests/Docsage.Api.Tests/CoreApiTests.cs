using System.Net;
using System.Net.Http.Json;

namespace Docsage.Api.Tests;

[Collection("database")]
public sealed class AuthFlowTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [SkippableFact]
    public async Task Register_Login_Cookie_And_Me_Flow()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        var email = $"alice-{Guid.NewGuid():N}@example.com";

        var register = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "password123", display_name = "Alice" });
        Assert.True(register.StatusCode == HttpStatusCode.Created, $"register failed: {(int)register.StatusCode} {await register.Content.ReadAsStringAsync()}");
        using var registered = await register.ReadJsonAsync();
        Assert.Equal(email, registered.RootElement.GetProperty("email").GetString());
        Assert.Equal("user", registered.RootElement.GetProperty("role").GetString());
        Assert.NotEqual(default, registered.RootElement.GetProperty("id").GetGuid());

        var login = await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = "password123" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Contains("docsage_session", login.Headers.GetValues("Set-Cookie").Single());

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        using var meJson = await me.ReadJsonAsync();
        Assert.Equal(email, meJson.RootElement.GetProperty("email").GetString());

        var logout = await client.PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        var afterLogout = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, afterLogout.StatusCode);
    }

    [SkippableFact]
    public async Task Duplicate_Email_Conflicts_And_Bad_Password_Is_Unauthorized()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        var email = $"dup-{Guid.NewGuid():N}@example.com";
        await client.RegisterAndLoginAsync(email);

        var duplicate = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "password123", display_name = "Dup" });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        using var detail = await duplicate.ReadJsonAsync();
        Assert.NotNull(detail.RootElement.GetProperty("detail").GetString());

        var badLogin = await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = "wrong-password" });
        Assert.Equal(HttpStatusCode.Unauthorized, badLogin.StatusCode);
    }

    [SkippableFact]
    public async Task Short_Password_Is_Unprocessable()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/register",
            new { email = "short@example.com", password = "short", display_name = "S" });
        Assert.True(response.StatusCode == HttpStatusCode.UnprocessableEntity, await response.Content.ReadAsStringAsync());
    }
}

[Collection("database")]
public sealed class DocumentPipelineTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [SkippableFact]
    public async Task Upload_Text_Reaches_Ready_With_Chunks_Enrichments_And_1536_Dim_Vectors()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        await client.RegisterAndLoginAsync($"doc-{Guid.NewGuid():N}@example.com");

        var content = """
            DocSage quarterly operations report. This document summarizes agency operations for the
            quarter, covering intake volume, review turnaround, and knowledge coverage.

            Intake volume increased by eighteen percent quarter over quarter, driven primarily by
            new agency-wide onboarding requirements and a refreshed records retention policy.
            Review turnaround improved after the introduction of topic-level SME assignment.

            Knowledge coverage expanded into two new practice areas. The following table lists the
            coverage areas and their designated reviewers.
            """;
        var document = await client.UploadTextDocumentAsync(content, title: "Quarterly Ops Report");
        var documentId = document.GetProperty("id").GetGuid();
        Assert.Equal("queued", document.GetProperty("status").GetString());
        Assert.Equal("demo", document.GetProperty("embedding_provider").GetString());
        Assert.Equal("not_required", document.GetProperty("review_status").GetString());

        var ready = await client.WaitForStatusAsync(documentId);
        Assert.Equal("ready", ready.GetProperty("status").GetString());
        Assert.True(ready.GetProperty("chunk_count").GetInt32() >= 1);

        // enrichments stored: summary, keywords, questions — with real extracted content
        var kinds = ready.GetProperty("enrichments").EnumerateArray()
            .Select(e => e.GetProperty("kind").GetString()).ToHashSet();
        Assert.True(kinds.IsSupersetOf(["summary", "keywords", "questions"]),
            $"expected summary/keywords/questions enrichments, got: {string.Join(",", kinds)}");
        var summary = ready.GetProperty("enrichments").EnumerateArray()
            .First(e => e.GetProperty("kind").GetString() == "summary").GetProperty("content").GetString();
        Assert.Contains("operations", summary);
        Assert.DoesNotContain("unsupported file type", summary);

        await using var db = new Npgsql.NpgsqlConnection(TestDatabaseFixture.TestConnectionString);
        await db.OpenAsync();
        await using var command = new Npgsql.NpgsqlCommand(
            "SELECT ordinal, kind, token_count, embedding::text FROM chunks WHERE document_id = @id ORDER BY ordinal",
            db);
        command.Parameters.AddWithValue("id", documentId);
        var rows = new List<(int ordinal, string kind, int tokens, string vector)>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
                rows.Add((reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2), reader.GetString(3)));
        }
        Assert.NotEmpty(rows);
        foreach (var (_, kind, tokens, vector) in rows)
        {
            Assert.Equal("text", kind);
            Assert.True(tokens > 0);
            var dimensions = vector.Trim('[', ']').Split(',').Length;
            Assert.Equal(1536, dimensions);
        }
        // reference parity: ordinals are 0-based like the python ingestion pipeline
        Assert.Equal(0, rows[0].ordinal);
        // extraction produced the document text, not the unsupported-type fallback
        await using var contentCommand = new Npgsql.NpgsqlCommand(
            "SELECT content FROM chunks WHERE document_id = @id ORDER BY ordinal LIMIT 1", db);
        contentCommand.Parameters.AddWithValue("id", documentId);
        var firstContent = (string)(await contentCommand.ExecuteScalarAsync())!;
        Assert.Contains("operations", firstContent);
        Assert.DoesNotContain("unsupported file type", firstContent);
    }

    [SkippableFact]
    public async Task Upload_Is_Listed_In_Personal_Scope_And_Deletable()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        await client.RegisterAndLoginAsync($"list-{Guid.NewGuid():N}@example.com");

        var document = await client.UploadTextDocumentAsync("hello docsage world", filename: "hello.txt");
        var documentId = document.GetProperty("id").GetGuid();

        var list = await client.GetAsync("/api/documents?scope=personal");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        using var items = await list.ReadJsonAsync();
        var ids = items.RootElement.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("id").GetGuid()).ToList();
        Assert.Contains(documentId, ids);

        var deleted = await client.DeleteAsync($"/api/documents/{documentId}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);

        var missing = await client.GetAsync($"/api/documents/{documentId}");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }
}

[Collection("database")]
public sealed class AccessControlTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [SkippableFact]
    public async Task Personal_Documents_Are_Isolated_Between_Users()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var userA = _factory.CreateClient();
        using var userB = _factory.CreateClient();
        await userA.RegisterAndLoginAsync($"owner-{Guid.NewGuid():N}@example.com", displayName: "Owner");
        await userB.RegisterAndLoginAsync($"other-{Guid.NewGuid():N}@example.com", displayName: "Other");

        var document = await userA.UploadTextDocumentAsync("private strategy notes for user A only");
        var documentId = document.GetProperty("id").GetGuid();

        var stranger = await userB.GetAsync($"/api/documents/{documentId}");
        Assert.Equal(HttpStatusCode.NotFound, stranger.StatusCode);

        var strangerList = await userB.GetAsync("/api/documents?scope=personal");
        using var listJson = await strangerList.ReadJsonAsync();
        Assert.Equal(0, listJson.RootElement.GetProperty("items").GetArrayLength());

        var owner = await userA.GetAsync($"/api/documents/{documentId}");
        Assert.Equal(HttpStatusCode.OK, owner.StatusCode);

        var strangerDelete = await userB.DeleteAsync($"/api/documents/{documentId}");
        Assert.Equal(HttpStatusCode.Forbidden, strangerDelete.StatusCode);
    }

    [SkippableFact]
    public async Task Unauthenticated_Requests_Are_Rejected()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var anonymous = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/documents?scope=personal")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/documents")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/topics")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/admin/overview")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/auth/me")).StatusCode);
    }
}
