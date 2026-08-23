using System.Security.Cryptography;
using System.Text;
using Isopoh.Cryptography.Argon2;

namespace Docsage.Api.Infrastructure;

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string passwordHash, string password);
}

/// <summary>
/// Argon2id hashing that interoperates with python argon2-cffi: both read and write standard PHC
/// strings ($argon2id$v=19$m=65536,t=3,p=4$...), so hashes created by either backend verify on
/// the other. Parameters mirror the python defaults: 64 MiB memory, 3 iterations, parallelism 4.
/// </summary>
public sealed class Argon2PasswordHasher : IPasswordHasher
{
    private const int TimeCost = 3;
    private const int MemoryKib = 65536; // 64 MiB, matches python memory_cost=65536
    private const int Parallelism = 4;
    private const int HashLength = 32;
    private const int SaltLength = 16;

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltLength);
        return Argon2.Hash(
            password,
            null,
            TimeCost,
            MemoryKib,
            Parallelism,
            Argon2Type.HybridAddressing, // argon2id
            HashLength,
            null);
    }

    public bool Verify(string passwordHash, string password) =>
        Argon2.Verify(passwordHash, password, null, null);
}

public static class PasswordHasherExtensions
{
    public static IServiceCollection AddPasswordHasher(this IServiceCollection services) =>
        services.AddSingleton<IPasswordHasher, Argon2PasswordHasher>();
}

public static class Sha256
{
    public static string HexOfFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(stream)).ToLowerInvariant();
    }

    public static string HexOfString(string value) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
