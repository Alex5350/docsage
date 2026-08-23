using Dapper;
using Docsage.Api.Infrastructure;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Npgsql;

namespace Docsage.Api.Endpoints;

public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/health", async (DocsageOptions options, NpgsqlConnection db) =>
        {
            var database = "down";
            try
            {
                await db.ExecuteAsync("SELECT 1");
                database = "up";
            }
            catch (NpgsqlException)
            {
            }

            return Results.Ok(new
            {
                status = "ok",
                database,
                demo_mode = options.EffectiveDemoMode,
                providers = new { gemini = options.GeminiConfigured, openai = options.OpenAiConfigured },
            });
        });
        return app;
    }
}
