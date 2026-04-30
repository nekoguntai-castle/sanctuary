import {
  cryptoRandomSource,
  shuffleInPlace,
} from "../../../../src/services/bitcoin/secureRandom";

describe("secureRandom", () => {
  describe("cryptoRandomSource", () => {
    it("returns fractions in the Math.random-compatible range", () => {
      const value = cryptoRandomSource.randomFraction();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it("rejects invalid random integer bounds before calling crypto", () => {
      expect(() => cryptoRandomSource.randomInt(0)).toThrow(RangeError);
      expect(() => cryptoRandomSource.randomInt(-1)).toThrow(RangeError);
      expect(() => cryptoRandomSource.randomInt(1.5)).toThrow(RangeError);
      expect(() => cryptoRandomSource.randomInt(2 ** 48)).toThrow(RangeError);
    });
  });

  describe("shuffleInPlace", () => {
    it("uses a supplied integer random source for Fisher-Yates shuffling", () => {
      const indexes = [0, 2, 0];
      const randomSource = {
        randomInt: vi.fn((maxExclusive: number) => {
          expect(indexes[0]).toBeLessThan(maxExclusive);
          return indexes.shift() ?? 0;
        }),
      };
      const items = ["a", "b", "c", "d"];

      const result = shuffleInPlace(items, randomSource);

      expect(result).toBe(items);
      expect(items).toEqual(["b", "d", "c", "a"]);
      expect(randomSource.randomInt).toHaveBeenNthCalledWith(1, 4);
      expect(randomSource.randomInt).toHaveBeenNthCalledWith(2, 3);
      expect(randomSource.randomInt).toHaveBeenNthCalledWith(3, 2);
    });
  });
});
