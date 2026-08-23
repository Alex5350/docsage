using System.Security.Cryptography;
using Dapper;
using Docsage.Api.Models;
using Microsoft.AspNetCore.Http;
using Npgsql;

namespace Docsage.Api.Infrastructure;

public interface ISessionService
{
    Task<UserRow?> ResolveUserAsync(CancellationToken ct = default);
    Task<string> StartSessionAsync(Guid userId, CancellationToken ct = default);
    Task EndSessionAsync(CancellationToken ct = default);
}

/// <summary>
/// Opaque cookie sessions per contract: random 32-byte hex token in HttpOnly cookie
/// docsage_session, server-side row in sessions, 30-day expiry, SameSite=Lax,
/// Secure only outside development.
/// </summary>
public sealed class SessionService(NpgsqlConnection db, IHttpContextAccessor httpContextAccessor) : ISessionService
{
    public const string CookieName = "docsage_session";
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(30);

    private sealed record SessionUserRow
    {
        public Guid Id { get; init; }
        public string Email { get; init; } = "";
        public string PasswordHash { get; init; } = "";
        public string DisplayName { get; init; } = "";
        public string Role { get; init; } = "";
        public DateTimeOffset CreatedAt { get; init; }
        public DateTimeOffset ExpiresAt { get; init; }
    }

    public async Task<UserRow?> ResolveUserAsync(CancellationToken ct = default)
    {
        var http = httpContextAccessor.HttpContext;
        if (http is null || !http.Request.Cookies.TryGetValue(CookieName, out var token) || string.IsNullOrEmpty(token))
            return null;

        var row = await db.QuerySingleOrDefaultAsync<SessionUserRow>(
            """
            SELECT u.id, u.email, u.password_hash, u.display_name, u.role, u.created_at, s.expires_at
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token = @token
            """,
            new { token });
        if (row is null || row.ExpiresAt <= DateTimeOffset.UtcNow)
            return null;

        return new UserRow
        {
            Id = row.Id,
            Email = row.Email,
            PasswordHash = row.PasswordHash,
            DisplayName = row.DisplayName,
            Role = row.Role,
            CreatedAt = row.CreatedAt,
        };
    }

    public async Task<string> StartSessionAsync(Guid userId, CancellationToken ct = default)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        await db.ExecuteAsync(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (@token, @userId, @expiresAt)",
            new { token, userId, expiresAt = DateTimeOffset.UtcNow.Add(SessionLifetime) });

        var http = httpContextAccessor.HttpContext ?? throw new InvalidOperationException("No HTTP context for session cookie");
        http.Response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = http.RequestServices.GetRequiredService<DocsageOptions>().IsProduction,
            Expires = DateTimeOffset.UtcNow.Add(SessionLifetime),
            Path = "/",
        });
        return token;
    }

    public async Task EndSessionAsync(CancellationToken ct = default)
    {
        var http = httpContextAccessor.HttpContext;
        if (http is not null && http.Request.Cookies.TryGetValue(CookieName, out var token) && !string.IsNullOrEmpty(token))
            await db.ExecuteAsync("DELETE FROM sessions WHERE token = @token", new { token });
        http?.Response.Cookies.Delete(CookieName, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Lax, Path = "/" });
    }
}

public static class SessionServiceExtensions
{
    public static IServiceCollection AddSessions(this IServiceCollection services) =>
        services.AddScoped<ISessionService, SessionService>().AddHttpContextAccessor();
}

/// <summary>Contract error shape helper: every error is {detail: string} with a proper status.</summary>
public static class ApiError
{
    public static IResult Unauthorized(string detail = "Not authenticated") =>
        TypedResults.Json(new { detail }, statusCode: StatusCodes.Status401Unauthorized);

    public static IResult Forbidden(string detail = "Forbidden") =>
        TypedResults.Json(new { detail }, statusCode: StatusCodes.Status403Forbidden);

    public static IResult NotFound(string detail = "Not found") =>
        TypedResults.Json(new { detail }, statusCode: StatusCodes.Status404NotFound);

    public static IResult Conflict(string detail) =>
        TypedResults.Json(new { detail }, statusCode: StatusCodes.Status409Conflict);

    public static IResult Validation(string detail) =>
        TypedResults.Json(new { detail }, statusCode: StatusCodes.Status422UnprocessableEntity);
}
