namespace Docsage.Api.Providers;

/// <summary>
/// Embedding provider abstraction. Document ingestion embeds batches; retrieval embeds the
/// query in the provider space chosen at upload time. Components are float64 end to end
/// (contract appendix); pgvector narrows to float4 at storage, like the python backend.
/// </summary>
public interface IEmbeddingProvider
{
    string Name { get; }

    Task<double[]> EmbedQueryAsync(string text, CancellationToken ct = default);

    Task<IReadOnlyList<double[]>> EmbedDocumentsAsync(IReadOnlyList<string> texts, CancellationToken ct = default);
}

public static class EmbeddingDimensions
{
    public const int Size = 1536;
}

public static class VectorConversion
{
    /// <summary>Narrows float64 provider output to the pgvector float4 storage type (the
    /// python backend narrows identically when binding list[float]).</summary>
    public static Pgvector.Vector ToPgVector(this IReadOnlyList<double> values) =>
        new(values.Select(v => (float)v).ToArray());
}
