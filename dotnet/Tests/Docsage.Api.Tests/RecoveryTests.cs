using Dapper;
using Docsage.Api.Infrastructure;
using Npgsql;

namespace Docsage.Api.Tests;

/// <summary>
/// Startup recovery parity with services/recovery.py: stale transient
/// documents fail (fresh ones and terminal states untouched), expired
/// sessions purge.
/// </summary>
[Collection("database")]
public sealed class RecoveryTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<Guid> RegisterAsync()
    {
        using var client = _factory.CreateClient();
        var email = $"recovery-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsync("/api/auth/register",
            new StringContent(
                $$"""{"email":"{{email}}","password":"docsage-demo","display_name":"Recovery Tester"}""",
                System.Text.Encoding.UTF8, "application/json"));
        Assert.True(response.IsSuccessStatusCode);
        await using var db = new NpgsqlConnection(TestDatabaseFixture.TestConnectionString);
        await db.OpenAsync();
        return await db.ExecuteScalarAsync<Guid>("SELECT id FROM users WHERE email = @email", new { email });
    }

    [SkippableFact]
    public async Task Stale_Transient_Documents_Fail_But_Fresh_And_Terminal_Survive()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        var ownerId = await RegisterAsync();

        await using var db = new NpgsqlConnection(TestDatabaseFixture.TestConnectionString);
        await db.OpenAsync();
        var stale = await InsertAndReturnIdAsync(db, ownerId, "extracting", 30);
        var fresh = await InsertAndReturnIdAsync(db, ownerId, "enriching", 2);
        var ready = await InsertAndReturnIdAsync(db, ownerId, "ready", 180);

        var (failed, _) = await Recovery.SweepAsync(db);

        Assert.Equal(1, failed);
        Assert.Equal("failed", await StatusOfAsync(db, stale));
        Assert.Equal(Recovery.InterruptedMessage, await ErrorOfAsync(db, stale));
        Assert.Equal("enriching", await StatusOfAsync(db, fresh));
        Assert.Equal("ready", await StatusOfAsync(db, ready));
    }

    [SkippableFact]
    public async Task Expired_Sessions_Purge_On_Sweep()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        var ownerId = await RegisterAsync();

        await using var db = new NpgsqlConnection(TestDatabaseFixture.TestConnectionString);
        await db.OpenAsync();
        var before = await db.ExecuteScalarAsync<long>("SELECT count(*) FROM sessions WHERE user_id = @ownerId", new { ownerId });
        await db.ExecuteAsync(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (@t, @ownerId, now() - interval '1 day')",
            new { t = $"expired-{Guid.NewGuid():N}", ownerId });

        var (_, purged) = await Recovery.SweepAsync(db);

        Assert.Equal(1, purged);
        var after = await db.ExecuteScalarAsync<long>("SELECT count(*) FROM sessions WHERE user_id = @ownerId", new { ownerId });
        Assert.Equal(before, after); // only the expired row vanished
    }

    private static async Task<Guid> InsertAndReturnIdAsync(
        NpgsqlConnection db, Guid ownerId, string status, int ageMinutes)
    {
        var id = Guid.NewGuid();
        await db.ExecuteAsync(
            """
            INSERT INTO documents (id, owner_id, scope, title, source_filename, mime_type, storage_path,
                                   size_bytes, checksum_sha256, status, embedding_provider, embedding_model, updated_at)
            VALUES (@Id, @OwnerId, 'personal', @Title, @Filename, 'text/plain', 'var/x', 10, '0', @Status,
                    'demo', 'demo-v1', now() - make_interval(mins => @AgeMinutes))
            """,
            new { Id = id, OwnerId = ownerId, Title = $"doc-{id:N}"[..16], Filename = "doc.txt", Status = status, AgeMinutes = ageMinutes });
        return id;
    }

    private static Task<string> StatusOfAsync(NpgsqlConnection db, Guid id) =>
        db.ExecuteScalarAsync<string>("SELECT status FROM documents WHERE id = @id", new { id })
        ?? throw new InvalidOperationException("row missing");

    private static Task<string?> ErrorOfAsync(NpgsqlConnection db, Guid id) =>
        db.ExecuteScalarAsync<string?>("SELECT status_error FROM documents WHERE id = @id", new { id });
}
