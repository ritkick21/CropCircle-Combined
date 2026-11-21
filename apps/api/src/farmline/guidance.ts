import { farmCropMatches, type FarmGuidance, type FarmResource } from '@cropcircle/shared-types';

const sorghum = 'sorghum';
const wheat = 'wheat';

export const extensionDirectory =
  'https://www.nifa.usda.gov/land-grant-colleges-and-universities-partner-website-directory';

export const referenceLibrary: FarmResource[] = [
  {
    id: 'sorghum-management',
    crop: sorghum,
    kind: 'GUIDE',
    title: 'Agronomic Management Practices for Controlling Sugarcane Aphids',
    publisher: 'Oklahoma State University Extension',
    summary: 'Extension guidance on scouting and selecting tolerant sorghum hybrids.',
    url: 'https://extension.okstate.edu/fact-sheets/agronomic-management-practices-for-controlling-sugarcane-aphids',
  },
  {
    id: 'sorghum-scouting',
    crop: sorghum,
    kind: 'FIELD_REPORT',
    title: 'Start Scouting for Sorghum Aphids',
    publisher: 'Oklahoma State University Extension',
    summary:
      'An Oklahoma field alert describes aphids concentrated at field edges and includes photos for identification.',
    url: 'https://extension.okstate.edu/e-pest-alerts/2024/start-scouting-for-sorghum-aphids-august-21-2024',
  },
  {
    id: 'sorghum-georgia',
    crop: sorghum,
    kind: 'FIELD_REPORT',
    title: 'Tips on Managing Sugar Cane Aphid',
    publisher: 'University of Georgia Extension',
    summary:
      'A Colquitt County extension report describes growers encountering aphids in the 2014 season.',
    url: 'https://site.extension.uga.edu/colquittag/2015/05/tips-on-managing-sugar-cane-aphid/',
  },
  {
    id: 'sorghum-research',
    crop: sorghum,
    kind: 'RESEARCH',
    title: 'Sugarcane Aphid: A New Pest on Sorghum in North America',
    publisher: 'Journal of Integrated Pest Management',
    summary: 'A research review of the aphid’s emergence as a pest of North American sorghum.',
    url: 'https://doi.org/10.1093/jipm/pmw011',
  },
  {
    id: 'wheat-rust',
    crop: wheat,
    kind: 'GUIDE',
    title: 'Wheat Stripe Rust',
    publisher: 'Utah State University Extension',
    summary:
      'Photos and descriptions of stripe rust symptoms, plus notes on scouting and resistant cultivars.',
    url: 'https://extension.usu.edu/crops/research/wheat-stripe-rust',
  },
];

export function guidanceFor(crop: string, description: string): FarmGuidance {
  if (
    farmCropMatches(crop, sorghum) &&
    /\b(aphids?|sticky|honeydew|shiny|yellow bugs)\b/i.test(description)
  ) {
    return {
      heading: 'Check for sorghum aphids',
      summary:
        'Sticky leaves and small insects on sorghum can be consistent with an aphid infestation.',
      steps: [
        'Look for colonies on the undersides of upper and lower leaves in several parts of the field.',
        'Photograph the insects and note where they occur and whether the affected area is growing.',
        'Ask your local extension office to confirm identification and use its current guidance for treatment decisions.',
      ],
      sourceIds: ['sorghum-management', 'sorghum-scouting'],
    };
  }
  if (
    farmCropMatches(crop, wheat) &&
    /\b(rust|stripes?|striped|pustules?|yellow rows)\b/i.test(description)
  ) {
    return {
      heading: 'Check for wheat stripe rust',
      summary: 'Rows of yellow-orange pustules on wheat warrant a check for stripe rust.',
      steps: [
        'Look closely at affected leaf blades for small pustules arranged in rows.',
        'Photograph affected plants and mark where the symptoms appear in the field.',
        'Share the photos, cultivar and growth stage with your local extension office for confirmation.',
      ],
      sourceIds: ['wheat-rust'],
    };
  }
  return {
    heading: 'Document the symptoms',
    summary: 'The reference library has no symptom-specific guide for this report yet.',
    steps: [
      'Take close-up and wider photos and note when the symptoms started.',
      'Compare affected and unaffected plants and note any recent changes in water, weather or field work.',
      'Share these observations with a researcher or your local extension office.',
    ],
    sourceIds: [],
  };
}
