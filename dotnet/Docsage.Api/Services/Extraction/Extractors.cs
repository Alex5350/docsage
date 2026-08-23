using System.Text;
using System.Text.RegularExpressions;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using UglyToad.PdfPig;

namespace Docsage.Api.Services.Extraction;

/// <summary>
/// Ordered piece produced by extraction; kinds match the chunks.kind check constraint. Image
/// parts optionally carry their bytes so enrichment can caption them with Gemini vision.
/// </summary>
public sealed record ExtractedPart(
    string Kind,
    string Content,
    int? Page = null,
    byte[]? ImageBytes = null,
    string? ImageMime = null,
    string? ImageName = null);

public static class PartKinds
{
    public const string Text = "text";
    public const string Table = "table";
    public const string ImageDescription = "image_description";
}

public interface IPartExtractor
{
    bool Supports(string mimeType);
    Task<IReadOnlyList<ExtractedPart>> ExtractAsync(string path, string mimeType, CancellationToken ct = default);
}

/// <summary>txt / markdown / csv: raw text as a single part.</summary>
public sealed class TextExtractor : IPartExtractor
{
    public bool Supports(string mimeType) => mimeType is "text/plain" or "text/markdown" or "text/csv";

    public async Task<IReadOnlyList<ExtractedPart>> ExtractAsync(string path, string mimeType, CancellationToken ct = default)
    {
        var content = await File.ReadAllTextAsync(path, ct);
        return string.IsNullOrWhiteSpace(content) ? [] : [new ExtractedPart(PartKinds.Text, content)];
    }
}

/// <summary>PNG/JPEG: an image part awaiting caption enrichment.</summary>
public sealed class ImageExtractor : IPartExtractor
{
    public bool Supports(string mimeType) => mimeType is "image/png" or "image/jpeg";

    public Task<IReadOnlyList<ExtractedPart>> ExtractAsync(string path, string mimeType, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<ExtractedPart>>(
        [
            new ExtractedPart(
                PartKinds.ImageDescription,
                $"[image: {Path.GetFileName(path)} — caption pending]",
                ImageBytes: File.ReadAllBytes(path),
                ImageMime: mimeType,
                ImageName: Path.GetFileName(path)),
        ]);
}

/// <summary>
/// docx via DocumentFormat.OpenXml: paragraphs in order, tables serialized as markdown pipes,
/// inline images (blip references) emitted as image parts carrying the image part filename.
/// </summary>
public sealed class DocxExtractor : IPartExtractor
{
    public bool Supports(string mimeType) =>
        mimeType is "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    public Task<IReadOnlyList<ExtractedPart>> ExtractAsync(string path, string mimeType, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            using var doc = WordprocessingDocument.Open(path, false);
            var main = doc.MainDocumentPart ?? throw new InvalidOperationException("docx has no main document part");
            var document = main.Document ?? throw new InvalidOperationException("docx has no document");
            var body = document.Body ?? throw new InvalidOperationException("docx has no body");

            var parts = new List<ExtractedPart>();
            foreach (var element in body.ChildElements)
            {
                switch (element)
                {
                    case Paragraph paragraph:
                        foreach (var blip in paragraph.Descendants<DocumentFormat.OpenXml.Drawing.Blip>())
                        {
                            if (blip.Embed?.Value is not { } embedId)
                                continue;
                            if (main.GetPartById(embedId) is not ImagePart imagePart)
                                continue;
                            var filename = imagePart.Uri.OriginalString.Split('/').Last();
                            using var imageStream = imagePart.GetStream();
                            using var buffered = new MemoryStream();
                            await imageStream.CopyToAsync(buffered, ct);
                            parts.Add(new ExtractedPart(
                                PartKinds.ImageDescription,
                                $"[image: {filename} — caption pending]",
                                ImageBytes: buffered.ToArray(),
                                ImageMime: imagePart.ContentType,
                                ImageName: filename));
                        }
                        if (paragraph.InnerText.Trim() is { Length: > 0 } text)
                            parts.Add(new ExtractedPart(PartKinds.Text, text));
                        break;
                    case Table table:
                        if (TableToMarkdown(table) is { Length: > 0 } markdown)
                            parts.Add(new ExtractedPart(PartKinds.Table, markdown));
                        break;
                }
            }
            return (IReadOnlyList<ExtractedPart>)parts;
        }, ct);

    private static string TableToMarkdown(Table table)
    {
        var rows = new List<IReadOnlyList<string>>();
        foreach (var row in table.Elements<TableRow>())
        {
            var cells = row.Elements<TableCell>()
                .Select(c => c.InnerText.Trim().Replace("|", "\\|"))
                .ToList();
            if (cells.Count > 0)
                rows.Add(cells);
        }
        if (rows.Count == 0)
            return string.Empty;

        var sb = new StringBuilder();
        Markdown.AppendRow(sb, rows[0]);
        Markdown.AppendSeparator(sb, rows[0].Count);
        for (var i = 1; i < rows.Count; i++)
            Markdown.AppendRow(sb, rows[i]);
        return sb.ToString();
    }
}

/// <summary>Markdown pipe-table helpers shared by the docx/xlsx/pdf extractors.</summary>
internal static class Markdown
{
    public static void AppendRow(StringBuilder sb, IReadOnlyList<string> cells)
    {
        sb.Append("| ").Append(string.Join(" | ", cells)).AppendLine(" |");
    }

    public static void AppendSeparator(StringBuilder sb, int columnCount)
    {
        sb.Append("| ").Append(string.Join(" | ", Enumerable.Repeat("---", Math.Max(1, columnCount)))).AppendLine(" |");
    }
}

