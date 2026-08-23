namespace Docsage.Api.Infrastructure;

/// <summary>
/// File storage shared with the FastAPI backend. Both backends store uploads at
/// {repo}/backend/var/uploads (constant convention below) so either backend can serve a
/// document ingested by the other: backend/var/uploads/{documentId}/{filename}.
/// </summary>
public sealed class UploadStorage(DocsageOptions options)
{
    public const string SharedRootSuffix = "var/uploads";

    public string Root { get; } = ResolveRoot(options.UploadsDir);

    public string RelativePathFor(Guid documentId, string filename) =>
        $"{SharedRootSuffix}/{documentId}/{filename}";

    public string AbsolutePathFor(Guid documentId, string filename) =>
        Path.Combine(Root, documentId.ToString(), filename);

    private static string ResolveRoot(string? configured)
    {
        string root;
        if (!string.IsNullOrWhiteSpace(configured))
        {
            root = Path.GetFullPath(Environment.ExpandEnvironmentVariables(configured));
        }
        else
        {
            // Walk up from the app/test bin directory to the repo root, where the shared
            // backend/ directory lives. Falls back to ./var/uploads when not found.
            root = Path.Combine(Directory.GetCurrentDirectory(), SharedRootSuffix);
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "backend");
                if (Directory.Exists(candidate))
                {
                    root = Path.Combine(candidate, SharedRootSuffix);
                    break;
                }
            }
        }
        Directory.CreateDirectory(root);
        return root;
    }
}

public static class UploadStorageExtensions
{
    public static IServiceCollection AddUploadStorage(this IServiceCollection services) =>
        services.AddSingleton<UploadStorage>();
}
