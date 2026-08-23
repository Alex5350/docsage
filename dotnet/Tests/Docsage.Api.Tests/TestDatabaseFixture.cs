using System.Data.Common;
using Npgsql;

namespace Docsage.Api.Tests;

/// <summary>
/// Creates and drops the throwaway docsage_dotnet_test database (localhost:5433, docker
/// compose db) and applies the CONTRACT-transcribed schema. Tests skip cleanly when the
/// database server is unreachable.
/// </summary>
public sealed class TestDatabaseFixture : IAsyncLifetime
{
    public const string DatabaseName = "docsage_dotnet_test";
    public const string Host = "localhost";
    public const int Port = 5433;
    public const string User = "docsage";
    public const string Password = "docsage";

    public bool Available { get; private set; }
    public string DatabaseUrl => $"postgresql+psycopg://{User}:{Password}@{Host}:{Port}/{DatabaseName}";
    public string UploadsDir { get; } =
        Path.Combine(Path.GetTempPath(), $"docsage-dotnet-test-{Guid.NewGuid():N}", "var", "uploads");

    public async Task InitializeAsync()
    {
        try
        {
            await using var admin = new NpgsqlConnection(AdminConnectionString);
            await admin.OpenAsync();
            await using (var drop = new NpgsqlCommand(
                $"DROP DATABASE IF EXISTS {DatabaseName} WITH (FORCE)", admin))
                await drop.ExecuteNonQueryAsync();
            await using (var create = new NpgsqlCommand($"CREATE DATABASE {DatabaseName}", admin))
                await create.ExecuteNonQueryAsync();
        }
        catch (DbException)
        {
            Available = false;
            return;
        }

        try
        {
            var schema = await File.ReadAllTextAsync("schema.sql");
            await using var db = new NpgsqlConnection(TestConnectionString);
            await db.OpenAsync();
            await using var command = new NpgsqlCommand(schema, db);
            await command.ExecuteNonQueryAsync();
            Available = true;
        }
        catch (DbException)
        {
            Available = false;
        }
    }

    public async Task DisposeAsync()
    {
        if (!Available)
            return;
        try
        {
            await using var admin = new NpgsqlConnection(AdminConnectionString);
            await admin.OpenAsync();
            await using var drop = new NpgsqlCommand(
                $"DROP DATABASE IF EXISTS {DatabaseName} WITH (FORCE)", admin);
            await drop.ExecuteNonQueryAsync();
        }
        catch (DbException)
        {
            // leftover test database is harmless
        }
        var tempRoot = Directory.GetParent(UploadsDir)?.Parent;
        if (tempRoot is not null && Directory.Exists(tempRoot.FullName))
            Directory.Delete(tempRoot.FullName, recursive: true);
    }

    private static string AdminConnectionString => $"Host={Host};Port={Port};Database=postgres;Username={User};Password={Password}";
    public static string TestConnectionString => $"Host={Host};Port={Port};Database={DatabaseName};Username={User};Password={Password}";
}

[CollectionDefinition("database")]
public sealed class DatabaseCollection : ICollectionFixture<TestDatabaseFixture>;
