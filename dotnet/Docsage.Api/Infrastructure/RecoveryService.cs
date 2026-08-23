using Dapper;
using Npgsql;

namespace Docsage.Api.Infrastructure;

/// <summary>
/// Startup recovery, mirroring services/recovery.py: fail documents stranded in
/// transient pipeline states by a restart (nothing else moves them), and purge
/// expired session rows that would otherwise accumulate (expiry is otherwise
/// enforced only at read time).
/// </summary>
public static class Recovery
{
    public const string InterruptedMessage = "interrupted by server restart — re-upload";

    public static async Task<(int Failed, int Purged)> SweepAsync(
        NpgsqlConnection db, CancellationToken ct = default)
    {
        var failed = await db.ExecuteAsync(
            """
            UPDATE documents
            SET status = 'failed', status_error = @Message, updated_at = now()
            WHERE status IN ('queued','extracting','enriching','embedding')
              AND updated_at < now() - interval '15 minutes'
            """,
            new { Message = InterruptedMessage });
        var purged = await db.ExecuteAsync(
            "DELETE FROM sessions WHERE expires_at <= now()", ct);
        return (failed, purged);
    }
}

public sealed class RecoveryService(NpgsqlDataSource dataSource, ILogger<RecoveryService> logger)
    : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var db = await dataSource.OpenConnectionAsync(cancellationToken);
        var (failed, purged) = await Recovery.SweepAsync(db, cancellationToken);
        if (failed > 0 || purged > 0)
            logger.LogInformation(
                "Startup recovery: {Failed} stale document(s) failed, {Purged} expired session(s) purged",
                failed, purged);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

public static class RecoveryServiceExtensions
{
    public static IServiceCollection AddRecovery(this IServiceCollection services) =>
        services.AddSingleton<IHostedService, RecoveryService>();
}
