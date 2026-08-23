using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Docsage.Api.Infrastructure;

namespace Docsage.Api.Tests;

/// <summary>
/// Rate limiting parity with core/rate_limit.py: ten failed logins, then 429
/// with Retry-After (even for the correct password), recovery after the
/// window clears. The test host disables limits globally; this test opts
/// back in and restores the flag.
/// </summary>
[Collection("database")]
public sealed class RateLimitTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [SkippableFact]
    public async Task Login_Blocks_After_Ten_Failures_With_Retry_After()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        RateLimiter.Enabled = true;
        RateLimiter.Reset();
        try
        {
            using var client = _factory.CreateClient();
            var email = $"rl-{Guid.NewGuid():N}@example.com";
            var register = await client.PostAsJsonAsync("/api/auth/register",
                new { email, password = "docsage-demo", display_name = "RL Tester" });
            Assert.True(register.IsSuccessStatusCode);

            for (var i = 0; i < 10; i++)
            {
                var failed = await client.PostAsJsonAsync("/api/auth/login",
                    new { email, password = "wrong-password" });
                Assert.Equal(HttpStatusCode.Unauthorized, failed.StatusCode);
            }

            var blocked = await client.PostAsJsonAsync("/api/auth/login",
                new { email, password = "wrong-password" });
            Assert.Equal((HttpStatusCode)429, blocked.StatusCode);
            Assert.True(blocked.Headers.Contains("Retry-After"));
            var body = await blocked.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Contains("too many failed attempts", body.GetProperty("detail").GetString());

            // even the correct password is refused while the window is hot
            var stillBlocked = await client.PostAsJsonAsync("/api/auth/login",
                new { email, password = "docsage-demo" });
            Assert.Equal((HttpStatusCode)429, stillBlocked.StatusCode);

            // after the window clears (simulated), the correct password succeeds
            RateLimiter.Reset();
            var ok = await client.PostAsJsonAsync("/api/auth/login",
                new { email, password = "docsage-demo" });
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }
        finally
        {
            RateLimiter.Reset();
            RateLimiter.Enabled = false;
        }
    }
}
