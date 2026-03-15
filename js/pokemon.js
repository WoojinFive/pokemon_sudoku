/**
 * pokemon.js — Pokemon image loading
 * Exposes: window.PokemonLoader
 */
(function () {
  'use strict';

  // Fallback colors for when images fail to load
  const FALLBACK_COLORS = [
    '#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c',
    '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#a9e34b'
  ];

  function pickRandomPokemon() {
    const ids = [];
    const pool = Array.from({ length: 100 }, (_, i) => i + 1);
    while (ids.length < 9) {
      const i = Math.floor(Math.random() * pool.length);
      ids.push(pool.splice(i, 1)[0]);
    }
    return ids;
  }

  function spriteUrl(id) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/dream-world/${id}.svg`;
  }

  function fallbackUrl(id) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * Preload 9 pokemon images.
   * Returns { 1: {id, url, fallback}, ..., 9: {id, url, fallback} }
   * `url` is the resolved image URL or null (use fallback div).
   */
  async function preloadPokemon(ids) {
    const results = {};

    await Promise.allSettled(ids.map(async (pokemonId, slotIndex) => {
      const slot = slotIndex + 1; // 1-based slot
      const svgUrl = spriteUrl(pokemonId);
      const pngUrl = fallbackUrl(pokemonId);

      try {
        await loadImage(svgUrl);
        results[slot] = { id: pokemonId, url: svgUrl, fallback: false };
      } catch {
        try {
          await loadImage(pngUrl);
          results[slot] = { id: pokemonId, url: pngUrl, fallback: false };
        } catch {
          // Both failed — use colored div
          results[slot] = {
            id: pokemonId,
            url: null,
            fallback: true,
            color: FALLBACK_COLORS[slotIndex % FALLBACK_COLORS.length],
            label: String(slot)
          };
        }
      }
    }));

    return results;
  }

  window.PokemonLoader = { pickRandomPokemon, preloadPokemon, spriteUrl, fallbackUrl };
})();
