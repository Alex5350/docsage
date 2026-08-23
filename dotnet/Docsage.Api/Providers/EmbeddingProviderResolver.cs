using Docsage.Api.Infrastructure;

namespace Docsage.Api.Providers;

/// <summary>
/// Resolves the embedding provider for a document: the one chosen at upload, falling back to
/// the deterministic demo provider when the required API key is not configured (demo mode).
/// The resolved provider's name is what the query must be embedded with during retrieval.
/// </summary>
public sealed class EmbeddingProviderResolver(
    DemoEmbeddingProvider demo,
    GeminiEmbeddingProvider gemini,
    OpenAiEmbeddingProvider openAi,
    DocsageOptions options)
{
    public IEmbeddingProvider Resolve(string requested) => requested switch
    {
        "gemini" when options.GeminiConfigured => gemini,
        "openai" when options.OpenAiConfigured => openAi,
        _ => demo,
    };
}

public static class EmbeddingProviderExtensions
{
    public static IServiceCollection AddEmbeddingProviders(this IServiceCollection services)
    {
        services.AddDemoEmbeddingProvider();
        services.AddHttpClient<GeminiEmbeddingProvider>();
        services.AddHttpClient<OpenAiEmbeddingProvider>();
        services.AddSingleton<EmbeddingProviderResolver>();
        return services;
    }
}
