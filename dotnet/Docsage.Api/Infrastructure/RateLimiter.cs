using System.Collections.Concurrent;

namespace Docsage.Api.Infrastructure;

/// <summary>
/// In-process sliding-window rate limiting for the auth endpoints, mirroring
/// core/rate_limit.py: login counts FAILED attempts per email+client and
/// clears on success; register counts every attempt per client. Dependency-
/// free and per-process by design (single-instance deployment story). Test
/// hosts can disable via DOCSAGE_RATE_LIMITS=off.
/// </summary>
public static class RateLimiter
{
    public const int LoginFailureLimit = 10;
    public const int RegisterLimit = 10;
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(60);

    private static readonly ConcurrentDictionary<string, ConcurrentQueue<DateTimeOffset>> Hits = new();

    public static bool Enabled { get; set; } = true;

    /// <summary>Records a hit; returns null when allowed, else the retry-after.</summary>
    public static TimeSpan? Check(string key, int limit)
    {
        if (!Enabled)
            return null;
        var now = DateTimeOffset.UtcNow;
        var bucket = Hits.GetOrAdd(key, _ => new ConcurrentQueue<DateTimeOffset>());
        lock (bucket)
        {
            while (bucket.TryPeek(out var oldest) && now - oldest > Window)
                bucket.TryDequeue(out _);
            if (bucket.Count >= limit && bucket.TryPeek(out var currentOldest))
                return Window - (now - currentOldest);
            bucket.Enqueue(now);
            return null;
        }
    }

    public static void Clear(string key) => Hits.TryRemove(key, out _);

    /// <summary>Test isolation only; production never calls this.</summary>
    public static void Reset() => Hits.Clear();
}
