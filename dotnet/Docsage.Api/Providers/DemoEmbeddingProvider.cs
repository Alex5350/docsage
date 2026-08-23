using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Docsage.Api.Providers;

/// <summary>
/// Deterministic offline embedding provider — literal port of the python reference
/// (backend/src/docsage_api/services/embeddings/demo.py) implementing docs/CONTRACT.md
/// "Appendix: demo embedding algorithm" byte-identically in both backends:
///   1. b = sha256(utf8(text)); seed0 = uint64_be(b[0..8]), seed1 = uint64_be(b[8..16])
///      (big-endian, struct.unpack("&gt;QQ")).
///   2. Two xorshift64star generators (64-bit unsigned state, wraps mod 2^64):
///      state ^= state &gt;&gt; 12; state ^= state &lt;&lt; 25; state ^= state &gt;&gt; 27;
///      output = state * 0x2545F4914F6CDD1D. A starts at seed0, B at seed1.
///   3. Component i (0..1535): generator A when i is even, B when odd.
///      fraction = (output &gt;&gt; 11) / 2^53 in [0,1); v[i] = fraction - 0.5.
///   4. L2-normalize v, then round each component to 7 decimals half-away-from-zero:
///      copysign(floor(abs(x)*1e7 + 0.5), x) / 1e7. Values stay float64 end to end.
/// </summary>
public sealed class DemoEmbeddingProvider : IEmbeddingProvider
{
    public const int Dimensions = EmbeddingDimensions.Size;
    private const ulong Multiplier = 0x2545F4914F6CDD1DUL;
    private const double FractionScale = 1.0 / (1L << 53); // exactly 2^-53

    public string Name => "demo";

    public Task<double[]> EmbedQueryAsync(string text, CancellationToken ct = default) =>
        Task.FromResult(ComputeVector(text));

    public Task<IReadOnlyList<double[]>> EmbedDocumentsAsync(IReadOnlyList<string> texts, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<double[]>>(texts.Select(ComputeVector).ToArray());

    public static double[] ComputeVector(string s)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(s));
        var generatorA = new Xorshift64Star(BinaryPrimitives.ReadUInt64BigEndian(digest));
        var generatorB = new Xorshift64Star(BinaryPrimitives.ReadUInt64BigEndian(digest.AsSpan(8)));

        var values = new double[Dimensions];
        for (var i = 0; i < Dimensions; i++)
        {
            var output = (i & 1) == 0 ? generatorA.Next() : generatorB.Next();
            values[i] = (output >> 11) * FractionScale - 0.5;
        }

        var norm = Math.Sqrt(FSum(values.Select(v => v * v))); // python: math.fsum
        if (norm == 0.0)
            norm = 1.0;
        for (var i = 0; i < Dimensions; i++)
            values[i] = RoundHalfAwayFromZero(values[i] / norm);
        return values;
    }

    private static double RoundHalfAwayFromZero(double x) =>
        Math.CopySign(Math.Floor(Math.Abs(x) * 1e7 + 0.5), x) / 1e7;

    /// <summary>Exact port of CPython math.fsum (Shewchuk's adaptive expansion) so the
    /// normalization divisor is bit-identical to the python reference.</summary>
    public static double FSum(IEnumerable<double> items)
    {
        var partials = new List<double>();
        foreach (var item in items)
        {
            var x = item;
            var n = 0;
            for (var j = 0; j < partials.Count; j++)
            {
                var y = partials[j];
                if (Math.Abs(x) < Math.Abs(y))
                    (x, y) = (y, x);
                var sumHi = x + y;
                var sumLo = y - (sumHi - x);
                if (sumLo != 0.0)
                    partials[n++] = sumLo;
                x = sumHi;
            }
            if (n < partials.Count)
                partials.RemoveRange(n, partials.Count - n);
            partials.Add(x);
        }
        if (partials.Count == 0)
            return 0.0;

        var hi = partials[^1];
        var index = partials.Count - 1;
        var lo = 0.0;
        while (index > 0)
        {
            var x = hi;
            var y = partials[--index];
            if (Math.Abs(x) < Math.Abs(y))
                (x, y) = (y, x);
            hi = x + y;
            var roundoff = hi - x;
            lo = y - roundoff;
            if (lo != 0.0)
                break;
        }
        if (index > 0 && ((lo < 0.0 && partials[index - 1] < 0.0) || (lo > 0.0 && partials[index - 1] > 0.0)))
        {
            var y = lo * 2.0;
            var x = hi + y;
            if (y == x - hi)
                hi = x;
        }
        return hi;
    }

    private struct Xorshift64Star(ulong seed)
    {
        private ulong _state = seed;

        public ulong Next()
        {
            var state = _state;
            state ^= state >> 12;
            state ^= state << 25;
            state ^= state >> 27;
            _state = state;
            return unchecked(state * Multiplier);
        }
    }
}

public static class DemoEmbeddingProviderExtensions
{
    public static IServiceCollection AddDemoEmbeddingProvider(this IServiceCollection services) =>
        services.AddSingleton<DemoEmbeddingProvider>();
}
