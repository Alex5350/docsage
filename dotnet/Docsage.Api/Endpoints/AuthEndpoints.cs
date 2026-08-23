using Dapper;
using Docsage.Api.Infrastructure;
using Docsage.Api.Models;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Npgsql;

namespace Docsage.Api.Endpoints;

public sealed record RegisterRequest(string Email, string Password, string DisplayName);
public sealed record LoginRequest(string Email, string Password);

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/register", async (RegisterRequest body, NpgsqlConnection db, IPasswordHasher hasher) =>
        {
            var email = body.Email?.Trim().ToLowerInvariant() ?? "";
            if (!email.Contains('@') || email.Length < 3)
                return ApiError.Validation("A valid email is required");
            if (string.IsNullOrWhiteSpace(body.Password) || body.Password.Length < 8)
                return ApiError.Validation("Password must be at least 8 characters");
            if (string.IsNullOrWhiteSpace(body.DisplayName))
                return ApiError.Validation("display_name is required");

            try
            {
                var user = await db.QuerySingleAsync<UserRow>(
                    """
                    INSERT INTO users (id, email, password_hash, display_name)
                    VALUES (@Id, @Email, @PasswordHash, @DisplayName)
                    RETURNING id, email, password_hash, display_name, role, created_at
                    """,
                    new { Id = Guid.NewGuid(), Email = email, PasswordHash = hasher.Hash(body.Password), DisplayName = body.DisplayName.Trim() });
                return TypedResults.Created($"/api/auth/me", new UserDto(user.Id, user.Email, user.DisplayName, user.Role));
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return ApiError.Conflict("Email already registered");
            }
        });

        group.MapPost("/login", async (LoginRequest body, NpgsqlConnection db, IPasswordHasher hasher, ISessionService sessions) =>
        {
            var email = body.Email?.Trim().ToLowerInvariant() ?? "";
            var user = await db.QuerySingleOrDefaultAsync<UserRow>(
                "SELECT id, email, password_hash, display_name, role, created_at FROM users WHERE email = @email",
                new { email });
            if (user is null || !hasher.Verify(user.PasswordHash, body.Password ?? ""))
                return ApiError.Unauthorized("Invalid email or password");

            await sessions.StartSessionAsync(user.Id);
            return TypedResults.Ok(new UserDto(user.Id, user.Email, user.DisplayName, user.Role));
        });

        group.MapPost("/logout", async (ISessionService sessions) =>
        {
            await sessions.EndSessionAsync();
            return TypedResults.NoContent();
        });

        group.MapGet("/me", async (ISessionService sessions) =>
            await sessions.ResolveUserAsync() is { } user
                ? TypedResults.Ok(new UserDto(user.Id, user.Email, user.DisplayName, user.Role))
                : ApiError.Unauthorized());

        return app;
    }
}
