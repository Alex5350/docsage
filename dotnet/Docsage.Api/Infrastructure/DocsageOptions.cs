
namespace Docsage.Api.Infrastructure;

/// <summary>
/// Root configuration. Every value comes from environment variables (lowercase and uppercase both
/// accepted) so the .NET backend can run side-by-side with the FastAPI backend from the same
/// .env file: DOCSAGE_DATABASE_URL, DOCSAGE_SESSION_SECRET, DOCSAGE_DEMO_MODE, DOCSAGE_ENV,
/// GEMINI_API_KEY, DOCSAGE_GEMINI_EMBEDDING_MODEL, DOCSAGE_GEMINI_VISION_MODEL,
/// OPENAI_API_KEY, DOCSAGE_OPENAI_EMBEDDING_MODEL, DOCSAGE_OPENAI_CHAT_MODEL, OPENAI_BASE_URL.
/// </summary>
public sealed class DocsageOptions
{
    public string DatabaseUrl { get; set; } = "postgresql+psycopg://docsage:docsage@localhost:5433/docsage";
    public string SessionSecret { get; set; } = "dev-only-insecure-secret";
    public string Environment { get; set; } = "development";
    public bool? DemoMode { get; set; }
    public string? GeminiApiKey { get; set; }
    public string GeminiEmbeddingModel { get; set; } = "gemini-embedding-001";
    public string GeminiVisionModel { get; set; } = "gemini-2.5-flash";
    public string? OpenAiApiKey { get; set; }
    public string OpenAiEmbeddingModel { get; set; } = "text-embedding-3-small";
    public string OpenAiChatModel { get; set; } = "gpt-5.1";
    public string? OpenAiBaseUrl { get; set; }
    public string? UploadsDir { get; set; }

    public bool IsProduction => Environment.Equals("production", StringComparison.OrdinalIgnoreCase);

    public bool GeminiConfigured => !string.IsNullOrWhiteSpace(GeminiApiKey);

    public bool OpenAiConfigured => !string.IsNullOrWhiteSpace(OpenAiApiKey);

    /// <summary>Demo mode is forced by env var or implied when both provider keys are missing.</summary>
    public bool EffectiveDemoMode => DemoMode ?? !(GeminiConfigured || OpenAiConfigured);
}

/// <summary>Parsed view of the python-style DOCSAGE_DATABASE_URL.</summary>
public sealed record DatabaseConnectionInfo(string Host, int Port, string Database, string Username, string Password)
{
    public string ToNpgsqlConnectionString() =>
        $"Host={Host};Port={Port};Database={Database};Username={Username};Password={Password};Maximum Pool Size=20";

    /// <summary>
    /// Accepts postgresql+psycopg://user:pass@host:port/db (python SQLAlchemy style) as well as
    /// plain postgres:// and postgresql:// URLs. Passwords may contain URL-encoded characters.
    /// </summary>
    public static DatabaseConnectionInfo Parse(string url)
    {
        var trimmed = url.Trim();
        string normalized;
        if (trimmed.StartsWith("postgresql+psycopg://", StringComparison.OrdinalIgnoreCase))
            normalized = "postgresql://" + trimmed["postgresql+psycopg://".Length..];
        else if (trimmed.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase))
            normalized = "postgresql://" + trimmed["postgres://".Length..];
        else
            normalized = trimmed;

        if (!Uri.TryCreate(normalized, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host))
            throw new InvalidOperationException($"Cannot parse DOCSAGE_DATABASE_URL: {url}");

        var userInfo = uri.UserInfo.Split(':', 2);
        return new DatabaseConnectionInfo(
            uri.Host,
            uri.Port <= 0 ? 5432 : uri.Port,
            uri.AbsolutePath.TrimStart('/'),
            Uri.UnescapeDataString(userInfo[0]),
            userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : "");
    }
}

public static class DocsageOptionsExtensions
{
    public static IServiceCollection AddDocsageOptions(this IServiceCollection services)
    {
        services.AddSingleton(sp =>
        {
            var config = sp.GetRequiredService<IConfiguration>();
            var env = sp.GetRequiredService<IHostEnvironment>();
            string? Get(params string[] keys) => keys.Select(config.GetSection).Select(s => s.Value).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

            var options = new DocsageOptions
            {
                DatabaseUrl = Get("DOCSAGE_DATABASE_URL", "Docsage:DatabaseUrl") ?? "postgresql+psycopg://docsage:docsage@localhost:5433/docsage",
                SessionSecret = Get("DOCSAGE_SESSION_SECRET", "Docsage:SessionSecret") ?? "dev-only-insecure-secret",
                Environment = Get("DOCSAGE_ENV", "Docsage:Environment") ?? (env.IsProduction() ? "production" : "development"),
                GeminiApiKey = Get("GEMINI_API_KEY", "Docsage:GeminiApiKey"),
                GeminiEmbeddingModel = Get("DOCSAGE_GEMINI_EMBEDDING_MODEL", "Docsage:GeminiEmbeddingModel") ?? "gemini-embedding-001",
                GeminiVisionModel = Get("DOCSAGE_GEMINI_VISION_MODEL", "Docsage:GeminiVisionModel") ?? "gemini-2.5-flash",
                OpenAiApiKey = Get("OPENAI_API_KEY", "Docsage:OpenAiApiKey"),
                OpenAiEmbeddingModel = Get("DOCSAGE_OPENAI_EMBEDDING_MODEL", "Docsage:OpenAiEmbeddingModel") ?? "text-embedding-3-small",
                OpenAiChatModel = Get("DOCSAGE_OPENAI_CHAT_MODEL", "Docsage:OpenAiChatModel") ?? "gpt-5.1",
                OpenAiBaseUrl = Get("OPENAI_BASE_URL", "Docsage:OpenAiBaseUrl"),
                UploadsDir = Get("DOCSAGE_UPLOAD_DIR", "Docsage:UploadsDir"),
            };
            if (bool.TryParse(Get("DOCSAGE_DEMO_MODE", "Docsage:DemoMode"), out var demo))
                options.DemoMode = demo;
            return options;
        });
        return services;
    }
}
