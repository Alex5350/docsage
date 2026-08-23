using System.Text.Json;
using System.Net;
using System.Net.Http.Json;
using Npgsql;

namespace Docsage.Api.Tests;

[Collection("database")]
public sealed class ReviewFlowTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static async Task PromoteToAdminAsync(string email)
    {
        await using var db = new NpgsqlConnection(TestDatabaseFixture.TestConnectionString);
        await db.OpenAsync();
        await using var command = new NpgsqlCommand(
            "UPDATE users SET role = 'admin' WHERE email = @email", db);
        command.Parameters.AddWithValue("email", email);
        await command.ExecuteNonQueryAsync();
    }

    [SkippableFact]
    public async Task Library_Document_Goes_Pending_SME_Then_Approved_Visible_To_All()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var adminClient = _factory.CreateClient();
        using var smeClient = _factory.CreateClient();
        using var memberClient = _factory.CreateClient();

        var adminEmail = $"admin-{Guid.NewGuid():N}@example.com";
        var smeEmail = $"sme-{Guid.NewGuid():N}@example.com";
        await adminClient.RegisterAndLoginAsync(adminEmail, displayName: "Admin");
        await PromoteToAdminAsync(adminEmail);
        await adminClient.LoginAsync(adminEmail, "password123"); // fresh session with admin role
        await smeClient.RegisterAndLoginAsync(smeEmail, displayName: "Sme");
        await memberClient.RegisterAndLoginAsync($"member-{Guid.NewGuid():N}@example.com", displayName: "Member");

        // topic + SME designation by admin
        var topicResponse = await adminClient.PostAsJsonAsync("/api/topics",
            new { name = $"Compliance-{Guid.NewGuid():N}"[..40], description = "Compliance documents" });
        Assert.True(topicResponse.StatusCode == HttpStatusCode.Created, $"topics failed: {await topicResponse.Content.ReadAsStringAsync()}");
        using var topic = await topicResponse.ReadJsonAsync();
        var topicId = topic.RootElement.GetProperty("id").GetString();

        // the SME user's id comes from /api/auth/me on their own session
        using var smeMe = await smeClient.GetAsync("/api/auth/me");
        using var smeMeJson = await smeMe.ReadJsonAsync();
        var smeId = smeMeJson.RootElement.GetProperty("id").GetString();
        Assert.NotNull(smeId);

        var designate = await adminClient.PostAsJsonAsync($"/api/topics/{topicId}/smes", new { user_id = smeId });
        Assert.Equal(HttpStatusCode.Created, designate.StatusCode);

        // library upload (admin only) with topic
        var document = await adminClient.UploadTextDocumentAsync(
            "Agency-wide records retention policy. All personnel must follow the retention schedule. " +
            "Records are kept for seven years unless a longer statutory period applies. Destruction " +
            "requires SME sign-off and a logged approval.",
            filename: "retention-policy.txt", scope: "library", topicId: topicId, title: "Retention Policy");
        var documentId = document.GetProperty("id").GetGuid();

        var ready = await adminClient.WaitForStatusAsync(documentId);
        Assert.Equal("pending_sme", ready.GetProperty("review_status").GetString());
        Assert.True(ready.GetProperty("pending_reviewer").GetBoolean());
        Assert.NotNull(ready.GetProperty("topic").GetProperty("id").GetString());

        // member cannot see the unapproved library doc
        var memberList = await memberClient.GetAsync("/api/documents?scope=library");
        using var memberItems = await memberList.ReadJsonAsync();
        Assert.Equal(0, memberItems.RootElement.GetProperty("items").GetArrayLength());
        var memberDetail = await memberClient.GetAsync($"/api/documents/{documentId}");
        Assert.Equal(HttpStatusCode.NotFound, memberDetail.StatusCode);

        // SME sees the pending review, approves it
        var pending = await smeClient.GetAsync("/api/reviews/pending");
        Assert.True(pending.StatusCode == HttpStatusCode.OK, $"pending failed: {await pending.Content.ReadAsStringAsync()}");
        using var pendingJson = await pending.ReadJsonAsync();
        Assert.Contains(documentId, pendingJson.RootElement.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("id").GetGuid()));

        var approve = await smeClient.PostAsJsonAsync($"/api/reviews/{documentId}",
            new { decision = "approved", note = "LGTM" });
        Assert.Equal(HttpStatusCode.OK, approve.StatusCode);
        using var approved = await approve.ReadJsonAsync();
        Assert.Equal("approved", approved.RootElement.GetProperty("review_status").GetString());

        // now visible to everyone in library scope, with the approval recorded
        var memberListAfter = await memberClient.GetAsync("/api/documents?scope=library");
        using var after = await memberListAfter.ReadJsonAsync();
        Assert.Contains(documentId, after.RootElement.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("id").GetGuid()));

        var detail = await memberClient.GetAsync($"/api/documents/{documentId}");
        using var detailJson = await detail.ReadJsonAsync();
        var approvals = detailJson.RootElement.GetProperty("approvals");
        Assert.Equal(1, approvals.GetArrayLength());
        Assert.Equal("approved", approvals[0].GetProperty("decision").GetString());
        Assert.Equal("LGTM", approvals[0].GetProperty("note").GetString());

        // SME of an unrelated topic gets 403 for review of an already-decided doc (conflict path)
        var reApprove = await smeClient.PostAsJsonAsync($"/api/reviews/{documentId}",
            new { decision = "rejected" });
        Assert.Equal(HttpStatusCode.Conflict, reApprove.StatusCode);
    }

    [SkippableFact]
    public async Task Non_Admin_Cannot_Upload_Library_Documents()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        await client.RegisterAndLoginAsync($"plain-{Guid.NewGuid():N}@example.com");
        var response = await client.PostUploadAsync("x", scope: "library");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}

