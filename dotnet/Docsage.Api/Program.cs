using System.Text.Json;
using System.Text.Json.Serialization;
using Docsage.Api.Endpoints;
using Docsage.Api.Infrastructure;
using Docsage.Api.Providers;
using Docsage.Api.Services;
using Docsage.Api.Services.Extraction;
using Microsoft.AspNetCore.Http.Json;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddDocsageOptions()
    .AddDocsageDatabase()
    .AddPasswordHasher()
    .AddSessions()
    .AddUploadStorage()
    .AddEmbeddingProviders()
    .AddChatAnswerProviders()
    .AddExtraction()
    .AddEnricher()
    .AddRecovery()
    .AddIngestionPipeline()
    .AddDocumentsService()
    .AddRetrievalService()
    .AddChatService();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    options.SerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower;
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

builder.Services.AddCors(options => options.AddPolicy("frontend", policy => policy
    .WithOrigins("http://localhost:3000", "http://127.0.0.1:3000")
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

app.UseExceptionHandler(errorApp => errorApp.Run(context =>
{
    if (context.Response.HasStarted)
        return Task.CompletedTask;
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    context.Response.ContentType = "application/json";
    // development surfaces the exception message; production never leaks internals
    var message = app.Environment.IsDevelopment()
        ? context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error.Message
        : "Internal server error";
    return context.Response.WriteAsync(System.Text.Json.JsonSerializer.Serialize(new { detail = message }));
}));
app.UseCors("frontend");

app.MapHealthEndpoints();
app.MapAuthEndpoints();
app.MapDocumentEndpoints();
app.MapTopicEndpoints();
app.MapReviewEndpoints();
app.MapChatEndpoints();
app.MapAdminEndpoints();

app.Run();

/// <summary>Exposes the entry point to WebApplicationFactory in the integration test project.</summary>
public partial class Program;
