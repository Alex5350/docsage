using Docsage.Api.Infrastructure;

namespace Docsage.Api.Tests;

/// <summary>
/// Argon2 interop with the python reference backend (argon2-cffi): hashes produced by either
/// side are standard PHC strings that verify on the other. The fixed vectors below were
/// generated with python argon2-cffi (argon2id, m=65536, t=3, p=4).
/// </summary>
public sealed class PasswordHasherTests
{
    private readonly Argon2PasswordHasher _hasher = new();

    [Theory]
    [InlineData("$argon2id$v=19$m=65536,t=3,p=4$58qYIFjiV3QTwW9oiNcITQ$9R9PeZ/81OLf1/V/Rt2bui643Udm/tBO/5fU/Cmibqs", "password123")]
    [InlineData("$argon2id$v=19$m=65536,t=3,p=4$3pdwNMZoaaK/TjUU8rY3uA$ob3jyUiSeVwdko6qjK8q+PIHd4aEtEOk4JwnL2cD8G0", "hunter2")]
    public void Verifies_Python_Generated_Phc_Hashes(string pythonHash, string password) =>
        Assert.True(_hasher.Verify(pythonHash, password));

    [Fact]
    public void Rejects_Wrong_Password_On_Python_Hash() =>
        Assert.False(_hasher.Verify(
            "$argon2id$v=19$m=65536,t=3,p=4$58qYIFjiV3QTwW9oiNcITQ$9R9PeZ/81OLf1/V/Rt2bui643Udm/tBO/5fU/Cmibqs",
            "wrong-password"));

    [Fact]
    public void Produced_Hashes_Are_Phc_Argon2id_And_Round_Trip()
    {
        var hash = _hasher.Hash("round-trip-password");
        Assert.StartsWith("$argon2id$v=19$m=65536,t=3,p=4$", hash);
        Assert.True(_hasher.Verify(hash, "round-trip-password"));
        Assert.False(_hasher.Verify(hash, "other-password"));
        // unique salts per call
        Assert.NotEqual(hash, _hasher.Hash("round-trip-password"));
    }
}