[Collection("database")]
public sealed class ChatSseTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [SkippableFact]
    public async Task Chat_Message_Streams_Deltas_Citations_And_Done_With_Demo_Provider()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        await client.RegisterAndLoginAsync($"chat-{Guid.NewGuid():N}@example.com");

        var document = await client.UploadTextDocumentAsync(
            "The orbital tea kettle steeps tea in microgravity using capillary action. " +
            "Crews onboard the station brew oolong and green tea every afternoon. " +
            "Maintenance requires descaling the kettle weekly with citric acid solution.");
        var documentId = document.GetProperty("id").GetGuid();
        await client.WaitForStatusAsync(documentId);

        var createSession = await client.PostAsJsonAsync("/api/chat/sessions", new { scope = "personal" });
        Assert.True(createSession.StatusCode == HttpStatusCode.Created, $"chat session failed: {await createSession.Content.ReadAsStringAsync()}");
        using var session = await createSession.ReadJsonAsync();
        var sessionId = session.RootElement.GetProperty("id").GetString();
        Assert.Equal("personal", session.RootElement.GetProperty("scope").GetString());

        // user chat session cannot be created with admin scope by a regular user
        var adminScope = await client.PostAsJsonAsync("/api/chat/sessions", new { scope = "admin" });
        Assert.Equal(HttpStatusCode.Forbidden, adminScope.StatusCode);

        using var messageRequest = new HttpRequestMessage(HttpMethod.Post, $"/api/chat/sessions/{sessionId}/messages")
        {
            Content = JsonContent.Create(new { content = "How do crews brew tea in space?" }),
        };
        using var messageResponse = await client.SendAsync(messageRequest, HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(HttpStatusCode.OK, messageResponse.StatusCode);
        Assert.Equal("text/event-stream", messageResponse.Content.Headers.ContentType?.MediaType);

        var body = await messageResponse.Content.ReadAsStringAsync();
        var events = body.Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Where(line => line.StartsWith("data: "))
            .Select(line => JsonDocument.Parse(line["data: ".Length..]).RootElement.Clone())
            .ToList();
        Assert.NotEmpty(events);

        var deltas = events.Where(e => e.GetProperty("type").GetString() == "delta").ToList();
        var citationEvents = events.Where(e => e.GetProperty("type").GetString() == "citations").ToList();
        var doneEvents = events.Where(e => e.GetProperty("type").GetString() == "done").ToList();
        Assert.NotEmpty(deltas);
        Assert.Single(citationEvents);
        Assert.Single(doneEvents);

        var answer = string.Concat(deltas.Select(d => d.GetProperty("text").GetString()));
        Assert.StartsWith("Demo mode — extractive answer.", answer);

        var citations = citationEvents[0].GetProperty("citations");
        Assert.Equal(1, citations.GetArrayLength());
        Assert.Equal(documentId, citations[0].GetProperty("document_id").GetGuid());
        Assert.Equal("demo", document.GetProperty("embedding_provider").GetString());
        Assert.True(Math.Abs(citations[0].GetProperty("score").GetDouble()) <= 1.0);
        Assert.False(string.IsNullOrEmpty(citations[0].GetProperty("snippet").GetString()));

        var done = doneEvents[0];
        var messageId = done.GetProperty("message_id").GetGuid();
        Assert.NotEqual(default, messageId);
        Assert.Equal("done", events[^1].GetProperty("type").GetString());

        // history persisted with citations
        var history = await client.GetAsync($"/api/chat/sessions/{sessionId}/messages");
        Assert.Equal(HttpStatusCode.OK, history.StatusCode);
        using var historyJson = await history.ReadJsonAsync();
        var items = historyJson.RootElement.GetProperty("items");
        Assert.Equal(2, items.GetArrayLength());
        Assert.Equal("user", items[0].GetProperty("role").GetString());
        Assert.Equal("assistant", items[1].GetProperty("role").GetString());
        Assert.Equal(messageId, items[1].GetProperty("id").GetGuid());
        Assert.Equal(1, items[1].GetProperty("citations").GetArrayLength());
    }
}

