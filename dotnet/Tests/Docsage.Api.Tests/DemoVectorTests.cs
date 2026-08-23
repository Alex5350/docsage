using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Docsage.Api.Providers;

namespace Docsage.Api.Tests;

/// <summary>
/// Guards the canonical demo-vector algorithm (docs/CONTRACT.md appendix). Expected values were
/// generated with the python reference implementation
/// (backend/src/docsage_api/services/embeddings/demo.py) so demo vectors interoperate
/// byte-identically across the two backends. The hand-followed test re-derives components from
/// the seeds independently of the provider code, mirroring tests/test_chat.py.
/// </summary>
public sealed class DemoVectorTests
{
    private static readonly double[] DocsageFirst8 = [-0.0067663, 0.0102367, -0.0284368, 0.0339314, 0.0140208, -0.0118181, 0.0315597, 0.0260645];
    private static readonly double[] DocsageLast4 = [-0.0272948, 0.0188159, -0.0331869, 0.0410696];
    private static readonly double[] HelloFirst8 = [0.0431275, -0.0193965, -0.0228477, 0.0025688, 0.0080048, -0.0142249, 0.001005, -0.0337641];
    private static readonly double[] EmptyFirst8 = [0.03712, -0.0072279, -0.0110416, -0.0331741, -0.0154104, -0.0224555, -0.0129331, 0.0401863];

    [Fact]
    public void Matches_Python_Reference_For_Docsage()
    {
        var vector = DemoEmbeddingProvider.ComputeVector("docsage");
        Assert.Equal(DocsageFirst8, vector[..8]);
        Assert.Equal(DocsageLast4, vector[^4..]);
        Assert.Equal(0.9999999679451995, PostRoundingNorm(vector));
    }

    [Fact]
    public void Matches_Python_Reference_For_Other_Inputs()
    {
        var hello = DemoEmbeddingProvider.ComputeVector("hello world");
        Assert.Equal(HelloFirst8, hello[..8]);
        Assert.Equal(1.0000000356404495, PostRoundingNorm(hello));

        var empty = DemoEmbeddingProvider.ComputeVector("");
        Assert.Equal(EmptyFirst8, empty[..8]);
        Assert.Equal(1.0000000276235745, PostRoundingNorm(empty));
    }

    [Fact]
    public void Hand_Followed_Appendix_Derivation_Matches()
    {
        // independent re-implementation of appendix steps 1-3, from the sha256 seeds onward
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes("docsage"));
        Assert.Equal(0x83843E4D4DF9E5EFUL, BinaryPrimitives.ReadUInt64BigEndian(digest));
        Assert.Equal(0x7D987F3948924011UL, BinaryPrimitives.ReadUInt64BigEndian(digest.AsSpan(8)));

        ulong state0 = 0x83843E4D4DF9E5EFUL, state1 = 0x7D987F3948924011UL;
        var raw = new double[1536];
        for (var i = 0; i < raw.Length; i++)
        {
            ref var state = ref (i % 2 == 0 ? ref state0 : ref state1);
            state ^= state >> 12;
            state ^= state << 25;
            state ^= state >> 27;
            var output = unchecked(state * 0x2545F4914F6CDD1DUL);
            raw[i] = (output >> 11) * (1.0 / (1UL << 53)) - 0.5;
        }
        var norm = Math.Sqrt(DemoEmbeddingProvider.FSum(raw.Select(v => v * v)));
        var expected = raw.Select(v => Math.CopySign(Math.Floor(Math.Abs(v / norm) * 1e7 + 0.5), v / norm) / 1e7).ToArray();

        Assert.Equal(expected, DemoEmbeddingProvider.ComputeVector("docsage"));
        Assert.Equal(DocsageFirst8, expected[..8]);
    }

    [Fact]
    public void Deterministic_And_Distinct()
    {
        Assert.Equal(DemoEmbeddingProvider.ComputeVector("alpha"), DemoEmbeddingProvider.ComputeVector("alpha"));
        Assert.NotEqual(DemoEmbeddingProvider.ComputeVector("alpha"), DemoEmbeddingProvider.ComputeVector("beta"));
    }

    [Fact]
    public async Task Embeds_Query_And_Documents_Through_The_Provider_Interface()
    {
        var provider = new DemoEmbeddingProvider();
        Assert.Equal("demo", provider.Name);

        var query = await provider.EmbedQueryAsync("records retention policy");
        var documents = await provider.EmbedDocumentsAsync(["records retention policy", "orbital mechanics"]);
        Assert.Equal(query, documents[0]);
        Assert.NotEqual(query, documents[1]);
    }

    [Fact]
    public void Is_1536_Dimensional_With_Bounded_Components()
    {
        foreach (var text in new[] { "x", new string('x', 10_000) })
        {
            var vector = DemoEmbeddingProvider.ComputeVector(text);
            Assert.Equal(1536, vector.Length);
            Assert.All(vector, x => Assert.True(Math.Abs(x) <= 0.5, $"component {x} outside [-0.5, 0.5]"));
            Assert.True(Math.Abs(PostRoundingNorm(vector) - 1.0) < 1e-5);
        }
    }

    private static double PostRoundingNorm(double[] vector) =>
        // python test-side: math.sqrt(math.fsum(v*v for v in vector))
        Math.Sqrt(DemoEmbeddingProvider.FSum(vector.Select(v => v * v)));
}
