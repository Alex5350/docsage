using System.Net;
using System.Net.Http.Json;

namespace Docsage.Api.Tests;

/// <summary>
/// Auth contract regressions: registration signs the account in immediately
/// (session cookie on the register response), failed logins keep the exact
/// "Invalid credentials" detail, and the 8-character password floor holds.
/// </summary>
[Collection("database")]
public sealed class AuthRegressionTests(TestDatabaseFixture fixture) : IAsyncLifetime
{
    private readonly ApiFactory _factory = new(fixture);

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [SkippableFact]
    public async Task Register_Sets_Session_Cookie_That_Authenticates_Me_Without_Login()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        var email = $"reg-{Guid.NewGuid():N}@example.com";

        var register = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "password123", display_name = "Reg" });
        Assert.True(register.StatusCode == HttpStatusCode.Created,
            $"register failed: {(int)register.StatusCode} {await register.Content.ReadAsStringAsync()}");
        using var registered = await register.ReadJsonAsync();
        var userId = registered.RootElement.GetProperty("id").GetGuid();

        // Registration starts the session: the cookie must be on THIS response.
        var setCookies = register.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.ToList() : [];
        Assert.Contains(setCookies, cookie => cookie.StartsWith("docsage_session="));

        // ...and it must authenticate /me with no separate login round-trip.
        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        using var meJson = await me.ReadJsonAsync();
        Assert.Equal(userId, meJson.RootElement.GetProperty("id").GetGuid());
        Assert.Equal(email, meJson.RootElement.GetProperty("email").GetString());
    }

    [SkippableFact]
    public async Task Failed_Login_Returns_Invalid_Credentials_Detail()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        var email = $"badlogin-{Guid.NewGuid():N}@example.com";
        var register = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "password123", display_name = "Bad Login" });
        register.EnsureSuccessStatusCode();

        var badLogin = await client.PostAsJsonAsync("/api/auth/login",
            new { email, password = "wrong-password" });
        Assert.Equal(HttpStatusCode.Unauthorized, badLogin.StatusCode);
        using var body = await badLogin.ReadJsonAsync();
        Assert.Equal("Invalid credentials", body.RootElement.GetProperty("detail").GetString());
    }

    [SkippableFact]
    public async Task Seven_Character_Password_Register_Is_Unprocessable()
    {
        Skip.IfNot(fixture.Available, "Postgres at localhost:5433 is not reachable");
        using var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/register",
            new { email = $"seven-{Guid.NewGuid():N}@example.com", password = "seven77", display_name = "S" });
        Assert.True(response.StatusCode == HttpStatusCode.UnprocessableEntity,
            await response.Content.ReadAsStringAsync());
        using var body = await response.ReadJsonAsync();
        Assert.Contains("8 characters", body.RootElement.GetProperty("detail").GetString());
    }
}
