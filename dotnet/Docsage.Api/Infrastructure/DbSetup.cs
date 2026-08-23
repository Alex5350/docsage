using Dapper;
using Npgsql;
using Pgvector.Npgsql;

namespace Docsage.Api.Infrastructure;

/// <summary>
/// Owns the single NpgsqlDataSource (one pooled connection factory) shared by request handlers
/// and the background ingestion pipeline. Dapper is used for query ergonomics; column names are
/// snake_case and matched to underscore-less CLR properties globally.
/// </summary>
public static class DbSetup
{
    public static IServiceCollection AddDocsageDatabase(this IServiceCollection services)
    {
        DefaultTypeMap.MatchNamesWithUnderscores = true;
        SqlMapper.AddTypeHandler(new Pgvector.Dapper.VectorTypeHandler());

        services.AddSingleton(sp =>
        {
            var options = sp.GetRequiredService<DocsageOptions>();
            var info = DatabaseConnectionInfo.Parse(options.DatabaseUrl);
            var builder = new NpgsqlDataSourceBuilder(info.ToNpgsqlConnectionString());
            builder.UseVector();
            return builder.Build();
        });

        // Scoped connection per request, created from the data source so pgvector mappings apply.
        // Dapper opens it lazily on first use.
        services.AddScoped(sp => sp.GetRequiredService<NpgsqlDataSource>().CreateConnection());
        return services;
    }
}
