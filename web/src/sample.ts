// Vite supports importing any file as raw text with the `?raw` suffix.
// The sample is copied into web/public at scaffold time so we vendor a known
// good SymboleoAC contract for first-load.
import meatSale from '../public/MeatSale.symboleo?raw';

export const DEFAULT_SAMPLE = meatSale;
export const DEFAULT_SAMPLE_NAME = 'MeatSale.symboleo';
