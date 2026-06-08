// Bundled example contracts. Vite inlines these as raw text via `?raw`.
// The files are copied into web/public at scaffold time.
import meatSale from '../public/MeatSale.symboleo?raw';
import vaccineProcurement from '../public/VaccineProcurement.symboleo?raw';

export type Sample = { name: string; text: string };

export const SAMPLES: Sample[] = [
  { name: 'MeatSale.symboleo', text: meatSale },
  { name: 'VaccineProcurement.symboleo', text: vaccineProcurement },
];

export const DEFAULT_SAMPLE = SAMPLES[0].text;
export const DEFAULT_SAMPLE_NAME = SAMPLES[0].name;