[Collection("database")]
public sealed class AdminOverviewTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [SkippableFact]
    public async Task Overview_Counts_Users_Documents_And_Pipeline_Statuses()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        var adminEmail = $"overview-{Guid.NewGuid():N}@example.com";
        await client.RegisterAndLoginAsync(adminEmail);
        await PromoteToAdminAsync(adminEmail);
        await client.LoginAsync(adminEmail, "password123");

        var document = await client.UploadTextDocumentAsync("admin overview fixture document");
        var documentId = document.GetProperty("id").GetGuid();
        await client.WaitForStatusAsync(documentId);

        var overview = await client.GetAsync("/api/admin/overview");
        Assert.Equal(HttpStatusCode.OK, overview.StatusCode);
        using var json = await overview.ReadJsonAsync();
        var root = json.RootElement;
        Assert.True(root.GetProperty("users").GetInt64() >= 1);
        Assert.True(root.GetProperty("total_documents").GetInt64() >= 1);
        Assert.True(root.GetProperty("personal_documents").GetInt64() >= 1);
        Assert.True(root.GetProperty("pending_reviews").GetInt64() >= 0);
        // presence, not exact count: sibling tests in this collection share the
        // database and legitimately add ready documents
        Assert.True(root.GetProperty("pipeline").GetProperty("ready").GetInt64() >= 1);

        // non-admin gets 403
        using var plain = _factory.CreateClient();
        await plain.RegisterAndLoginAsync($"plain-{Guid.NewGuid():N}@example.com");
        Assert.Equal(HttpStatusCode.Forbidden, (await plain.GetAsync("/api/admin/overview")).StatusCode);
    }

    private static async Task PromoteToAdminAsync(string email)
    {
        await using var db = new NpgsqlConnection(TestDatabaseFixture.TestConnectionString);
        await db.OpenAsync();
        await using var command = new NpgsqlCommand(
            "UPDATE users SET role = 'admin' WHERE email = @email", db);
        command.Parameters.AddWithValue("email", email);
        await command.ExecuteNonQueryAsync();
    }
}