/// <summary>xlsx via ClosedXML: each worksheet's used range becomes a markdown table part, prefixed with the sheet name.</summary>
public sealed class XlsxExtractor : IPartExtractor
{
    public bool Supports(string mimeType) => mimeType is "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public Task<IReadOnlyList<ExtractedPart>> ExtractAsync(string path, string mimeType, CancellationToken ct = default) =>
        Task.Run<IReadOnlyList<ExtractedPart>>(() =>
        {
            using var workbook = new ClosedXML.Excel.XLWorkbook(path);

            var parts = new List<ExtractedPart>();
            foreach (var sheet in workbook.Worksheets)
            {
                var used = sheet.RangeUsed();
                if (used is null)
                    continue;
                var columnCount = used.ColumnCount();

                var sb = new StringBuilder();
                sb.AppendLine($"Sheet: {sheet.Name}").AppendLine();
                for (var rowIndex = 1; rowIndex <= used.RowCount(); rowIndex++)
                {
                    var row = used.Row(rowIndex);
                    var cells = Enumerable.Range(1, columnCount)
                        .Select(col => row.Cell(col).GetString().Replace("|", "\\|"))
                        .ToList();
                    Markdown.AppendRow(sb, cells);
                    if (rowIndex == 1)
                        Markdown.AppendSeparator(sb, columnCount);
                }
                parts.Add(new ExtractedPart(PartKinds.Table, sb.ToString()));
            }
            return parts;
        }, ct);
}

/// <summary>
/// pdf via PdfPig: per-page text; tables best-effort — runs of at least two consecutive lines
/// whose cells are separated by 2+ spaces become pipe rows.
/// </summary>
public sealed class PdfExtractor : IPartExtractor
{
    private static readonly Regex CellSplit = new("(?:  )+", RegexOptions.Compiled);

    public bool Supports(string mimeType) => mimeType is "application/pdf";

    public Task<IReadOnlyList<ExtractedPart>> ExtractAsync(string path, string mimeType, CancellationToken ct = default) =>
        Task.Run<IReadOnlyList<ExtractedPart>>(() =>
        {
            using var doc = PdfDocument.Open(path);

            var parts = new List<ExtractedPart>();
            var pageNumber = 0;
            foreach (var page in doc.GetPages())
            {
                pageNumber++;
                var text = page.Text;
                if (string.IsNullOrWhiteSpace(text))
                    continue;

                var textLines = new List<string>();
                var tableLines = new List<string>();
                foreach (var rawLine in text.Split('\n'))
                {
                    var line = rawLine.TrimEnd();
                    if (line.Length == 0)
                    {
                        FlushText();
                        FlushTable();
                    }
                    else if (CellSplit.Split(line).Length >= 3) // 2+ double-space gaps => 3+ cells
                    {
                        tableLines.Add(line);
                    }
                    else
                    {
                        textLines.Add(line);
                    }
                }
                FlushText();
                FlushTable();
                continue;

                void FlushText()
                {
                    if (textLines.Count == 0)
                        return;
                    parts.Add(new ExtractedPart(PartKinds.Text, string.Join('\n', textLines), pageNumber));
                    textLines.Clear();
                }

                void FlushTable()
                {
                    if (tableLines.Count < 2)
                    {
                        // a lone gap-separated line is ordinary text
                        textLines.AddRange(tableLines);
                        tableLines.Clear();
                        return;
                    }
                    var sb = new StringBuilder();
                    foreach (var line in tableLines)
                    {
                        var cells = CellSplit.Split(line.Trim()).Select(c => c.Trim().Replace("|", "\\|")).ToList();
                        Markdown.AppendRow(sb, cells);
                    }
                    parts.Add(new ExtractedPart(PartKinds.Table, sb.ToString(), pageNumber));
                    tableLines.Clear();
                }
            }
            return parts;
        }, ct);
}

/// <summary>Picks the extractor for a mime type; unknown types yield a single text part with a notice.</summary>
public sealed class ExtractorDispatcher(IEnumerable<IPartExtractor> extractors)
{
    private readonly IReadOnlyList<IPartExtractor> _extractors = extractors.ToList();

    public Task<IReadOnlyList<ExtractedPart>> ExtractAsync(string path, string mimeType, CancellationToken ct = default)
    {
        var extractor = _extractors.FirstOrDefault(e => e.Supports(mimeType));
        if (extractor is null)
            return Task.FromResult<IReadOnlyList<ExtractedPart>>(
                [new ExtractedPart(PartKinds.Text, $"[unsupported file type {mimeType}]")]);
        return ExtractWithFallbackAsync(extractor, path, mimeType, ct);
    }

    private static async Task<IReadOnlyList<ExtractedPart>> ExtractWithFallbackAsync(
        IPartExtractor extractor, string path, string mimeType, CancellationToken ct)
    {
        var parts = await extractor.ExtractAsync(path, mimeType, ct);
        return parts.Count > 0 ? parts : [new ExtractedPart(PartKinds.Text, "[empty document]")];
    }
}

public static class ExtractionExtensions
{
    public static IServiceCollection AddExtraction(this IServiceCollection services) =>
        services
            // registered by interface so ExtractorDispatcher's IEnumerable<IPartExtractor> sees them
            .AddSingleton<IPartExtractor, TextExtractor>()
            .AddSingleton<IPartExtractor, ImageExtractor>()
            .AddSingleton<IPartExtractor, DocxExtractor>()
            .AddSingleton<IPartExtractor, XlsxExtractor>()
            .AddSingleton<IPartExtractor, PdfExtractor>()
            .AddSingleton<ExtractorDispatcher>();
}
